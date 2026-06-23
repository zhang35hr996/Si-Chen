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
import { toGameTime } from "../calendar/time";
import { chamberOf, hasChambers } from "../characters/chambers";
import { isConfined, nextStatusEffectId } from "../characters/confinement";
import { eligibleHaremAdministrators } from "../characters/haremAdministration";
import { canAdministratorAdjustRank, canEmpressAdjustRank } from "../characters/haremRankAuthority";
import { nextHeirId } from "../characters/heirs";
import { getCharacterLocation } from "../characters/presence";
import type { ContentDB } from "../content/loader";
import { eventEffectSchema, type EventEffect } from "../content/schemas";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import { memoryEntryId } from "../state/newGame";
import type { GameState } from "../state/types";

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
        if (!db.characters[e.char] || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `unknown standing target "${e.char}"`, { char: e.char });
        }
        break;
      case "memory":
        if (!db.characters[e.char] || !state.memories[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `unknown memory target "${e.char}"`, { char: e.char });
        }
        break;
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
        if (ns.mode === "empress") {
          if (effectivelyConfined) {
            bad(index, "BAD_EFFECT", "cannot set haremAdministration to empress while empress is confined", {});
          }
        } else if (ns.mode === "acting_consort") {
          if (!effectivelyConfined) {
            bad(index, "BAD_EFFECT", "acting_consort mode requires empress to be confined", {});
          } else {
            const c = db.characters[ns.charId] ?? state.generatedConsorts[ns.charId];
            const st = state.standing[ns.charId];
            if (!c || c.kind !== "consort" || !st) {
              bad(index, "BAD_EFFECT_TARGET", `acting consort "${ns.charId}" not found`, { char: ns.charId });
            } else if (st.rank === "fenghou") {
              bad(index, "BAD_EFFECT", `acting consort cannot be fenghou: "${ns.charId}"`, { char: ns.charId });
            } else if (st.lifecycle === "deceased" || st.lifecycle === "candidate") {
              bad(index, "BAD_EFFECT_TARGET", `acting consort is deceased or candidate: "${ns.charId}"`, { char: ns.charId });
            }
          }
        } else {
          // neiwu_proxy
          if (!effectivelyConfined) {
            bad(index, "BAD_EFFECT", "neiwu_proxy mode requires empress to be confined", {});
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
}

export function applyEffects(
  db: ContentDB,
  state: GameState,
  effects: readonly EventEffect[],
  context: EffectContext = {},
): Result<GameState, GameError[]> {
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
    switch (effect.type) {
      case "favor": {
        const target = next.standing[effect.char]!;
        const before = target.favor;
        const applied = cappedDelta(`favor:${effect.char}`, effect.delta);
        target.favor = clampPct(target.favor + applied);
        collector?.record({
          effectType: "favor", effectIndex,
          path: `standing.${effect.char}.favor`,
          before, after: target.favor, delta: target.favor - before,
          reason: `favor ${effect.delta >= 0 ? "+" : ""}${effect.delta}${applied !== effect.delta ? ` (capped from ${effect.delta > 0 ? "+" : ""}${effect.delta})` : ""}`,
        });
        break;
      }
      case "resource": {
        const applied = cappedDelta(`res:${effect.pillar}:${effect.field}`, effect.delta);
        if (effect.pillar === "sovereign") {
          const before = next.resources.sovereign[effect.field];
          next.resources.sovereign[effect.field] = clampPct(next.resources.sovereign[effect.field] + applied);
          collector?.record({
            effectType: "resource", effectIndex,
            path: `resources.sovereign.${effect.field}`,
            before, after: next.resources.sovereign[effect.field], delta: next.resources.sovereign[effect.field] - before,
            reason: `sovereign.${effect.field} ${effect.delta >= 0 ? "+" : ""}${effect.delta}${applied !== effect.delta ? " (capped)" : ""}`,
          });
        } else {
          const before = next.resources.nation[effect.field];
          next.resources.nation[effect.field] = clampPct(next.resources.nation[effect.field] + applied);
          collector?.record({
            effectType: "resource", effectIndex,
            path: `resources.nation.${effect.field}`,
            before, after: next.resources.nation[effect.field], delta: next.resources.nation[effect.field] - before,
            reason: `nation.${effect.field} ${effect.delta >= 0 ? "+" : ""}${effect.delta}${applied !== effect.delta ? " (capped)" : ""}`,
          });
        }
        break;
      }
      case "set_bloodline_status": {
        const before = next.resources.bloodline.menstrualStatus;
        next.resources.bloodline.menstrualStatus = effect.value;
        collector?.record({
          effectType: "set_bloodline_status", effectIndex,
          path: "resources.bloodline.menstrualStatus",
          before, after: effect.value,
        });
        break;
      }
      case "flag": {
        const before = next.flags[effect.key];
        next.flags[effect.key] = effect.value;
        collector?.record({
          effectType: "flag", effectIndex,
          path: `flags.${effect.key}`,
          before, after: effect.value,
        });
        break;
      }
      case "set_rank": {
        const before = next.standing[effect.char]!.rank;
        next.standing[effect.char]!.rank = effect.rank;
        collector?.record({
          effectType: "set_rank", effectIndex,
          path: `standing.${effect.char}.rank`,
          before, after: effect.rank,
          reason: `${before} → ${effect.rank}`,
        });
        break;
      }
      case "set_title": {
        const before = next.standing[effect.char]!.title;
        next.standing[effect.char]!.title = effect.title;
        collector?.record({
          effectType: "set_title", effectIndex,
          path: `standing.${effect.char}.title`,
          before, after: effect.title,
        });
        break;
      }
      case "remove_title": {
        const before = next.standing[effect.char]!.title;
        delete next.standing[effect.char]!.title;
        collector?.record({
          effectType: "remove_title", effectIndex,
          path: `standing.${effect.char}.title`,
          before, after: undefined,
        });
        break;
      }
      case "relocate": {
        const target = next.standing[effect.char]!;
        const beforeRes = target.residence;
        const beforeCh = target.chamber;
        target.residence = effect.location;
        target.chamber = effect.chamber;
        collector?.record({
          effectType: "relocate", effectIndex,
          path: `standing.${effect.char}.residence`,
          before: beforeRes, after: effect.location,
        });
        collector?.record({
          effectType: "relocate", effectIndex,
          path: `standing.${effect.char}.chamber`,
          before: beforeCh, after: effect.chamber,
        });
        break;
      }
      case "bedchamber": {
        const before = next.bedchamber[effect.char]!.encounters.length;
        next.bedchamber[effect.char]!.encounters.push({
          at: now,
          mode: effect.mode,
        });
        collector?.record({
          effectType: "bedchamber", effectIndex,
          path: `bedchamber.${effect.char}.encounters`,
          before, after: before + 1, delta: 1,
          reason: `mode=${effect.mode}`,
        });
        break;
      }
      case "pregnancy": {
        const p = next.resources.bloodline.pregnancy;
        const beforeStatus = p.status;
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
        collector?.record({
          effectType: "pregnancy", effectIndex,
          path: "resources.bloodline.pregnancy.status",
          before: beforeStatus, after: next.resources.bloodline.pregnancy.status,
          reason: `op=${effect.op}`,
        });
        break;
      }
      case "heir_designate": {
        const beforeCandidates = [...next.resources.bloodline.pregnancy.candidateIds];
        // reset any prior candidate no longer in the designated set
        resetCandidateAnnotations(next, effect.charIds);
        for (const id of effect.charIds) next.standing[id]!.lifecycle = "candidate";
        next.resources.bloodline.pregnancy.candidateIds = [...effect.charIds];
        collector?.record({
          effectType: "heir_designate", effectIndex,
          path: "resources.bloodline.pregnancy.candidateIds",
          before: beforeCandidates, after: [...effect.charIds],
        });
        break;
      }
      case "heir_candidate": {
        const preg = next.resources.bloodline.pregnancy;
        const beforeLifecycle = next.standing[effect.char]!.lifecycle;
        const beforeCandidates = [...preg.candidateIds];
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
        collector?.record({
          effectType: "heir_candidate", effectIndex,
          path: `standing.${effect.char}.lifecycle`,
          before: beforeLifecycle, after: next.standing[effect.char]!.lifecycle,
          reason: `op=${effect.op}`,
        });
        collector?.record({
          effectType: "heir_candidate", effectIndex,
          path: "resources.bloodline.pregnancy.candidateIds",
          before: beforeCandidates, after: [...preg.candidateIds],
        });
        break;
      }
      case "pregnancy_transfer": {
        const sov = next.resources.bloodline.gestations.find((g) => g.carrier === "sovereign")!;
        const beforeGestations = next.resources.bloodline.gestations.length;
        const beforeLifecycle = next.standing[effect.carrierId]!.lifecycle;
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
        collector?.record({
          effectType: "pregnancy_transfer", effectIndex,
          path: "resources.bloodline.gestations",
          before: beforeGestations, after: next.resources.bloodline.gestations.length,
          reason: `transfer → ${effect.carrierId}`,
        });
        collector?.record({
          effectType: "pregnancy_transfer", effectIndex,
          path: `standing.${effect.carrierId}.lifecycle`,
          before: beforeLifecycle, after: "carrying",
        });
        break;
      }
      case "pregnancy_abort": {
        // 流产：清除帝王自身胎息与所有候选承嗣注释；侍君承嗣不受影响。
        const beforeAbortStatus = next.resources.bloodline.pregnancy.status;
        resetCandidateAnnotations(next);
        next.resources.bloodline.pregnancy = { status: "none", candidateIds: [] };
        next.resources.bloodline.gestations = next.resources.bloodline.gestations.filter(
          (g) => g.carrier !== "sovereign",
        );
        collector?.record({
          effectType: "pregnancy_abort", effectIndex,
          path: "resources.bloodline.pregnancy.status",
          before: beforeAbortStatus, after: "none",
        });
        break;
      }
      case "consort_miscarriage": {
        // 侍君小产：仅断该侍君那条承嗣胎息，位分生命周期回 normal；帝王自孕不受影响。
        const bl = next.resources.bloodline;
        const beforeMiscarriageLen = bl.gestations.length;
        const beforeMiscarriageLifecycle = next.standing[effect.carrierId]?.lifecycle;
        bl.gestations = bl.gestations.filter((g) => g.carrier !== effect.carrierId);
        const st = next.standing[effect.carrierId];
        if (st && st.lifecycle === "carrying") st.lifecycle = "normal";
        collector?.record({
          effectType: "consort_miscarriage", effectIndex,
          path: "resources.bloodline.gestations",
          before: beforeMiscarriageLen, after: bl.gestations.length,
          reason: `miscarriage: ${effect.carrierId}`,
        });
        if (beforeMiscarriageLifecycle === "carrying") {
          collector?.record({
            effectType: "consort_miscarriage", effectIndex,
            path: `standing.${effect.carrierId}.lifecycle`,
            before: "carrying", after: "normal",
          });
        }
        break;
      }
      case "birth": {
        const bl = next.resources.bloodline;
        const beforeHeirsLen = bl.heirs.length;
        const childSurvives = effect.bearerOutcome === "safe" || effect.bearerOutcome === "bearer_dies";
        if (childSurvives) {
          bl.heirs.push({
            id: nextHeirId(bl.heirs.length),
            sex: effect.sex,
            fatherId: effect.fatherId,
            bearer: effect.bearer,
            birthAt: now,
            favor: effect.favor,
            legitimate: effect.legitimate,
            petName: "",
            education: { scholarship: 5, martial: 5, virtue: 5 },
            // 出生默认值（scaffold：初始化并持久化，逻辑暂不读取）。
            health: 60,
            talent: 50,
            diligence: 50,
            ambition: 20,
            closeness: 50,
            support: 20,
            faction: "none",
            lifecycle: "alive",
            healthStatus: "healthy",
          });
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
        collector?.record({
          effectType: "birth", effectIndex,
          path: "resources.bloodline.heirs",
          before: beforeHeirsLen, after: bl.heirs.length, delta: bl.heirs.length - beforeHeirsLen,
          reason: `${effect.sex}, bearer=${effect.bearer}, outcome=${effect.bearerOutcome}`,
        });
        break;
      }
      case "heir_name": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const beforeName = effect.field === "pet" ? heir.petName : heir.givenName;
        if (effect.field === "pet") heir.petName = effect.name;
        else heir.givenName = effect.name;
        collector?.record({
          effectType: "heir_name", effectIndex,
          path: `resources.bloodline.heirs.${effect.heirId}.${effect.field === "pet" ? "petName" : "givenName"}`,
          before: beforeName, after: effect.name,
        });
        break;
      }
      case "heir_summon": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const before = heir.favor;
        heir.favor = clampPct(heir.favor + 20);
        collector?.record({
          effectType: "heir_summon", effectIndex,
          path: `resources.bloodline.heirs.${effect.heirId}.favor`,
          before, after: heir.favor, delta: heir.favor - before,
        });
        break;
      }
      case "heir_educate": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const beforeAttr = heir.education[effect.subject];
        const beforeFavor = heir.favor;
        heir.education[effect.subject] = clampPct(heir.education[effect.subject] + effect.attrDelta);
        heir.favor = clampPct(heir.favor + effect.favorDelta);
        collector?.record({
          effectType: "heir_educate", effectIndex,
          path: `resources.bloodline.heirs.${effect.heirId}.education.${effect.subject}`,
          before: beforeAttr, after: heir.education[effect.subject], delta: heir.education[effect.subject] - beforeAttr,
        });
        collector?.record({
          effectType: "heir_educate", effectIndex,
          path: `resources.bloodline.heirs.${effect.heirId}.favor`,
          before: beforeFavor, after: heir.favor, delta: heir.favor - beforeFavor,
        });
        break;
      }
      case "heir_adopt": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const before = heir.adoptiveFatherId;
        heir.adoptiveFatherId = effect.fatherId;
        collector?.record({
          effectType: "heir_adopt", effectIndex,
          path: `resources.bloodline.heirs.${effect.heirId}.adoptiveFatherId`,
          before, after: effect.fatherId,
        });
        break;
      }
      case "child_favor": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const before = heir.favor;
        const applied = cappedDelta(`heir:${effect.heirId}`, effect.delta);
        heir.favor = clampPct(heir.favor + applied);
        collector?.record({
          effectType: "child_favor", effectIndex,
          path: `resources.bloodline.heirs.${effect.heirId}.favor`,
          before, after: heir.favor, delta: heir.favor - before,
          reason: `${effect.delta >= 0 ? "+" : ""}${effect.delta}${applied !== effect.delta ? " (capped)" : ""}`,
        });
        break;
      }
      case "heir_died": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const before = heir.lifecycle;
        heir.lifecycle = "deceased";
        heir.deceasedAt = now;
        collector?.record({
          effectType: "heir_died", effectIndex,
          path: `resources.bloodline.heirs.${effect.heirId}.lifecycle`,
          before, after: "deceased",
        });
        break;
      }
      case "set_sovereign_health": {
        const beforeH = next.resources.sovereign.health;
        const beforeSt = next.resources.sovereign.healthStatus;
        if (effect.healthDelta !== undefined) next.resources.sovereign.health = clampPct(next.resources.sovereign.health + effect.healthDelta);
        if (effect.healthStatus !== undefined) next.resources.sovereign.healthStatus = effect.healthStatus;
        if (effect.healthDelta !== undefined) collector?.record({
          effectType: "set_sovereign_health", effectIndex,
          path: "resources.sovereign.health",
          before: beforeH, after: next.resources.sovereign.health, delta: next.resources.sovereign.health - beforeH,
        });
        if (effect.healthStatus !== undefined) collector?.record({
          effectType: "set_sovereign_health", effectIndex,
          path: "resources.sovereign.healthStatus",
          before: beforeSt, after: next.resources.sovereign.healthStatus,
        });
        break;
      }
      case "set_consort_health": {
        const st = next.standing[effect.char]!;
        const beforeH = st.health;
        const beforeSt = st.healthStatus;
        if (effect.healthDelta !== undefined) st.health = clampPct((st.health ?? 100) + effect.healthDelta);
        if (effect.healthStatus !== undefined) st.healthStatus = effect.healthStatus;
        if (effect.healthDelta !== undefined) collector?.record({
          effectType: "set_consort_health", effectIndex,
          path: `standing.${effect.char}.health`,
          before: beforeH, after: st.health, delta: (st.health ?? 0) - (beforeH ?? 100),
        });
        if (effect.healthStatus !== undefined) collector?.record({
          effectType: "set_consort_health", effectIndex,
          path: `standing.${effect.char}.healthStatus`,
          before: beforeSt, after: st.healthStatus,
        });
        break;
      }
      case "set_taihou_health": {
        const beforeH = next.taihou.health;
        const beforeSt = next.taihou.healthStatus;
        if (effect.healthDelta !== undefined) next.taihou.health = clampPct(next.taihou.health + effect.healthDelta);
        if (effect.healthStatus !== undefined) next.taihou.healthStatus = effect.healthStatus;
        if (effect.healthDelta !== undefined) collector?.record({
          effectType: "set_taihou_health", effectIndex,
          path: "taihou.health",
          before: beforeH, after: next.taihou.health, delta: next.taihou.health - beforeH,
        });
        if (effect.healthStatus !== undefined) collector?.record({
          effectType: "set_taihou_health", effectIndex,
          path: "taihou.healthStatus",
          before: beforeSt, after: next.taihou.healthStatus,
        });
        break;
      }
      case "set_heir_health": {
        const h = next.resources.bloodline.heirs.find((x) => x.id === effect.heirId);
        if (h) {
          const beforeH = h.health;
          const beforeSt = h.healthStatus;
          if (effect.healthDelta !== undefined) h.health = clampPct(h.health + effect.healthDelta);
          if (effect.healthStatus !== undefined) h.healthStatus = effect.healthStatus;
          if (effect.healthDelta !== undefined) collector?.record({
            effectType: "set_heir_health", effectIndex,
            path: `resources.bloodline.heirs.${effect.heirId}.health`,
            before: beforeH, after: h.health, delta: h.health - beforeH,
          });
          if (effect.healthStatus !== undefined) collector?.record({
            effectType: "set_heir_health", effectIndex,
            path: `resources.bloodline.heirs.${effect.heirId}.healthStatus`,
            before: beforeSt, after: h.healthStatus,
          });
        }
        break;
      }
      case "record_physician_visit": {
        const sub = effect.subject;
        if (sub.kind === "sovereign") {
          const before = next.resources.sovereign.lastPhysicianVisitMonthKey;
          next.resources.sovereign.lastPhysicianVisitMonthKey = effect.monthKey;
          collector?.record({ effectType: "record_physician_visit", effectIndex, path: "resources.sovereign.lastPhysicianVisitMonthKey", before, after: effect.monthKey });
        } else if (sub.kind === "taihou") {
          const before = next.taihou.lastPhysicianVisitMonthKey;
          next.taihou.lastPhysicianVisitMonthKey = effect.monthKey;
          collector?.record({ effectType: "record_physician_visit", effectIndex, path: "taihou.lastPhysicianVisitMonthKey", before, after: effect.monthKey });
        } else if (sub.kind === "consort") {
          const st = next.standing[sub.id];
          if (st) {
            const before = st.lastPhysicianVisitMonthKey;
            st.lastPhysicianVisitMonthKey = effect.monthKey;
            collector?.record({ effectType: "record_physician_visit", effectIndex, path: `standing.${sub.id}.lastPhysicianVisitMonthKey`, before, after: effect.monthKey });
          }
        } else {
          const h = next.resources.bloodline.heirs.find((x) => x.id === sub.id);
          if (h) {
            const before = h.lastPhysicianVisitMonthKey;
            h.lastPhysicianVisitMonthKey = effect.monthKey;
            collector?.record({ effectType: "record_physician_visit", effectIndex, path: `resources.bloodline.heirs.${sub.id}.lastPhysicianVisitMonthKey`, before, after: effect.monthKey });
          }
        }
        break;
      }
      case "set_consort_posthumous": {
        const st = next.standing[effect.char]!;
        if (st.deathRecord) {
          if (effect.posthumousRankId !== undefined) {
            const before = st.deathRecord.posthumousRankId;
            st.deathRecord.posthumousRankId = effect.posthumousRankId;
            collector?.record({ effectType: "set_consort_posthumous", effectIndex, path: `standing.${effect.char}.deathRecord.posthumousRankId`, before, after: effect.posthumousRankId });
          }
          if (effect.posthumousEpithet !== undefined) {
            const before = st.deathRecord.posthumousEpithet;
            st.deathRecord.posthumousEpithet = effect.posthumousEpithet;
            collector?.record({ effectType: "set_consort_posthumous", effectIndex, path: `standing.${effect.char}.deathRecord.posthumousEpithet`, before, after: effect.posthumousEpithet });
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
        collector?.record({
          effectType: "confine", effectIndex,
          path: `statusEffects.${newSe.id}`,
          before: undefined, after: newSe,
          reason: `confine ${effect.char}${effect.endTurnExclusive !== null ? `, until turn ${effect.endTurnExclusive}` : " (indefinite)"}`,
        });
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
              collector?.record({
                effectType: "lift_confinement", effectIndex,
                path: `statusEffects.${se.id}.liftedTurn`,
                before: undefined, after: se.liftedTurn, reason: "term_expired",
              });
            }
          } else if (turn >= se.startTurn && (se.endTurnExclusive === null || turn < se.endTurnExclusive)) {
            // 皇帝下旨解除：收掉当旬活跃记录，当旬立即失效。
            se.liftedTurn = turn;
            se.liftedAt = effect.at;
            se.liftReason = "lifted_by_emperor";
            collector?.record({
              effectType: "lift_confinement", effectIndex,
              path: `statusEffects.${se.id}.liftedTurn`,
              before: undefined, after: se.liftedTurn, reason: "lifted_by_emperor",
            });
          }
        }
        // 凤后禁足解除：主理权自动归还（手动解除与自动到期均走此路径）。
        const beforeAdminMode = next.haremAdministration.mode;
        if (next.standing[effect.char]?.rank === "fenghou" && next.haremAdministration.mode !== "empress") {
          next.haremAdministration = { mode: "empress" };
        }
        if (beforeAdminMode !== next.haremAdministration.mode) collector?.record({
          effectType: "lift_confinement", effectIndex,
          path: "haremAdministration.mode",
          before: beforeAdminMode, after: next.haremAdministration.mode,
          reason: "empress confinement lifted → administration restored",
        });
        break;
      }
      case "set_harem_administration": {
        const before = next.haremAdministration.mode;
        next.haremAdministration = effect.state;
        collector?.record({
          effectType: "set_harem_administration", effectIndex,
          path: "haremAdministration.mode",
          before, after: effect.state.mode,
        });
        break;
      }
      case "consort_decease": {
        const st = next.standing[effect.char];
        const beforeLifecycle = st?.lifecycle;
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
        // 统一死亡清理：作废活跃禁足等持续状态、清留宿与免请安计划。
        for (const se of next.statusEffects) {
          if (se.kind === "confinement" && se.characterId === effect.char && se.liftedTurn === undefined) {
            se.liftedTurn = effect.at.dayIndex;
            se.liftedAt = effect.at;
          }
        }
        if (next.overnightWith?.charId === effect.char) delete next.overnightWith;
        if (next.excusedFromGreeting?.charIds.includes(effect.char)) {
          next.excusedFromGreeting = {
            ...next.excusedFromGreeting,
            charIds: next.excusedFromGreeting.charIds.filter((id) => id !== effect.char),
          };
        }
        if (beforeLifecycle !== "deceased") collector?.record({
          effectType: "consort_decease", effectIndex,
          path: `standing.${effect.char}.lifecycle`,
          before: beforeLifecycle, after: "deceased",
          reason: `cause=${effect.cause}`,
        });
        break;
      }
      case "heir_decease": {
        const h = next.resources.bloodline.heirs.find((x) => x.id === effect.heirId);
        const beforeHD = h?.lifecycle;
        if (h && h.lifecycle !== "deceased") { h.lifecycle = "deceased"; h.deceasedAt = effect.at; }
        if (beforeHD !== "deceased") collector?.record({
          effectType: "heir_decease", effectIndex,
          path: `resources.bloodline.heirs.${effect.heirId}.lifecycle`,
          before: beforeHD, after: "deceased",
        });
        break;
      }
      case "taihou_decease": {
        const beforeDec = next.taihou.deceased;
        if (!next.taihou.deceased) {
          next.taihou.deceased = true;
          next.taihou.diedAt = effect.at;
          next.taihou.mourningUntilDayExclusive = effect.at.dayIndex + 3; // 死亡当日计第1日，独占上界
        }
        if (!beforeDec) collector?.record({
          effectType: "taihou_decease", effectIndex,
          path: "taihou.deceased",
          before: false, after: true,
        });
        break;
      }
      case "enqueue_aftermath": {
        const beforeLen = next.pendingAftermath.length;
        if (!next.pendingAftermath.some((a) => a.id === effect.id)) {
          next.pendingAftermath.push({
            id: effect.id,
            kind: effect.kind,
            subjectId: effect.subjectId,
            at: effect.at,
            resolved: false,
          });
        }
        collector?.record({
          effectType: "enqueue_aftermath", effectIndex,
          path: "pendingAftermath",
          before: beforeLen, after: next.pendingAftermath.length, delta: next.pendingAftermath.length - beforeLen,
          reason: `kind=${effect.kind}, subject=${effect.subjectId}`,
        });
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
        // Record with full entry payload so the trace panel can inspect memory content.
        collector?.record({
          effectType: "memory", effectIndex,
          path: `memories.${effect.char}.entries.${newEntry.id}`,
          before: undefined, after: newEntry,
          reason: d.summary.length > 60 ? d.summary.slice(0, 60) + "…" : d.summary,
        });
        break;
      }
    }
  }

  // 批后不变量：若协理者因本批效果（禁足/赐死/疾毙等）失格，切换内务府代理。
  // 注意：命令层负责询问玩家选新协理者；此处仅兜底处置非玩家触发的失格（如疾病身亡）。
  if (next.haremAdministration.mode === "acting_consort") {
    const adminId = next.haremAdministration.charId;
    const eligible = eligibleHaremAdministrators(db, next);
    if (!eligible.some((c) => c.id === adminId)) {
      const beforeMode = next.haremAdministration.mode;
      next.haremAdministration = {
        mode: "neiwu_proxy",
        appointedAt: toGameTime(next.calendar),
        reason: "no_eligible_consort",
      };
      collector?.record({
        effectType: undefined,
        path: "haremAdministration.mode",
        before: beforeMode, after: "neiwu_proxy",
        reason: "post-batch invariant: acting_consort no longer eligible",
        classification: "derived",
      });
    }
  }

  return ok(next);
}
