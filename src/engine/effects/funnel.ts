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
 *   - runtime memory is append-only, source "scene_outcome", never protected
 *   - reject-one-reject-all: any invalid effect rejects the whole batch and
 *     the caller keeps the original state reference
 */
import { toGameTime } from "../calendar/time";
import { nextHeirId } from "../characters/heirs";
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
      case "relationship":
        if (!db.characters[e.char] || !state.relationships[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `unknown relationship target "${e.char}"`, { char: e.char });
        }
        break;
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
        break; // fully constrained by the schema
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
          }
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
        }
        break;
      }
      case "remove_title": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `remove_title needs a consort with standing: "${e.char}"`, { char: e.char });
        } else if (state.standing[e.char]!.rank === "fenghou") {
          bad(index, "BAD_EFFECT_TARGET", `the 正宫 (凤后) is not adjustable: "${e.char}"`, { char: e.char });
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
      case "child_favor": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
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
}

export function applyEffects(
  db: ContentDB,
  state: GameState,
  effects: readonly EventEffect[],
  context: EffectContext = {},
): Result<GameState, GameError[]> {
  const errors = validateEffects(db, state, effects);
  if (errors.length > 0) return err(errors);

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

  for (const effect of effects) {
    switch (effect.type) {
      case "relationship": {
        const target = next.relationships[effect.char]!;
        const applied = cappedDelta(`rel:${effect.char}:${effect.field}`, effect.delta);
        target[effect.field] = clampPct(target[effect.field] + applied);
        break;
      }
      case "favor": {
        const target = next.standing[effect.char]!;
        const applied = cappedDelta(`favor:${effect.char}`, effect.delta);
        target.favor = clampPct(target.favor + applied);
        break;
      }
      case "resource": {
        const applied = cappedDelta(`res:${effect.pillar}:${effect.field}`, effect.delta);
        if (effect.pillar === "court") {
          next.resources.court[effect.field] = clampPct(next.resources.court[effect.field] + applied);
        } else if (effect.pillar === "harem") {
          next.resources.harem[effect.field] = clampPct(next.resources.harem[effect.field] + applied);
        } else {
          next.resources.bloodline.legitimacy = clampPct(next.resources.bloodline.legitimacy + applied);
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
      case "birth": {
        const bl = next.resources.bloodline;
        const childSurvives = effect.bearerOutcome === "safe" || effect.bearerOutcome === "bearer_dies";
        const bearerSurvives = effect.bearerOutcome === "safe" || effect.bearerOutcome === "child_dies";
        if (childSurvives) {
          bl.heirs.push({
            id: nextHeirId(bl.heirs.length),
            sex: effect.sex,
            fatherId: effect.fatherId,
            bearer: effect.bearer,
            birthAt: now,
            favor: effect.favor,
            legitimate: effect.legitimate,
          });
        }
        if (effect.bearer !== "sovereign") {
          const st = next.standing[effect.bearer]!;
          if (!bearerSurvives) {
            st.lifecycle = "deceased";
            delete st.recoverUntilMonth;
          } else if (effect.bearerOutcome === "safe") {
            st.lifecycle = "delivered";
            if (effect.recoverUntilMonth !== undefined) st.recoverUntilMonth = effect.recoverUntilMonth;
          } else {
            // child_dies, bearer survives → 不晋升，回 normal，难产三月休养
            st.lifecycle = "normal";
            if (effect.recoverUntilMonth !== undefined) st.recoverUntilMonth = effect.recoverUntilMonth;
          }
        }
        // 仅移除生产对应的那条胎息；帝王可能另有自孕，故只在自孕生产时才清 pregnancy。
        bl.gestations = bl.gestations.filter((g) => g.carrier !== effect.bearer);
        if (effect.bearer === "sovereign") {
          bl.pregnancy = { status: "none", candidateIds: [] };
        }
        break;
      }
      case "child_favor": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const applied = cappedDelta(`heir:${effect.heirId}`, effect.delta);
        heir.favor = clampPct(heir.favor + applied);
        break;
      }
      case "memory": {
        const store = next.memories[effect.char]!;
        store.entries.push({
          id: memoryEntryId(effect.char, store.nextSeq),
          kind: effect.entry.kind,
          summary: effect.entry.summary,
          salience: effect.entry.salience,
          createdAt: now, // GameTime — never carries AP
          tags: [...effect.entry.tags],
          participants: [...effect.entry.participants],
          ...(effect.entry.locationId !== undefined ? { locationId: effect.entry.locationId } : {}),
          source: "scene_outcome", // runtime memory is never "authored"
          ...(context.sceneId !== undefined ? { originSceneId: context.sceneId } : {}),
          protected: false, // and never protected (schema already forbids true)
        });
        store.nextSeq += 1;
        break;
      }
    }
  }
  return ok(next);
}
