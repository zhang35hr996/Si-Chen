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
    }
  });
  return errors;
}

/**
 * Atomic batch apply. On success returns a NEW state object; the input state
 * is never mutated. On failure returns ALL collected errors and the caller's
 * state stays exactly what it was.
 */
export function applyEffects(
  db: ContentDB,
  state: GameState,
  effects: readonly EventEffect[],
): Result<GameState, GameError[]> {
  const errors = validateEffects(db, state, effects);
  if (errors.length > 0) return err(errors);

  const next = structuredClone(state) as GameState;
  const now = toGameTime(state.calendar);
  const cumulative = new Map<string, number>();

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
          protected: false, // and never protected (schema already forbids true)
        });
        store.nextSeq += 1;
        break;
      }
    }
  }
  return ok(next);
}
