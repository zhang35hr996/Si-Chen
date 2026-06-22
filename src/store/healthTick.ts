/** 纯月度健康投影（设计 §3.3）。顺序：怀孕成本→衰老→病损→0死亡→暴毙→互斥迁移。 */
import { healthRoll, healthRollRange, healthRollBasisPoints } from "../engine/characters/healthRoll";
import { ageOver35 } from "../engine/characters/aging";
import type { DeathCause, GameState, HealthStatus } from "../engine/state/types";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameTime } from "../engine/calendar/time";
import { dayIndexOf } from "../engine/calendar/time";
import { planHealthChange } from "./health";
import { currentAgeOf, livingConsortIds } from "./healthRoster";

export interface MonthlyHealthContext { health: number; status: HealthStatus; age: number; isYearStart: boolean; pregnancyMonthlyCost: boolean; seedKey: string; }
export interface MonthlyHealthOutcome { previousHealth: number; nextHealth: number; previousStatus: HealthStatus; nextStatus: HealthStatus; died: boolean; deathCause?: DeathCause; }

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

export function monthlyIllnessRate(health: number, age: number): number {
  const annual = Math.min(60, Math.max(5, 5 + Math.round((100 - health) * 0.4) + ageOver35(age)));
  return 1 - Math.pow(1 - annual / 100, 1 / 12);
}

export function projectMonthlyHealth(ctx: MonthlyHealthContext): MonthlyHealthOutcome {
  const previousHealth = ctx.health, previousStatus = ctx.status, k = ctx.seedKey;
  let h = ctx.health, nextStatus = ctx.status;
  if (ctx.pregnancyMonthlyCost) h -= healthRollRange(`${k}:preg`, 0, 5);
  if (ctx.isYearStart && ctx.age >= 35) h -= 1 + Math.floor(ageOver35(ctx.age) / 10);
  if (previousStatus === "sick") h -= healthRollRange(`${k}:sickdmg`, 1, 2);
  else if (previousStatus === "critical") h -= healthRollRange(`${k}:critdmg`, 3, 5);
  h = clampPct(h);
  if (h <= 0) return { previousHealth, nextHealth: 0, previousStatus, nextStatus: previousStatus, died: true, deathCause: "illness" };
  if (previousStatus === "critical" && healthRoll(`${k}:sudden`) < 5)
    return { previousHealth, nextHealth: h, previousStatus, nextStatus: previousStatus, died: true, deathCause: "critical_sudden" };
  if (previousStatus === "healthy") {
    // onset uses POST-decay/POST-cost health `h` (not month-start ctx.health)
    if (healthRollBasisPoints(`${k}:onset`) < monthlyIllnessRate(h, ctx.age) * 10000) nextStatus = "sick";
  } else if (previousStatus === "sick") {
    const criticalRate = Math.min(30, Math.max(1, 1 + ageOver35(ctx.age)));
    const r = healthRoll(`${k}:transition`);
    if (r < criticalRate) nextStatus = "critical";
    else if (r < criticalRate + 50) nextStatus = "healthy";
  }
  return { previousHealth, nextHealth: h, previousStatus, nextStatus, died: false };
}

// ── 月度健康编排（§4 Phase 2）──────────────────────────────────────────────

export interface MonthlyTickResult {
  effects: EventEffect[];
  sovereignDied: boolean;
  aftermathDeaths: Array<{ kind: "taihou" | "consort" | "heir"; subjectId: string }>;
}

/**
 * 按优先顺序执行一个月度健康 tick：
 *   皇帝 → 太后（若已薨跳过）→ 在世侍君（字母序）→ 存活皇嗣（id 序）。
 * 皇帝死亡时立即返回，不再处理后续角色。
 */
export function buildMonthlyHealthTick(db: ContentDB, state: GameState): MonthlyTickResult {
  const { year, month, period } = state.calendar;
  const rngSeed = state.rngSeed;
  const at: GameTime = { year, month, period, dayIndex: dayIndexOf(year, month, period) };
  const isYearStart = month === 1 && period === "early";
  const effects: EventEffect[] = [];
  const aftermathDeaths: Array<{ kind: "taihou" | "consort" | "heir"; subjectId: string }> = [];

  // ── 皇帝 ──────────────────────────────────────────────────────────────
  {
    const seedKey = `tick:${rngSeed}:sovereign:${year}:${month}`;
    const age = currentAgeOf(db, state, { kind: "sovereign" });
    const health = state.resources.sovereign.health;
    const status = state.resources.sovereign.healthStatus;
    const out = projectMonthlyHealth({ health, status, age, isYearStart, pregnancyMonthlyCost: false, seedKey });
    const { effects: fx } = planHealthChange(state, {
      subject: { kind: "sovereign" },
      ...(out.nextHealth !== health ? { healthDelta: out.nextHealth - health } : {}),
      healthStatus: out.nextStatus !== status ? out.nextStatus : undefined,
      forceDeath: out.died && out.nextHealth > 0,
      cause: out.deathCause ?? "illness",
      at,
    });
    effects.push(...fx);
    if (out.died) {
      return { effects, sovereignDied: true, aftermathDeaths: [] };
    }
  }

  // ── 太后 ──────────────────────────────────────────────────────────────
  if (state.taihou.deceased !== true) {
    const seedKey = `tick:${rngSeed}:taihou:${year}:${month}`;
    const age = currentAgeOf(db, state, { kind: "taihou" });
    const health = state.taihou.health;
    const status = state.taihou.healthStatus;
    const out = projectMonthlyHealth({ health, status, age, isYearStart, pregnancyMonthlyCost: false, seedKey });
    const { effects: fx } = planHealthChange(state, {
      subject: { kind: "taihou" },
      ...(out.nextHealth !== health ? { healthDelta: out.nextHealth - health } : {}),
      healthStatus: out.nextStatus !== status ? out.nextStatus : undefined,
      forceDeath: out.died && out.nextHealth > 0,
      cause: out.deathCause ?? "illness",
      at,
    });
    effects.push(...fx);
    if (out.died) {
      aftermathDeaths.push({ kind: "taihou", subjectId: "taihou" });
    }
  }

  // ── 在世侍君（字母序）─────────────────────────────────────────────────
  for (const consortId of livingConsortIds(db, state)) {
    const seedKey = `tick:${rngSeed}:${consortId}:${year}:${month}`;
    const age = currentAgeOf(db, state, { kind: "consort", id: consortId });
    const st = state.standing[consortId];
    const health = st?.health ?? 100;
    const status = st?.healthStatus ?? "healthy";
    const out = projectMonthlyHealth({ health, status, age, isYearStart, pregnancyMonthlyCost: false, seedKey });
    const { effects: fx } = planHealthChange(state, {
      subject: { kind: "consort", id: consortId },
      ...(out.nextHealth !== health ? { healthDelta: out.nextHealth - health } : {}),
      healthStatus: out.nextStatus !== status ? out.nextStatus : undefined,
      forceDeath: out.died && out.nextHealth > 0,
      cause: out.deathCause ?? "illness",
      at,
    });
    effects.push(...fx);
    if (out.died) {
      aftermathDeaths.push({ kind: "consort", subjectId: consortId });
    }
  }

  // ── 存活皇嗣（id 序）─────────────────────────────────────────────────
  const aliveHeirs = [...state.resources.bloodline.heirs]
    .filter((h) => h.lifecycle === "alive")
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const heir of aliveHeirs) {
    const seedKey = `tick:${rngSeed}:${heir.id}:${year}:${month}`;
    const age = currentAgeOf(db, state, { kind: "heir", id: heir.id });
    const health = heir.health;
    const status = heir.healthStatus ?? "healthy";
    const out = projectMonthlyHealth({ health, status, age, isYearStart, pregnancyMonthlyCost: false, seedKey });
    const { effects: fx } = planHealthChange(state, {
      subject: { kind: "heir", id: heir.id },
      ...(out.nextHealth !== health ? { healthDelta: out.nextHealth - health } : {}),
      healthStatus: out.nextStatus !== status ? out.nextStatus : undefined,
      forceDeath: out.died && out.nextHealth > 0,
      cause: out.deathCause ?? "illness",
      at,
    });
    effects.push(...fx);
    if (out.died) {
      aftermathDeaths.push({ kind: "heir", subjectId: heir.id });
    }
  }

  return { effects, sovereignDied: false, aftermathDeaths };
}
