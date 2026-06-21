/** 纯月度健康投影（设计 §3.3）。顺序：怀孕成本→衰老→病损→0死亡→暴毙→互斥迁移。 */
import { healthRoll, healthRollRange, healthRollBasisPoints } from "../engine/characters/healthRoll";
import { ageOver35 } from "../engine/characters/aging";
import type { DeathCause, HealthStatus } from "../engine/state/types";

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
