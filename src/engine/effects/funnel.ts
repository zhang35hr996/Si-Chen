/**
 * The effect funnel (skeleton-plan §6) — the ONLY code path that changes
 * gameplay state (relationships, favor, resources, memory, flags):
 *
 *   EventEffect[] → validate (schema + targets) → apply as ONE atomic batch
 *
 * Rules enforced here and nowhere else:
 *   - every effect re-passes eventEffectSchema at runtime (future AI-built
 *     effects inherit the same gate as content-built ones)
 *   - targets must exist in BOTH content and current state
 *   - numeric clamping lives here only: per-axis cumulative delta is capped
 *     to ±AXIS_CAP per batch, resulting values clamped 0–100
 *   - runtime memory is append-only; retention is author/effect-supplied (permanent allowed)
 *   - reject-one-reject-all: any invalid effect rejects the whole batch and
 *     the caller keeps the original state reference
 */
import type { TraceCollector } from "../trace/collector";
import { diffGameState } from "../trace/diff";
import { toGameTime } from "../calendar/time";
import { chamberOf, hasChambers } from "../characters/chambers";
import { isConfined, nextStatusEffectId } from "../characters/confinement";
import { activeColdPalaceEffectFor, isInColdPalace } from "../characters/coldPalace";
import { eligibleHaremAdministrators } from "../characters/haremAdministration";
import { canAdministratorAdjustRank, canEmpressAdjustRank } from "../characters/haremRankAuthority";
import { nextHeirId } from "../characters/heirs";
import { getCharacterLocation } from "../characters/presence";
import type { ContentDB } from "../content/loader";
import { isAssignableRank, eventEffectSchema, type EventEffect } from "../content/schemas";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import { memoryEntryId } from "../state/newGame";
import type { GameTime } from "../calendar/time";
import type { ChamberId, ColdPalaceEffect, GameState } from "../state/types";
import { resolveConsortRuntimeAttrs } from "../characters/consortAttrs";

/** Max |cumulative delta| per axis (char×field / pillar×field) per batch. */
export const AXIS_CAP = 10;

const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

export function validateEffects(
  db: ContentDB,
  state: GameState,
  effects: readonly EventEffect[],
): GameError[] {
  const errors: GameError[] = [];
  const bad = (index: number, code: string, message: string, context?: Record<string, unknown>) =>
    errors.push(stateError(code, `effect #${index}: ${message}`, { context: { index, ...context } }));

  // 批内去重：validate 逐项读批前原始 state，故同批多条 record_physician_visit 对同一人都会过单条校验；
  // 用本集合在批内强制「每月每人一次」，使引擎（含未来事件/AI 生成 effects 的统一入口）真正兜底。
  const physicianVisitsInBatch = new Set<string>();
  // 批内禁足去重：同一 batch 同一角色只允许一条 confine；confine+lift 矛盾批次一并拒绝。
  const confineInBatch = new Set<string>();
  const liftInBatch = new Set<string>();
  // 批内冷宫去重：同一 batch 同一角色只允许一条 send_to_cold_palace。
  const coldPalaceInBatch = new Set<string>();

  effects.forEach((effect, index) => {
    const parsed = eventEffectSchema.safeParse(effect);
    if (!parsed.success) {
      bad(index, "BAD_EFFECT", `invalid shape: ${parsed.error.issues[0]?.message ?? "unknown"}`, {
        effect,
      });
      return;
    }
    const e = parsed.data;
    switch (e.type) {
      case "favor":
      case "adjust_consort_attr": {
        const ch = e.char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        if (!c || c.kind !== "consort" || !state.standing[ch]) {
          bad(index, "BAD_EFFECT_TARGET", `unknown consort standing target "${ch}"`, { char: ch });
        }
        break;
      }
      case "memory": {
        const memChar = db.characters[e.char] ?? state.generatedConsorts[e.char];
        if (!memChar || !state.memories[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `unknown memory target "${e.char}"`, { char: e.char });
        }
        break;
      }
      case "resource":
      case "set_bloodline_status":
      case "flag":
      case "set_sovereign_health":
      case "set_taihou_health":
      case "taihou_decease":
      case "enqueue_aftermath":
        break; // fully constrained by the schema
      case "set_consort_health":
      case "consort_decease": {
        const ch = (effect as { char: string }).char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        if (!c || c.kind !== "consort" || !state.standing[ch]) bad(index, "BAD_EFFECT_TARGET", `effect needs a consort with standing: "${ch}"`, { char: ch });
        else if (state.standing[ch]!.lifecycle === "deceased" && effect.type === "set_consort_health") bad(index, "BAD_EFFECT_TARGET", `set_consort_health on deceased consort: "${ch}"`, { char: ch });
        break;
      }
      case "confine": {
        const ch = e.char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        const st = state.standing[ch];
        if (!c || c.kind !== "consort" || !st) {
          bad(index, "BAD_EFFECT_TARGET", `confine needs a consort with standing: "${ch}"`, { char: ch });
        } else if (st.lifecycle === "deceased") {
          bad(index, "BAD_EFFECT_TARGET", `cannot confine a deceased consort: "${ch}"`, { char: ch });
        } else if (e.endTurnExclusive !== null && e.endTurnExclusive <= e.startTurn) {
          bad(index, "BAD_EFFECT", `confine endTurnExclusive must be > startTurn`, { char: ch });
        } else if (isConfined(state, ch, e.startTurn)) {
          // 单一权威：不允许同一角色叠加第二条活跃禁足。
          bad(index, "BAD_EFFECT", `consort already confined: "${ch}"`, { char: ch });
        } else if (confineInBatch.has(ch)) {
          // 批内去重：同一 batch 不允许对同一角色多条 confine。
          bad(index, "BAD_EFFECT", `duplicate confine in same batch: "${ch}"`, { char: ch });
        } else if (liftInBatch.has(ch)) {
          // 矛盾批次：同一 batch 内同一角色 confine + lift 互相矛盾，整批拒绝。
          bad(index, "BAD_EFFECT", `contradictory confine+lift_confinement in same batch: "${ch}"`, { char: ch });
        } else {
          confineInBatch.add(ch);
        }
        break;
      }
      case "lift_confinement": {
        const ch = e.char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        if (!c || c.kind !== "consort" || !state.standing[ch]) {
          bad(index, "BAD_EFFECT_TARGET", `lift_confinement needs a consort with standing: "${ch}"`, { char: ch });
        } else if (confineInBatch.has(ch)) {
          // 矛盾批次：同一 batch 内 lift 先于或后于 confine 均不合法。
          bad(index, "BAD_EFFECT", `contradictory lift_confinement+confine in same batch: "${ch}"`, { char: ch });
        } else {
          liftInBatch.add(ch);
        }
        // 幂等：无活跃/到期记录时 apply 是 no-op，不在此报错。
        break;
      }
      case "set_consort_posthumous": {
        const ch = (effect as { char: string }).char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        const st = state.standing[ch];
        if (!c || c.kind !== "consort" || !st || st.lifecycle !== "deceased" || !st.deathRecord)
          bad(index, "BAD_EFFECT_TARGET", `set_consort_posthumous needs a deceased consort with deathRecord: "${ch}"`, { char: ch });
        break;
      }
      case "set_heir_health": {
        const h = state.resources.bloodline.heirs.find((x) => x.id === (effect as { heirId: string }).heirId);
        if (!h) bad(index, "BAD_EFFECT_TARGET", `set_heir_health: no such heir "${(effect as { heirId: string }).heirId}"`, { heirId: (effect as { heirId: string }).heirId });
        else if (h.lifecycle === "deceased") bad(index, "BAD_EFFECT_TARGET", `set_heir_health on deceased heir "${h.id}"`, { heirId: h.id });
        break;
      }
      case "heir_decease": {
        const h = state.resources.bloodline.heirs.find((x) => x.id === (effect as { heirId: string }).heirId);
        if (!h) bad(index, "BAD_EFFECT_TARGET", `heir_decease: no such heir "${(effect as { heirId: string }).heirId}"`, { heirId: (effect as { heirId: string }).heirId });
        break; // already-deceased heir is allowed (apply case is idempotent)
      }
      case "set_rank": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `set_rank needs a consort with standing: "${e.char}"`, { char: e.char });
        } else if (state.standing[e.char]!.rank === "fenghou") {
          bad(index, "BAD_EFFECT_TARGET", `the 正宫 (凤后) is not adjustable: "${e.char}"`, { char: e.char });
        } else {
          const r = db.ranks[e.rank];
          if (!r || r.domain !== "harem" || e.rank === "fenghou") {
            bad(index, "BAD_EFFECT", `set_rank to invalid rank "${e.rank}"`, { rank: e.rank });
          } else if (!isAssignableRank(r)) {
            bad(index, "BAD_EFFECT", `set_rank to deprecated rank "${e.rank}"`, { rank: e.rank });
          } else if (e.authority.kind === "harem_administrator") {
            const check = e.authority.office === "empress"
              ? canEmpressAdjustRank(db, state, e.authority.actorId, e.char, e.rank)
              : canAdministratorAdjustRank(db, state, e.authority.actorId, e.char, e.rank);
            if (!check.ok) bad(index, "BAD_EFFECT", check.reason, { actorId: e.authority.actorId, char: e.char, rank: e.rank });
          }
          // authority.kind === "sovereign" → no admin check needed
        }
        break;
      }
      case "set_title": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `set_title needs a consort with standing: "${e.char}"`, { char: e.char });
        } else if (state.standing[e.char]!.rank === "fenghou") {
          bad(index, "BAD_EFFECT_TARGET", `the 正宫 (凤后) is not adjustable: "${e.char}"`, { char: e.char });
        } else if (db.lexicon.forbiddenTerms.some((t) => e.title.includes(t))) {
          bad(index, "BAD_EFFECT", `title "${e.title}" contains a forbidden term`, { title: e.title });
        } else if (e.authority.kind === "harem_administrator") {
          // 封号操作不改变位分，但仍须目标严格低于协理者（empress 模式只需不是凤后）。
          const curRankId = state.standing[e.char]!.rank;
          const check = e.authority.office === "empress"
            ? canEmpressAdjustRank(db, state, e.authority.actorId, e.char, curRankId)
            : canAdministratorAdjustRank(db, state, e.authority.actorId, e.char, curRankId);
          if (!check.ok) bad(index, "BAD_EFFECT", check.reason, { actorId: e.authority.actorId, char: e.char });
        }
        break;
      }
      case "remove_title": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `remove_title needs a consort with standing: "${e.char}"`, { char: e.char });
        } else if (state.standing[e.char]!.rank === "fenghou") {
          bad(index, "BAD_EFFECT_TARGET", `the 正宫 (凤后) is not adjustable: "${e.char}"`, { char: e.char });
        } else if (e.authority.kind === "harem_administrator") {
          const curRankId = state.standing[e.char]!.rank;
          const check = e.authority.office === "empress"
            ? canEmpressAdjustRank(db, state, e.authority.actorId, e.char, curRankId)
            : canAdministratorAdjustRank(db, state, e.authority.actorId, e.char, curRankId);
          if (!check.ok) bad(index, "BAD_EFFECT", check.reason, { actorId: e.authority.actorId, char: e.char });
        }
        break;
      }
      case "bedchamber": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.bedchamber[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `bedchamber needs a consort with a record: "${e.char}"`, { char: e.char });
        }
        break;
      }
      case "pregnancy": {
        const preg = state.resources.bloodline.pregnancy;
        if (e.op === "begin" && preg.status !== "none") {
          bad(index, "BAD_EFFECT", `pregnancy begin requires status "none", got "${preg.status}"`, { status: preg.status });
        } else if (e.op === "carry") {
          if (preg.status !== "pending") {
            bad(index, "BAD_EFFECT", `pregnancy carry requires status "pending", got "${preg.status}"`, { status: preg.status });
          } else if (preg.conceivedAt === undefined) {
            bad(index, "BAD_EFFECT", `pregnancy carry requires a conceivedAt`, {});
          }
        }
        break;
      }
      case "heir_designate": {
        for (const id of e.charIds) {
          const ch = db.characters[id];
          const st = state.standing[id];
          if (!ch || ch.kind !== "consort" || !st) {
            bad(index, "BAD_EFFECT_TARGET", `heir_designate needs a consort with standing: "${id}"`, { char: id });
          } else if (st.lifecycle === "deceased") {
            bad(index, "BAD_EFFECT_TARGET", `cannot designate a deceased consort: "${id}"`, { char: id });
          }
        }
        break;
      }
      case "heir_candidate": {
        const ch = db.characters[e.char];
        const st = state.standing[e.char];
        if (!ch || ch.kind !== "consort" || !st) {
          bad(index, "BAD_EFFECT_TARGET", `heir_candidate needs a consort with standing: "${e.char}"`, { char: e.char });
        } else if (st.lifecycle === "deceased") {
          bad(index, "BAD_EFFECT_TARGET", `cannot mark a deceased consort: "${e.char}"`, { char: e.char });
        } else if (e.op === "add" && st.lifecycle !== undefined && st.lifecycle !== "normal" && st.lifecycle !== "candidate") {
          bad(index, "BAD_EFFECT_TARGET", `cannot mark a 承嗣/育嗣 consort as candidate: "${e.char}"`, { char: e.char });
        } else if (e.op === "add" && state.resources.bloodline.pregnancy.status === "none") {
          bad(index, "BAD_EFFECT", `heir_candidate add requires an active self-pregnancy`, {});
        }
        break;
      }
      case "pregnancy_transfer": {
        const ch = db.characters[e.carrierId];
        const st = state.standing[e.carrierId];
        const preg = state.resources.bloodline.pregnancy;
        const sov = state.resources.bloodline.gestations.find((g) => g.carrier === "sovereign");
        if (!ch || ch.kind !== "consort" || !st) {
          bad(index, "BAD_EFFECT_TARGET", `pregnancy_transfer needs a consort with standing: "${e.carrierId}"`, { char: e.carrierId });
        } else if (st.lifecycle === "deceased") {
          bad(index, "BAD_EFFECT_TARGET", `cannot transfer to a deceased consort: "${e.carrierId}"`, { char: e.carrierId });
        } else if (state.resources.bloodline.gestations.some((g) => g.carrier === e.carrierId)) {
          bad(index, "BAD_EFFECT_TARGET", `cannot transfer to an already-pregnant consort: "${e.carrierId}"`, { char: e.carrierId });
        } else if (preg.status !== "carrying" || sov === undefined) {
          bad(index, "BAD_EFFECT", `pregnancy_transfer requires sovereign self-pregnancy`, { status: preg.status });
        }
        break;
      }
      case "pregnancy_abort": {
        const sov = state.resources.bloodline.gestations.find((g) => g.carrier === "sovereign");
        if (!sov) {
          bad(index, "BAD_EFFECT", `pregnancy_abort requires sovereign self-pregnancy`, {});
        }
        break;
      }
      case "birth": {
        if (!state.resources.bloodline.gestations.some((g) => g.carrier === e.bearer)) {
          bad(index, "BAD_EFFECT", `birth requires an active gestation`, {});
        }
        if (e.bearer !== "sovereign" && (!db.characters[e.bearer] || !state.standing[e.bearer])) {
          bad(index, "BAD_EFFECT_TARGET", `birth bearer is not a consort with standing: "${e.bearer}"`, { char: e.bearer });
        }
        if (e.fatherId !== null && (!db.characters[e.fatherId] || db.characters[e.fatherId]!.kind !== "consort")) {
          bad(index, "BAD_EFFECT_TARGET", `birth fatherId is not a consort: "${e.fatherId}"`, { char: e.fatherId });
        }
        if ((e.twinSex !== undefined) !== (e.twinFavor !== undefined)) {
          bad(index, "BAD_EFFECT", `birth twinSex and twinFavor must both be present or both absent`, {});
        }
        break;
      }
      case "heir_name": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        break;
      }
      case "heir_summon": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        break;
      }
      case "heir_educate": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        break;
      }
      case "heir_adopt": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        const ch = db.characters[e.fatherId];
        if (!ch || (ch.kind !== "consort" && ch.kind !== "elder")) {
          bad(index, "BAD_EFFECT_TARGET", `heir_adopt needs a consort or elder: "${e.fatherId}"`, { char: e.fatherId });
        } else if (ch.kind === "consort") {
          const st = state.standing[e.fatherId];
          if (!st) {
            bad(index, "BAD_EFFECT_TARGET", `heir_adopt needs a consort with standing: "${e.fatherId}"`, { char: e.fatherId });
          } else if (st.lifecycle === "deceased") {
            bad(index, "BAD_EFFECT_TARGET", `adoptive father is deceased: "${e.fatherId}"`, { char: e.fatherId });
          } else if (ch.defaultLocation === "changmengong") {
            bad(index, "BAD_EFFECT_TARGET", `adoptive father is in 冷宫: "${e.fatherId}"`, { char: e.fatherId });
          }
        }
        break;
      }
      case "child_favor": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        break;
      }
      case "heir_died": {
        const heir = state.resources.bloodline.heirs.find((h) => h.id === e.heirId);
        if (!heir) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        } else if (heir.lifecycle === "deceased") {
          bad(index, "BAD_EFFECT", `heir "${e.heirId}" already deceased`, { heir: e.heirId });
        }
        break;
      }
      case "record_physician_visit": {
        const sub = e.subject;
        const expectedKey = `${state.calendar.year}:${state.calendar.month}`;
        if (e.monthKey !== expectedKey) {
          bad(index, "BAD_EFFECT_TARGET", `physician visit monthKey "${e.monthKey}" != current "${expectedKey}"`, {});
          break;
        }
        let alive = false;
        let lastKey: string | undefined;
        if (sub.kind === "sovereign") { alive = true; lastKey = state.resources.sovereign.lastPhysicianVisitMonthKey; }
        else if (sub.kind === "taihou") { alive = state.taihou.deceased !== true; lastKey = state.taihou.lastPhysicianVisitMonthKey; }
        else if (sub.kind === "consort") {
          const st = state.standing[sub.id];
          const c = db.characters[sub.id] ?? state.generatedConsorts[sub.id];
          alive = !!st && st.lifecycle !== "deceased" && !!c && c.kind === "consort";
          lastKey = st?.lastPhysicianVisitMonthKey;
        } else {
          const h = state.resources.bloodline.heirs.find((x) => x.id === sub.id);
          alive = !!h && h.lifecycle === "alive";
          lastKey = h?.lastPhysicianVisitMonthKey;
        }
        if (!alive) bad(index, "BAD_EFFECT_TARGET", `physician visit on missing/deceased subject`, {});
        else if (lastKey === expectedKey) bad(index, "BAD_EFFECT_TARGET", `physician already visited subject this month`, {});
        const subjectKey = sub.kind === "sovereign" || sub.kind === "taihou" ? sub.kind : `${sub.kind}:${sub.id}`;
        const batchKey = `${expectedKey}:${subjectKey}`;
        if (physicianVisitsInBatch.has(batchKey)) {
          bad(index, "BAD_EFFECT_TARGET", `duplicate physician visit in the same batch`, { batchKey });
        } else {
          physicianVisitsInBatch.add(batchKey);
        }
        break;
      }
      case "relocate": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `relocate needs a consort with standing: "${e.char}"`, { char: e.char });
        } else if (state.standing[e.char]!.rank === "fenghou") {
          bad(index, "BAD_EFFECT_TARGET", `the 正宫 (凤后) is not relocatable: "${e.char}"`, { char: e.char });
        } else if (isInColdPalace(state, e.char)) {
          bad(index, "BAD_EFFECT", `cannot relocate "${e.char}" while in cold palace`, { char: e.char });
        } else if (!hasChambers(e.location)) {
          bad(index, "BAD_EFFECT", `relocate target "${e.location}" is not a 设宫室 palace`, { location: e.location });
        } else {
          // 目标宫室不可已被「他人」占用（搬回原位/换宫室自身允许）。
          const occupied = Object.values(db.characters).some(
            (c) =>
              c.id !== e.char &&
              c.kind === "consort" &&
              state.standing[c.id]?.lifecycle !== "deceased" &&
              getCharacterLocation(db, state, c.id) === e.location &&
              chamberOf(state.standing[c.id]) === e.chamber,
          );
          if (occupied) {
            bad(index, "BAD_EFFECT", `chamber "${e.chamber}" of "${e.location}" is occupied`, {
              location: e.location,
              chamber: e.chamber,
            });
          }
        }
        break;
      }
      case "send_to_cold_palace": {
        const ch = (e as { char: string }).char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        const st = state.standing[ch];
        if (!c || c.kind !== "consort" || !st) {
          bad(index, "BAD_EFFECT_TARGET", `send_to_cold_palace needs a consort with standing: "${ch}"`, { char: ch });
        } else if (st.lifecycle === "deceased") {
          bad(index, "BAD_EFFECT_TARGET", `cannot send a deceased consort to cold palace: "${ch}"`, { char: ch });
        } else if (isInColdPalace(state, ch)) {
          bad(index, "BAD_EFFECT", `consort already in cold palace: "${ch}"`, { char: ch });
        } else if (coldPalaceInBatch.has(ch)) {
          bad(index, "BAD_EFFECT", `duplicate send_to_cold_palace in same batch: "${ch}"`, { char: ch });
        } else {
          coldPalaceInBatch.add(ch);
        }
        break;
      }
      case "restore_from_cold_palace": {
        const ch = (e as { char: string }).char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        if (!c || c.kind !== "consort" || !state.standing[ch]) {
          bad(index, "BAD_EFFECT_TARGET", `restore_from_cold_palace needs a consort with standing: "${ch}"`, { char: ch });
        }
        // 幂等：无活跃冷宫效果时 apply 是 no-op，不在此报错。
        break;
      }
      case "set_harem_administration": {
        // 判断凤后禁足现状（或本批中是否存在禁足/解禁凤后的效果）。
        const fenghousId = Object.keys(state.standing).find(
          (id) => state.standing[id]!.rank === "fenghou" && state.standing[id]!.lifecycle !== "deceased",
        );
        const alreadyConfined = fenghousId ? isConfined(state, fenghousId) : false;
        const confinedinBatch = effects.some((be) => be.type === "confine" && (be as { char?: string }).char === fenghousId);
        const liftedInBatch = effects.some((be) => be.type === "lift_confinement" && (be as { char?: string }).char === fenghousId);
        const effectivelyConfined = (alreadyConfined && !liftedInBatch) || confinedinBatch;

        const ns = e.state;
        // PUNISH-3A: empress_confined and no_eligible_consort require empress confinement (existing
        // behaviour). New reasons (imperial_deprivation, empress_illness, imperial_reassignment) are
        // triggered without confinement — sovereign administrative transfer or illness delegation.
        const CONFINEMENT_REASONS = new Set(["empress_confined", "no_eligible_consort"]);
        const requiresConfinement = "reason" in ns && CONFINEMENT_REASONS.has(ns.reason);
        if (ns.mode === "empress") {
          const fenghouInColdPalace = fenghousId ? isInColdPalace(state, fenghousId) : false;
          if (effectivelyConfined) {
            bad(index, "BAD_EFFECT", "cannot set haremAdministration to empress while empress is confined", {});
          } else if (fenghouInColdPalace) {
            bad(index, "BAD_EFFECT", "cannot set haremAdministration to empress while empress is in cold palace", {});
          }
        } else if (ns.mode === "acting_consort") {
          if (requiresConfinement && !effectivelyConfined) {
            bad(index, "BAD_EFFECT", "acting_consort mode with reason=empress_confined requires empress to be confined", {});
          } else {
            const c = db.characters[ns.charId] ?? state.generatedConsorts[ns.charId];
            const st = state.standing[ns.charId];
            if (!c || c.kind !== "consort" || !st) {
              bad(index, "BAD_EFFECT_TARGET", `acting consort "${ns.charId}" not found`, { char: ns.charId });
            } else if (st.rank === "fenghou") {
              bad(index, "BAD_EFFECT", `acting consort cannot be fenghou: "${ns.charId}"`, { char: ns.charId });
            } else if (st.lifecycle === "deceased" || st.lifecycle === "candidate") {
              bad(index, "BAD_EFFECT_TARGET", `acting consort is deceased or candidate: "${ns.charId}"`, { char: ns.charId });
            } else {
              const eligible = eligibleHaremAdministrators(db, state);
              if (!eligible.some((c) => c.id === ns.charId)) {
                bad(index, "BAD_EFFECT", `character "${ns.charId}" is not eligible to administer the harem`, {});
              }
            }
          }
        } else {
          // neiwu_proxy
          if (requiresConfinement && !effectivelyConfined) {
            bad(index, "BAD_EFFECT", "neiwu_proxy mode with reason=empress_confined requires empress to be confined", {});
          }
        }
        break;
      }
    }
  });
  return errors;
}

/**
 * Atomic batch apply. On success returns a NEW state object; the input state
 * is never mutated. On failure returns ALL collected errors and the caller's
 * state stays exactly what it was.
 */
export interface EffectContext {
  /** Stamped onto memory entries as their origin trace (debug: which scene wrote this). */
  sceneId?: string;
  /** Dev-only trace collector; undefined = tracing off (production). Never changes game behaviour. */
  collector?: TraceCollector;
  /** Allow internal-only effect types (send_to_cold_palace, restore_from_cold_palace).
   *  Only commitPlannedTransaction sets this to true. */
  allowInternalEffects?: boolean;
}

/** Human-readable one-line summary of an effect's intent (for trace panel). */
function describeEffect(effect: EventEffect): string {
  switch (effect.type) {
    case "favor": return `favor ${effect.char} ${effect.delta >= 0 ? "+" : ""}${effect.delta}`;
    case "resource": return `resource ${effect.pillar}.${effect.field} ${effect.delta >= 0 ? "+" : ""}${effect.delta}`;
    case "memory": return `memory ${effect.char}: "${effect.entry.summary.length > 50 ? effect.entry.summary.slice(0, 50) + "…" : effect.entry.summary}"`;
    case "flag": return `flag ${effect.key}=${effect.value}`;
    case "set_rank": return `set_rank ${effect.char} → ${effect.rank}`;
    case "set_title": return `set_title ${effect.char} "${effect.title}"`;
    case "remove_title": return `remove_title ${effect.char}`;
    case "relocate": return `relocate ${effect.char} → ${effect.location}`;
    case "bedchamber": return `bedchamber ${effect.char} mode=${effect.mode}`;
    case "pregnancy": return `pregnancy op=${effect.op}`;
    case "pregnancy_transfer": return `pregnancy_transfer → ${effect.carrierId} at month ${effect.atMonth}`;
    case "pregnancy_abort": return "pregnancy_abort";
    case "consort_miscarriage": return `consort_miscarriage ${effect.carrierId}`;
    case "birth": return `birth bearer=${effect.bearer} sex=${effect.sex} outcome=${effect.bearerOutcome}`;
    case "heir_designate": return `heir_designate [${effect.charIds.join(",")}]`;
    case "heir_candidate": return `heir_candidate ${effect.char} op=${effect.op}`;
    case "heir_name": return `heir_name ${effect.heirId} ${effect.field}="${effect.name}"`;
    case "heir_summon": return `heir_summon ${effect.heirId}`;
    case "heir_educate": return `heir_educate ${effect.heirId} ${effect.subject}`;
    case "heir_adopt": return `heir_adopt ${effect.heirId}`;
    case "child_favor": return `child_favor ${effect.heirId} ${effect.delta >= 0 ? "+" : ""}${effect.delta}`;
    case "heir_died": return `heir_died ${effect.heirId}`;
    case "heir_decease": return `heir_decease ${effect.heirId}`;
    case "set_sovereign_health": return `set_sovereign_health${effect.healthDelta !== undefined ? ` delta=${effect.healthDelta}` : ""}${effect.healthStatus !== undefined ? ` status=${effect.healthStatus}` : ""}`;
    case "set_taihou_health": return `set_taihou_health${effect.healthDelta !== undefined ? ` delta=${effect.healthDelta}` : ""}`;
    case "taihou_decease": return `taihou_decease at=${effect.at.year}-${effect.at.month}`;
    case "set_consort_health": return `set_consort_health ${effect.char}${effect.healthDelta !== undefined ? ` delta=${effect.healthDelta}` : ""}`;
    case "consort_decease": return `consort_decease ${effect.char} cause=${effect.cause}`;
    case "set_heir_health": return `set_heir_health ${effect.heirId}`;
    case "set_bloodline_status": return `set_bloodline_status ${effect.value}`;
    case "set_consort_posthumous": return `set_consort_posthumous ${effect.char}`;
    case "confine": return `confine ${effect.char}${effect.endTurnExclusive !== null ? ` until turn ${effect.endTurnExclusive}` : " (indefinite)"}`;
    case "lift_confinement": return `lift_confinement ${effect.char} reason=${effect.reason}`;
    case "send_to_cold_palace": return `send_to_cold_palace ${(effect as { char: string }).char}`;
    case "restore_from_cold_palace": return `restore_from_cold_palace ${(effect as { char: string }).char}`;
    case "set_harem_administration": return `set_harem_administration mode=${effect.state.mode}`;
    case "enqueue_aftermath": return `enqueue_aftermath kind=${effect.kind} subject=${effect.subjectId}`;
    case "record_physician_visit": return `record_physician_visit month=${effect.monthKey}`;
    case "adjust_consort_attr": return `adjust_consort_attr ${effect.char}.${effect.field} ${effect.delta >= 0 ? "+" : ""}${effect.delta}`;
    default: return (effect as { type: string }).type;
  }
}

export function applyEffects(
  db: ContentDB,
  state: GameState,
  effects: readonly EventEffect[],
  context: EffectContext = {},
): Result<GameState, GameError[]> {
  if (!context.allowInternalEffects) {
    const INTERNAL_ONLY = new Set(["send_to_cold_palace", "restore_from_cold_palace"]);
    for (const [i, e] of effects.entries()) {
      if (INTERNAL_ONLY.has((e as { type: string }).type)) {
        return err([stateError("BAD_EFFECT", `effect #${i}: "${(e as { type: string }).type}" is internal-only and requires a JusticePlan`)]);
      }
    }
  }
  const errors = validateEffects(db, state, effects);
  if (errors.length > 0) return err(errors);

  const { collector } = context;

  const next = structuredClone(state) as GameState;
  const now = toGameTime(state.calendar);
  const cumulative = new Map<string, number>();

  /**
   * 把当前所有「候选承嗣」注释回退为 normal（except 中的 id 除外），用于传嗣/流产/
   * 改选候选时清理旧注释。仅影响 lifecycle==="candidate" 的侍君。
   */
  const resetCandidateAnnotations = (s: GameState, except: readonly string[] = []) => {
    for (const id of s.resources.bloodline.pregnancy.candidateIds) {
      if (except.includes(id)) continue;
      const st = s.standing[id];
      if (st && st.lifecycle === "candidate") st.lifecycle = "normal";
    }
  };

  /** Cumulative per-axis cap: returns the effective delta still allowed. */
  const cappedDelta = (axis: string, delta: number): number => {
    const before = cumulative.get(axis) ?? 0;
    const after = Math.min(AXIS_CAP, Math.max(-AXIS_CAP, before + delta));
    cumulative.set(axis, after);
    return after - before;
  };

  for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
    const effect = effects[effectIndex]!;
    // Per-effect snapshot (dev-only): captures ALL mutations for this effect.
    const beforeEffect = collector ? (structuredClone(next) as GameState) : undefined;
    switch (effect.type) {
      case "favor": {
        const target = next.standing[effect.char]!;
        const applied = cappedDelta(`favor:${effect.char}`, effect.delta);
        target.favor = clampPct(target.favor + applied);
        break;
      }
      case "adjust_consort_attr": {
        // Bypasses AXIS_CAP — the punishment consequence planner is responsible
        // for ensuring per-field aggregated deltas are reasonable.
        const target = next.standing[effect.char]!;
        const current = resolveConsortRuntimeAttrs(db, next, effect.char)[effect.field];
        target[effect.field] = clampPct(current + effect.delta);
        break;
      }
      case "resource": {
        const applied = cappedDelta(`res:${effect.pillar}:${effect.field}`, effect.delta);
        if (effect.pillar === "sovereign") {
          next.resources.sovereign[effect.field] = clampPct(next.resources.sovereign[effect.field] + applied);
        } else {
          next.resources.nation[effect.field] = clampPct(next.resources.nation[effect.field] + applied);
        }
        break;
      }
      case "set_bloodline_status": {
        next.resources.bloodline.menstrualStatus = effect.value;
        break;
      }
      case "flag": {
        next.flags[effect.key] = effect.value;
        break;
      }
      case "set_rank": {
        next.standing[effect.char]!.rank = effect.rank;
        break;
      }
      case "set_title": {
        next.standing[effect.char]!.title = effect.title;
        break;
      }
      case "remove_title": {
        delete next.standing[effect.char]!.title;
        break;
      }
      case "relocate": {
        const target = next.standing[effect.char]!;
        target.residence = effect.location;
        target.chamber = effect.chamber;
        break;
      }
      case "bedchamber": {
        next.bedchamber[effect.char]!.encounters.push({
          at: now,
          mode: effect.mode,
        });
        break;
      }
      case "pregnancy": {
        const p = next.resources.bloodline.pregnancy;
        if (effect.op === "begin") {
          next.resources.bloodline.pregnancy = { status: "pending", conceivedAt: now, candidateIds: [] };
        } else if (effect.op === "carry") {
          // pending → carrying: 帝王自孕，新增一条 carrier="sovereign" 的胎息。
          next.resources.bloodline.pregnancy = {
            status: "carrying",
            ...(p.conceivedAt !== undefined ? { conceivedAt: p.conceivedAt } : {}),
            candidateIds: [...p.candidateIds],
          };
          if (p.conceivedAt !== undefined) {
            next.resources.bloodline.gestations.push({ carrier: "sovereign", conceivedAt: p.conceivedAt });
          }
        } else {
          // clear: 作废帝王自身胎息，不影响侍君承嗣；清理候选注释。
          resetCandidateAnnotations(next);
          next.resources.bloodline.pregnancy = { status: "none", candidateIds: [] };
          next.resources.bloodline.gestations = next.resources.bloodline.gestations.filter(
            (g) => g.carrier !== "sovereign",
          );
        }
        break;
      }
      case "heir_designate": {
        // reset any prior candidate no longer in the designated set
        resetCandidateAnnotations(next, effect.charIds);
        for (const id of effect.charIds) next.standing[id]!.lifecycle = "candidate";
        next.resources.bloodline.pregnancy.candidateIds = [...effect.charIds];
        break;
      }
      case "heir_candidate": {
        const preg = next.resources.bloodline.pregnancy;
        if (effect.op === "add") {
          // 同时段只能有一位候选：先清除旧候选注释。
          resetCandidateAnnotations(next);
          next.standing[effect.char]!.lifecycle = "candidate";
          preg.candidateIds = [effect.char];
        } else {
          if (next.standing[effect.char]!.lifecycle === "candidate") {
            next.standing[effect.char]!.lifecycle = "normal";
          }
          preg.candidateIds = preg.candidateIds.filter((id) => id !== effect.char);
        }
        break;
      }
      case "pregnancy_transfer": {
        const sov = next.resources.bloodline.gestations.find((g) => g.carrier === "sovereign")!;
        // 传嗣：除最终承嗣者外，清除所有候选承嗣注释。
        resetCandidateAnnotations(next, [effect.carrierId]);
        next.resources.bloodline.pregnancy = { status: "none", candidateIds: [] };
        next.resources.bloodline.gestations = next.resources.bloodline.gestations.filter(
          (g) => g.carrier !== "sovereign",
        );
        next.resources.bloodline.gestations.push({
          carrier: effect.carrierId,
          conceivedAt: sov.conceivedAt,
          fatherId: effect.carrierId,
          transferredAtMonth: effect.atMonth,
        });
        next.standing[effect.carrierId]!.lifecycle = "carrying";
        break;
      }
      case "pregnancy_abort": {
        // 流产：清除帝王自身胎息与所有候选承嗣注释；侍君承嗣不受影响。
        resetCandidateAnnotations(next);
        next.resources.bloodline.pregnancy = { status: "none", candidateIds: [] };
        next.resources.bloodline.gestations = next.resources.bloodline.gestations.filter(
          (g) => g.carrier !== "sovereign",
        );
        break;
      }
      case "consort_miscarriage": {
        // 侍君小产：仅断该侍君那条承嗣胎息，位分生命周期回 normal；帝王自孕不受影响。
        const bl = next.resources.bloodline;
        bl.gestations = bl.gestations.filter((g) => g.carrier !== effect.carrierId);
        const st = next.standing[effect.carrierId];
        if (st && st.lifecycle === "carrying") st.lifecycle = "normal";
        break;
      }
      case "birth": {
        const bl = next.resources.bloodline;
        const childSurvives = effect.bearerOutcome === "safe" || effect.bearerOutcome === "bearer_dies";
        if (childSurvives) {
          const makeHeir = (sex: typeof effect.sex, favor: number) => ({
            id: nextHeirId(bl.heirs.length),
            sex,
            fatherId: effect.fatherId,
            bearer: effect.bearer,
            birthAt: now,
            favor,
            legitimate: effect.legitimate,
            petName: "",
            education: { scholarship: 5, martial: 5, virtue: 5 },
            health: 60,
            talent: 50,
            diligence: 50,
            ambition: 20,
            closeness: 50,
            support: 20,
            faction: "none" as const,
            lifecycle: "alive" as const,
            healthStatus: "healthy" as const,
          });
          bl.heirs.push(makeHeir(effect.sex, effect.favor));
          if (effect.twinSex !== undefined && effect.twinFavor !== undefined) {
            bl.heirs.push(makeHeir(effect.twinSex, effect.twinFavor));
          }
        }
        if (effect.bearer !== "sovereign") {
          const st = next.standing[effect.bearer];
          if (st) {
            if (effect.bearerOutcome === "safe") {
              st.lifecycle = "delivered";
              if (effect.recoverUntilMonth !== undefined) st.recoverUntilMonth = effect.recoverUntilMonth;
            } else if (effect.bearerOutcome === "child_dies") {
              st.lifecycle = "normal";
              if (effect.recoverUntilMonth !== undefined) st.recoverUntilMonth = effect.recoverUntilMonth;
            }
            // bearer_dies / both: 母方死亡由后续 consort_decease 统一处理
            //（写 deathRecord.cause="childbirth" + 断胎 + enqueue_aftermath）；此处不置死。
          }
        }
        // 仅移除生产对应的那条胎息；帝王可能另有自孕，故只在自孕生产时才清 pregnancy。
        bl.gestations = bl.gestations.filter((g) => g.carrier !== effect.bearer);
        if (effect.bearer === "sovereign") {
          bl.pregnancy = { status: "none", candidateIds: [] };
        }
        break;
      }
      case "heir_name": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        if (effect.field === "pet") heir.petName = effect.name;
        else heir.givenName = effect.name;
        break;
      }
      case "heir_summon": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        heir.favor = clampPct(heir.favor + 20);
        break;
      }
      case "heir_educate": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        heir.education[effect.subject] = clampPct(heir.education[effect.subject] + effect.attrDelta);
        heir.favor = clampPct(heir.favor + effect.favorDelta);
        break;
      }
      case "heir_adopt": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        heir.adoptiveFatherId = effect.fatherId;
        break;
      }
      case "child_favor": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const applied = cappedDelta(`heir:${effect.heirId}`, effect.delta);
        heir.favor = clampPct(heir.favor + applied);
        break;
      }
      case "heir_died": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        heir.lifecycle = "deceased";
        heir.deceasedAt = now;
        break;
      }
      case "set_sovereign_health": {
        if (effect.healthDelta !== undefined) next.resources.sovereign.health = clampPct(next.resources.sovereign.health + effect.healthDelta);
        if (effect.healthStatus !== undefined) next.resources.sovereign.healthStatus = effect.healthStatus;
        break;
      }
      case "set_consort_health": {
        const st = next.standing[effect.char]!;
        if (effect.healthDelta !== undefined) st.health = clampPct((st.health ?? 100) + effect.healthDelta);
        if (effect.healthStatus !== undefined) st.healthStatus = effect.healthStatus;
        break;
      }
      case "set_taihou_health": {
        if (effect.healthDelta !== undefined) next.taihou.health = clampPct(next.taihou.health + effect.healthDelta);
        if (effect.healthStatus !== undefined) next.taihou.healthStatus = effect.healthStatus;
        break;
      }
      case "set_heir_health": {
        const h = next.resources.bloodline.heirs.find((x) => x.id === effect.heirId);
        if (h) {
          if (effect.healthDelta !== undefined) h.health = clampPct(h.health + effect.healthDelta);
          if (effect.healthStatus !== undefined) h.healthStatus = effect.healthStatus;
        }
        break;
      }
      case "record_physician_visit": {
        const sub = effect.subject;
        if (sub.kind === "sovereign") {
          next.resources.sovereign.lastPhysicianVisitMonthKey = effect.monthKey;
        } else if (sub.kind === "taihou") {
          next.taihou.lastPhysicianVisitMonthKey = effect.monthKey;
        } else if (sub.kind === "consort") {
          const st = next.standing[sub.id];
          if (st) {
            st.lastPhysicianVisitMonthKey = effect.monthKey;
          }
        } else {
          const h = next.resources.bloodline.heirs.find((x) => x.id === sub.id);
          if (h) {
            h.lastPhysicianVisitMonthKey = effect.monthKey;
          }
        }
        break;
      }
      case "set_consort_posthumous": {
        const st = next.standing[effect.char]!;
        if (st.deathRecord) {
          if (effect.posthumousRankId !== undefined) {
            st.deathRecord.posthumousRankId = effect.posthumousRankId;
          }
          if (effect.posthumousEpithet !== undefined) {
            st.deathRecord.posthumousEpithet = effect.posthumousEpithet;
          }
        }
        break;
      }
      case "confine": {
        const newSe = {
          id: nextStatusEffectId(next, effect.char),
          kind: "confinement" as const,
          characterId: effect.char,
          startTurn: effect.startTurn,
          endTurnExclusive: effect.endTurnExclusive,
          imposedAt: effect.imposedAt,
          imposedBy: "emperor" as const,
          ...(effect.sourceLocation !== undefined ? { sourceLocation: effect.sourceLocation } : {}),
          ...(effect.sourcePunishmentId !== undefined ? { sourcePunishmentId: effect.sourcePunishmentId } : {}),
        };
        next.statusEffects.push(newSe);
        // 取消与禁足冲突的留宿/免请安计划（角色被锁在本宫）。
        if (next.overnightWith?.charId === effect.char) delete next.overnightWith;
        if (next.excusedFromGreeting?.charIds.includes(effect.char)) {
          next.excusedFromGreeting = {
            ...next.excusedFromGreeting,
            charIds: next.excusedFromGreeting.charIds.filter((id) => id !== effect.char),
          };
        }
        // Canonical path: statusEffects.<id> — matches ID-aligned boundary diff.
        break;
      }
      case "lift_confinement": {
        const turn = effect.at.dayIndex;
        for (const se of next.statusEffects) {
          if (se.kind !== "confinement" || se.characterId !== effect.char || se.liftedTurn !== undefined) continue;
          if (effect.reason === "term_expired") {
            // 期满结案：只收掉到期记录，liftedTurn = 自动到期旬（独占上界）。
            if (se.endTurnExclusive !== null && turn >= se.endTurnExclusive) {
              se.liftedTurn = se.endTurnExclusive;
              se.liftedAt = effect.at;
              se.liftReason = "term_expired";
              // Canonical path: statusEffects.<id>.liftedTurn — matches ID-aligned boundary diff.
            }
          } else if (turn >= se.startTurn && (se.endTurnExclusive === null || turn < se.endTurnExclusive)) {
            // 皇帝下旨解除：收掉当旬活跃记录，当旬立即失效。
            se.liftedTurn = turn;
            se.liftedAt = effect.at;
            se.liftReason = "lifted_by_emperor";
          }
        }
        // 凤后禁足解除：主理权自动归还（手动解除与自动到期均走此路径）。
        // Guard: do NOT restore if the empress is currently in the cold palace.
        if (next.standing[effect.char]?.rank === "fenghou"
            && next.haremAdministration.mode !== "empress"
            && !isInColdPalace(next, effect.char, next.calendar.dayIndex)) {
          next.haremAdministration = { mode: "empress" };
        }
        break;
      }
      case "send_to_cold_palace": {
        const e = effect as {
          char: string; statusEffectId: string; punishmentId: string;
          coldPalaceResidenceId: string; previousResidenceId: string;
          previousChamber?: string; startedAt: GameTime; startTurn: number;
        };
        const ch = e.char;
        const coldPalaceEntry: ColdPalaceEffect = {
          id: e.statusEffectId,
          kind: "cold_palace",
          characterId: ch,
          startedAt: e.startedAt,
          startTurn: e.startTurn,
          previousResidenceId: e.previousResidenceId,
          ...(e.previousChamber !== undefined ? { previousChamber: e.previousChamber as ChamberId } : {}),
          coldPalaceResidenceId: e.coldPalaceResidenceId,
          sourcePunishmentId: e.punishmentId,
        };
        next.statusEffects.push(coldPalaceEntry);
        next.standing[ch]!.residence = e.coldPalaceResidenceId;
        // Clear overnight schedule if it involves this character.
        if (next.overnightWith?.charId === ch) delete next.overnightWith;
        // Clear excusedFromGreeting for cold-palace-bound consort.
        if (next.excusedFromGreeting?.charIds.includes(ch)) {
          next.excusedFromGreeting = {
            ...next.excusedFromGreeting,
            charIds: next.excusedFromGreeting.charIds.filter((id) => id !== ch),
          };
        }
        // Cold palace empress cannot administer harem — transfer to neiwu_proxy fallback.
        if (next.standing[ch]?.rank === "fenghou" && next.haremAdministration.mode === "empress") {
          next.haremAdministration = {
            mode: "neiwu_proxy",
            appointedAt: toGameTime(next.calendar),
            reason: "imperial_deprivation",
          };
        }
        // If the target is the current acting consort admin, find a real replacement.
        if (
          next.haremAdministration.mode === "acting_consort" &&
          (next.haremAdministration as { charId: string }).charId === ch
        ) {
          // At this point ch's residence is already changed to changmengong,
          // so eligibleHaremAdministrators(db, next) will correctly exclude them.
          const eligible = eligibleHaremAdministrators(db, next);
          if (eligible.length > 0) {
            next.haremAdministration = {
              mode: "acting_consort",
              charId: eligible[0]!.id,
              appointedAt: toGameTime(next.calendar),
              reason: "imperial_reassignment",
            };
          } else {
            next.haremAdministration = {
              mode: "neiwu_proxy",
              appointedAt: toGameTime(next.calendar),
              reason: "no_eligible_consort",
            };
          }
        }
        break;
      }
      case "restore_from_cold_palace": {
        const e = effect as {
          char: string; liftReason: "lifted_by_emperor" | "pardoned";
          restoreResidenceId?: string; restoreChamber?: string;
          liftedAt: GameTime; liftedTurn: number;
        };
        const ch = e.char;
        const active = activeColdPalaceEffectFor(next, ch, next.calendar.dayIndex);
        if (active) {
          active.liftedAt = e.liftedAt;
          active.liftedTurn = e.liftedTurn;
          active.liftReason = e.liftReason;
        }
        if (e.restoreResidenceId) {
          next.standing[ch]!.residence = e.restoreResidenceId;
        }
        if (e.restoreChamber) {
          next.standing[ch]!.chamber = e.restoreChamber as ChamberId;
        }
        break;
      }
      case "set_harem_administration": {
        next.haremAdministration = effect.state;
        break;
      }
      case "consort_decease": {
        const st = next.standing[effect.char];
        if (st && st.lifecycle !== "deceased") {       // idempotent: skip if already dead
          st.lifecycle = "deceased";
          delete st.recoverUntilMonth; // 清陈旧休养截止月（顺产/child_dies 先写 recoverUntilMonth，成本随后致死时勿留「已故仍在休养」状态）
          st.deathRecord = {
            diedAt: effect.at,
            cause: effect.cause,
            originalRankId: st.rank,
            ...(st.title !== undefined ? { originalTitle: st.title } : {}),
          };
        }
        next.resources.bloodline.gestations = next.resources.bloodline.gestations.filter((g) => g.carrier !== effect.char); // 断胎
        // 统一死亡清理：作废活跃禁足/冷宫等持续状态、清留宿与免请安计划。
        for (const se of next.statusEffects) {
          if (se.characterId === effect.char && se.liftedTurn === undefined) {
            if (se.kind === "confinement" || se.kind === "cold_palace") {
              se.liftedTurn = effect.at.dayIndex;
              se.liftedAt = effect.at;
            }
          }
        }
        // Resolve all active PunishmentRecords for the deceased character.
        // The execution PunishmentRecord (if any) is created AFTER effects run in commitPlannedTransaction,
        // so it doesn't exist yet when consort_decease fires — the guard is unnecessary.
        for (const punId of Object.keys(next.justice.punishments)) {
          const pun = next.justice.punishments[punId]!;
          if (pun.targetId === effect.char && pun.lifecycle.status === "active") {
            next.justice.punishments[punId] = {
              ...pun,
              lifecycle: { status: "completed" as const, resolvedAt: effect.at, resolution: "target_deceased" as const },
            };
          }
        }
        if (next.overnightWith?.charId === effect.char) delete next.overnightWith;
        if (next.excusedFromGreeting?.charIds.includes(effect.char)) {
          next.excusedFromGreeting = {
            ...next.excusedFromGreeting,
            charIds: next.excusedFromGreeting.charIds.filter((id) => id !== effect.char),
          };
        }
        break;
      }
      case "heir_decease": {
        const h = next.resources.bloodline.heirs.find((x) => x.id === effect.heirId);
        if (h && h.lifecycle !== "deceased") { h.lifecycle = "deceased"; h.deceasedAt = effect.at; }
        break;
      }
      case "taihou_decease": {
        if (!next.taihou.deceased) {
          next.taihou.deceased = true;
          next.taihou.diedAt = effect.at;
          next.taihou.mourningUntilDayExclusive = effect.at.dayIndex + 3; // 死亡当日计第1日，独占上界
        }
        break;
      }
      case "enqueue_aftermath": {
        if (!next.pendingAftermath.some((a) => a.id === effect.id)) {
          next.pendingAftermath.push({
            id: effect.id,
            kind: effect.kind,
            subjectId: effect.subjectId,
            at: effect.at,
            resolved: false,
          });
          collector?.recordQueueEvent({
            queue: "pendingAftermath",
            operation: "enqueued",
            itemId: effect.id,
            itemType: effect.kind,
            phase: collector.currentPhase,
          });
        }
        break;
      }
      case "memory": {
        const store = next.memories[effect.char]!;
        const d = effect.entry;
        const newEntry = {
          id: memoryEntryId(effect.char, store.nextSeq),
          ownerId: effect.char,
          kind: d.kind,
          ...(d.sourceEventId !== undefined ? { sourceEventId: d.sourceEventId } : {}),
          ...(d.sourcePunishmentId !== undefined ? { sourcePunishmentId: d.sourcePunishmentId } : {}),
          ...(d.sourceCaseId !== undefined ? { sourceCaseId: d.sourceCaseId } : {}),
          subjectIds: [...d.subjectIds],
          perspective: d.perspective,
          summary: d.summary,
          strength: d.strength,
          retention: d.retention,
          emotions: { ...d.emotions },
          triggerTags: [...d.triggerTags],
          unresolved: d.unresolved,
          createdAt: now,
        };
        store.entries.push(newEntry);
        store.nextSeq += 1;
        if (collector) {
          if (d.sourceEventId !== undefined) {
            collector.recordMemoryEvent({
              operation: "propagated",
              ownerId: effect.char,
              entryId: newEntry.id,
              sourceCourtEventId: d.sourceEventId,
              summary: d.summary,
              effectType: "memory",
              effectIndex,
              phase: collector.currentPhase,
            });
          } else {
            collector.recordMemoryEvent({
              operation: "created",
              ownerId: effect.char,
              entryId: newEntry.id,
              summary: d.summary,
              effectType: "memory",
              effectIndex,
              phase: collector.currentPhase,
            });
          }
        }
        break;
      }
    }
    if (beforeEffect !== undefined) {
      collector!.captureEffectDiff(effect.type, effectIndex, diffGameState(beforeEffect, next), describeEffect(effect));
    }
  }

  // 批后不变量：若协理者因本批效果（禁足/赐死/疾毙等）失格，切换内务府代理。
  // 注意：命令层负责询问玩家选新协理者；此处仅兜底处置非玩家触发的失格（如疾病身亡）。
  const beforeInvariant = collector ? (structuredClone(next) as GameState) : undefined;
  if (next.haremAdministration.mode === "acting_consort") {
    const adminId = next.haremAdministration.charId;
    const eligible = eligibleHaremAdministrators(db, next);
    if (!eligible.some((c) => c.id === adminId)) {
      next.haremAdministration = {
        mode: "neiwu_proxy",
        appointedAt: toGameTime(next.calendar),
        reason: "no_eligible_consort",
      };
    }
  }
  if (beforeInvariant !== undefined) {
    const diffs = diffGameState(beforeInvariant, next);
    if (diffs.length > 0) collector!.captureDerivedDiff("post_batch_harem_administration", diffs);
  }

  return ok(next);
}
