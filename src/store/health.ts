/**
 * 统一健康结算（纯函数）：clamp → 状态 → 死亡判定 → 身后事入队（皇帝除外）。
 * 本阶段仅产出 effects + outcome，不接入 tick/事务（Phase 2 才调用）。
 */
import type { EventEffect } from "../engine/content/schemas";
import type { GameTime } from "../engine/calendar/time";
import type { DeathCause, GameState, HealthStatus } from "../engine/state/types";

export type HealthSubject =
  | { kind: "sovereign" }
  | { kind: "taihou" }
  | { kind: "consort"; id: string }
  | { kind: "heir"; id: string };

export interface HealthChangeInput {
  subject: HealthSubject;
  healthDelta?: number;
  healthStatus?: HealthStatus;
  forceDeath?: boolean;
  cause: DeathCause;
  at: GameTime;
}

export interface HealthChangeOutcome {
  previousHealth: number;
  nextHealth: number;
  previousStatus: HealthStatus;
  nextStatus: HealthStatus;
  died: boolean;
  deathCause?: DeathCause;
  sovereignDied?: boolean;
  aftermathId?: string;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

function currentOf(
  state: GameState,
  s: HealthSubject,
): { health: number; status: HealthStatus } | null {
  switch (s.kind) {
    case "sovereign":
      return {
        health: state.resources.sovereign.health,
        status: state.resources.sovereign.healthStatus,
      };
    case "taihou":
      return { health: state.taihou.health, status: state.taihou.healthStatus };
    case "consort": {
      const st = state.standing[s.id];
      if (!st) return null;
      // CharacterStanding.health is optional; default to 100 if absent.
      return { health: st.health ?? 100, status: st.healthStatus ?? "healthy" };
    }
    case "heir": {
      const h = state.resources.bloodline.heirs.find((x) => x.id === s.id);
      return h ? { health: h.health, status: h.healthStatus ?? "healthy" } : null;
    }
  }
}

/**
 * Build the health-mutation effect for a given subject.
 * For sovereign the `resource` effect delta is capped to ±10 (schema limit);
 * the outcome's nextHealth is still computed from the raw delta.
 */
function setHealthEffect(
  s: HealthSubject,
  rawDelta: number,
  status?: HealthStatus,
): EventEffect {
  switch (s.kind) {
    case "sovereign":
      return {
        type: "set_sovereign_health",
        ...(rawDelta !== 0 ? { healthDelta: rawDelta } : {}),
        ...(status ? { healthStatus: status } : {}),
      };
    case "taihou":
      return {
        type: "set_taihou_health",
        ...(rawDelta !== 0 ? { healthDelta: rawDelta } : {}),
        ...(status ? { healthStatus: status } : {}),
      };
    case "consort":
      return {
        type: "set_consort_health",
        char: s.id,
        ...(rawDelta !== 0 ? { healthDelta: rawDelta } : {}),
        ...(status ? { healthStatus: status } : {}),
      };
    case "heir":
      return {
        type: "set_heir_health",
        heirId: s.id,
        ...(rawDelta !== 0 ? { healthDelta: rawDelta } : {}),
        ...(status ? { healthStatus: status } : {}),
      };
  }
}

function deceaseEffects(
  s: Exclude<HealthSubject, { kind: "sovereign" }>,
  at: GameTime,
  cause: DeathCause,
): { effects: EventEffect[]; aftermathId: string } {
  const subjectId = s.kind === "taihou" ? "taihou" : s.id;
  const aftermathId = `death:${s.kind}:${subjectId}:${at.dayIndex}`;
  const decease: EventEffect =
    s.kind === "taihou"
      ? { type: "taihou_decease", at, cause }
      : s.kind === "consort"
        ? { type: "consort_decease", char: s.id, at, cause }
        : { type: "heir_decease", heirId: s.id, at, cause };
  return {
    effects: [
      decease,
      { type: "enqueue_aftermath", id: aftermathId, kind: s.kind, subjectId, at },
    ],
    aftermathId,
  };
}

function isDeceased(state: GameState, s: HealthSubject): boolean {
  if (s.kind === "taihou") return state.taihou.deceased === true;
  if (s.kind === "consort") return state.standing[s.id]?.lifecycle === "deceased";
  if (s.kind === "heir") return state.resources.bloodline.heirs.find((h) => h.id === s.id)?.lifecycle === "deceased";
  return false; // sovereign death ends the game; never re-planned
}

export function planHealthChange(
  state: GameState,
  input: HealthChangeInput,
): { effects: EventEffect[]; outcome: HealthChangeOutcome } {
  const cur = currentOf(state, input.subject);
  if (!cur || isDeceased(state, input.subject)) {
    return {
      effects: [],
      outcome: {
        previousHealth: cur?.health ?? 0,
        nextHealth: cur?.health ?? 0,
        previousStatus: cur?.status ?? "healthy",
        nextStatus: cur?.status ?? "healthy",
        died: false,
      },
    };
  }

  const delta = input.healthDelta ?? 0;
  const nextHealth = clamp(cur.health + delta);
  const nextStatus = input.healthStatus ?? cur.status;
  const died = input.forceDeath === true || nextHealth <= 0;

  const effects: EventEffect[] = [];
  if (delta !== 0 || input.healthStatus !== undefined) effects.push(setHealthEffect(input.subject, delta, input.healthStatus));

  const outcome: HealthChangeOutcome = {
    previousHealth: cur.health,
    nextHealth,
    previousStatus: cur.status,
    nextStatus,
    died,
  };

  if (died) {
    outcome.deathCause = input.cause;
    if (input.subject.kind === "sovereign") {
      outcome.sovereignDied = true;
      // Sovereign death: no decease effect, no aftermath entry (handled in Phase 2).
    } else {
      const { effects: ds, aftermathId } = deceaseEffects(
        input.subject as Exclude<HealthSubject, { kind: "sovereign" }>,
        input.at,
        input.cause,
      );
      effects.push(...ds);
      outcome.aftermathId = aftermathId;
    }
  }

  return { effects, outcome };
}
