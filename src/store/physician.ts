/**
 * 召见太医·看诊纯逻辑（设计 §4）：加血 5–10、按概率治病、追加 record_physician_visit。
 * 目标不存在/已故/本月已看诊 → 返回 null（不伪造 healthy）；引擎层再由 funnel validate 兜底。
 */
import { healthRoll, healthRollRange } from "../engine/characters/healthRoll";
import type { GameTime } from "../engine/calendar/time";
import type { EventEffect } from "../engine/content/schemas";
import type { ContentDB } from "../engine/content/loader";
import type { GameState, HealthStatus } from "../engine/state/types";
import { planHealthChange, type HealthSubject } from "./health";
import { livingConsortIds } from "./healthRoster";

export type PhysicianSubject = HealthSubject;

export interface PhysicianVisitPlan {
  effects: EventEffect[];
  rolledHealing: number;
  actualHealing: number;
  cured: boolean;
}

export interface ConsultOption {
  key: "sovereign" | "taihou" | "consort" | "heir";
  label: string;
  disabled: boolean;
  disabledReason?: string;
}

export function physicianMonthKey(cal: { year: number; month: number }): string {
  return `${cal.year}:${cal.month}`;
}

function subjectKeyOf(s: PhysicianSubject): string {
  return s.kind === "sovereign" ? "sovereign" : s.kind === "taihou" ? "taihou" : s.id;
}

/** 当前状态；目标不存在/已故返回 null（不默认 healthy）。 */
function liveStatusOf(state: GameState, s: PhysicianSubject): HealthStatus | null {
  switch (s.kind) {
    case "sovereign": return state.resources.sovereign.healthStatus;
    case "taihou": return state.taihou.deceased === true ? null : state.taihou.healthStatus;
    case "consort": {
      const st = state.standing[s.id];
      return st && st.lifecycle !== "deceased" ? (st.healthStatus ?? "healthy") : null;
    }
    case "heir": {
      const h = state.resources.bloodline.heirs.find((x) => x.id === s.id);
      return h && h.lifecycle === "alive" ? (h.healthStatus ?? "healthy") : null;
    }
  }
}

export function physicianVisitedThisMonth(state: GameState, s: PhysicianSubject): boolean {
  const key = physicianMonthKey(state.calendar);
  switch (s.kind) {
    case "sovereign": return state.resources.sovereign.lastPhysicianVisitMonthKey === key;
    case "taihou": return state.taihou.lastPhysicianVisitMonthKey === key;
    case "consort": return state.standing[s.id]?.lastPhysicianVisitMonthKey === key;
    case "heir": return state.resources.bloodline.heirs.find((h) => h.id === s.id)?.lastPhysicianVisitMonthKey === key;
  }
}

/**
 * 一次看诊。目标不存在/已故/本月已看诊 → null。
 * effects 经 store.resolveTimedAction 落地（funnel validate 会二次强制合法性）。
 */
export function planPhysicianVisit(
  state: GameState,
  subject: PhysicianSubject,
  at: GameTime,
): PhysicianVisitPlan | null {
  const status = liveStatusOf(state, subject);
  if (status === null) return null;
  if (physicianVisitedThisMonth(state, subject)) return null;

  const seed = `physician:${state.rngSeed}:${subjectKeyOf(subject)}:${state.calendar.year}:${state.calendar.month}`;
  const rolledHealing = healthRollRange(`${seed}:heal`, 5, 10);
  let cured = false;
  if (status === "sick") cured = healthRoll(`${seed}:cure`) < 50;
  else if (status === "critical") cured = healthRoll(`${seed}:cure`) < 30;

  const { effects, outcome } = planHealthChange(state, {
    subject,
    healthDelta: rolledHealing,
    ...(cured ? { healthStatus: "healthy" as HealthStatus } : {}),
    cause: "scripted",
    at,
  });
  const actualHealing = outcome.nextHealth - outcome.previousHealth;

  effects.push({
    type: "record_physician_visit",
    subject,
    monthKey: physicianMonthKey(state.calendar),
  });

  return { effects, rolledHealing, actualHealing, cured };
}

/** 四类看诊入口可用性（AP 充足 + 本月未请脉 + 对象存在/存活）。 */
export function buildConsultOptions(db: ContentDB, state: GameState): ConsultOption[] {
  const apOk = state.calendar.ap >= 1;
  const guard = (key: ConsultOption["key"], label: string, subject: PhysicianSubject | null): ConsultOption => {
    if (subject === null) return { key, label, disabled: true, disabledReason: "对象不在" };
    if (!apOk) return { key, label, disabled: true, disabledReason: "行动点不足" };
    if (physicianVisitedThisMonth(state, subject)) return { key, label, disabled: true, disabledReason: "本月已请脉，太医嘱静养" };
    return { key, label, disabled: false };
  };
  const hasConsort = livingConsortIds(db, state).length > 0;
  const hasHeir = state.resources.bloodline.heirs.some((h) => h.lifecycle === "alive");
  return [
    guard("sovereign", "为陛下诊脉", { kind: "sovereign" }),
    guard("taihou", "给太后请脉", state.taihou.deceased === true ? null : { kind: "taihou" }),
    // 侍君/皇嗣为「打开 picker」入口，本月已请脉的逐人判定在 picker 内（见 Task 6）；此处仅判 AP/有无对象。
    { key: "consort", label: "给侍君请脉", disabled: !hasConsort || !apOk, ...(!hasConsort ? { disabledReason: "宫中无在世侍君" } : !apOk ? { disabledReason: "行动点不足" } : {}) },
    { key: "heir", label: "给皇嗣请脉", disabled: !hasHeir || !apOk, ...(!hasHeir ? { disabledReason: "暂无在世皇嗣" } : !apOk ? { disabledReason: "行动点不足" } : {}) },
  ];
}
