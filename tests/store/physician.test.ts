import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { physicianMonthKey, physicianVisitedThisMonth, planPhysicianVisit } from "../../src/store/physician";
import type { GameTime } from "../../src/engine/calendar/time";

const _content = loadGameContent();
if (!_content.ok) throw new Error("content failed to load");
const db = _content.value;

const at: GameTime = { year: 1, month: 1, period: "early", dayIndex: 0 };

describe("physicianMonthKey / visitedThisMonth", () => {
  it("月键 = year:month", () => {
    expect(physicianMonthKey({ year: 3, month: 7 })).toBe("3:7");
  });
  it("未看诊 → false；记录后 → true", () => {
    const s0 = createNewGameState(db);
    expect(physicianVisitedThisMonth(s0, { kind: "sovereign" })).toBe(false);
    const r = applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: physicianMonthKey(s0.calendar) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(physicianVisitedThisMonth(r.value, { kind: "sovereign" })).toBe(true);
  });

  it("同一批内重复记录同一目标的看诊 → 整批拒绝，原 state 不变（引擎层批内强制）", () => {
    const s0 = createNewGameState(db);
    const mk = physicianMonthKey(s0.calendar);
    const dup = [
      { type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: mk },
      { type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: mk },
    ] as const;
    const r = applyEffects(db, s0, dup);
    expect(r.ok).toBe(false); // 第二条须被批内去重拒绝
    // 整批拒绝：原 state 未记录看诊
    expect(physicianVisitedThisMonth(s0, { kind: "sovereign" })).toBe(false);
  });
});

describe("planPhysicianVisit", () => {
  it("healthy：actualHealing 5–10、不改状态、含 record 效果", () => {
    const s0 = createNewGameState(db);
    const seeded = applyEffects(db, s0, [{ type: "set_sovereign_health", healthDelta: -20 }]); // 压到 80
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const before = seeded.value.resources.sovereign.health;
    const plan = planPhysicianVisit(seeded.value, { kind: "sovereign" }, at)!;
    expect(plan).not.toBeNull();
    expect(plan.rolledHealing).toBeGreaterThanOrEqual(5);
    expect(plan.rolledHealing).toBeLessThanOrEqual(10);
    expect(plan.cured).toBe(false);
    expect(plan.effects.some((e) => e.type === "record_physician_visit")).toBe(true);
    const r = applyEffects(db, seeded.value, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(plan.actualHealing).toBe(r.value.resources.sovereign.health - before);
    expect(r.value.resources.sovereign.healthStatus).toBe("healthy");
  });

  it("actualHealing 受 clamp 限制（health=98 → 实际 ≤ 2）", () => {
    const s0 = createNewGameState(db);
    const cur = s0.resources.sovereign.health;
    const seeded = applyEffects(db, s0, [{ type: "set_sovereign_health", healthDelta: 98 - cur }]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const plan = planPhysicianVisit(seeded.value, { kind: "sovereign" }, at)!;
    expect(plan.actualHealing).toBeLessThanOrEqual(2);
    expect(plan.actualHealing).toBeGreaterThanOrEqual(0);
  });

  it("目标不存在 → 返回 null（不回退 healthy）", () => {
    const s0 = createNewGameState(db);
    expect(planPhysicianVisit(s0, { kind: "consort", id: "nope_xyz" }, at)).toBeNull();
  });

  it("本月已看诊 → 返回 null", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: physicianMonthKey(s0.calendar) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(planPhysicianVisit(r.value, { kind: "sovereign" }, at)).toBeNull();
  });

  it("sick：治愈与否随 seed 确定；cured 与落地状态一致", () => {
    const s0 = createNewGameState(db);
    const sick = applyEffects(db, s0, [{ type: "set_sovereign_health", healthStatus: "sick" }]);
    expect(sick.ok).toBe(true);
    if (!sick.ok) return;
    const plan = planPhysicianVisit(sick.value, { kind: "sovereign" }, at)!;
    const r = applyEffects(db, sick.value, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.sovereign.healthStatus).toBe(plan.cured ? "healthy" : "sick");
  });
});
