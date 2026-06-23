import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { activeConfinement, isConfined, confinementsOf } from "../../src/engine/characters/confinement";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

const db = loadRealContent();
const base = createNewGameState(db);
const now = toGameTime(base.calendar);
const start = base.calendar.dayIndex;

function confine(durationTurns: number | null): EventEffect {
  return {
    type: "confine",
    char: "lu_huaijin",
    startTurn: start,
    endTurnExclusive: durationTurns === null ? null : start + durationTurns,
    imposedAt: now,
    sourceLocation: "zhongcui_gong",
  };
}

describe("confine effect", () => {
  it("下旨后立即处于禁足，写入单条状态记录", () => {
    const r = applyEffects(db, base, [confine(3)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isConfined(r.value, "lu_huaijin")).toBe(true);
    const eff = activeConfinement(r.value, "lu_huaijin")!;
    expect(eff.startTurn).toBe(start);
    expect(eff.endTurnExclusive).toBe(start + 3);
    expect(eff.imposedBy).toBe("emperor");
    expect(eff.sourceLocation).toBe("zhongcui_gong");
  });

  it("无诏不得出：endTurnExclusive 为 null", () => {
    const r = applyEffects(db, base, [confine(null)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(activeConfinement(r.value, "lu_huaijin")!.endTurnExclusive).toBeNull();
  });

  it("重复下旨被拒（不产生第二条冲突活跃禁足）", () => {
    const first = applyEffects(db, base, [confine(3)]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyEffects(db, first.value, [confine(9)]);
    expect(second.ok).toBe(false);
    expect(confinementsOf(first.value, "lu_huaijin")).toHaveLength(1);
  });

  it("已故角色不能被禁足", () => {
    const dead = applyEffects(db, base, [{ type: "consort_decease", char: "lu_huaijin", at: now, cause: "scripted" }]);
    expect(dead.ok).toBe(true);
    if (!dead.ok) return;
    expect(applyEffects(db, dead.value, [confine(3)]).ok).toBe(false);
  });

  it("清理与禁足冲突的留宿计划", () => {
    const withOvernight = { ...base, overnightWith: { charId: "lu_huaijin", morningDayIndex: start } };
    const r = applyEffects(db, withOvernight, [confine(3)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.overnightWith).toBeUndefined();
  });
});

describe("lift_confinement effect", () => {
  it("皇帝下旨解除：当旬立即失效，记录 liftReason", () => {
    const confined = applyEffects(db, base, [confine(3)]);
    expect(confined.ok).toBe(true);
    if (!confined.ok) return;
    const lifted = applyEffects(db, confined.value, [
      { type: "lift_confinement", char: "lu_huaijin", at: now, reason: "lifted_by_emperor" },
    ]);
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(isConfined(lifted.value, "lu_huaijin")).toBe(false);
    const eff = confinementsOf(lifted.value, "lu_huaijin")[0]!;
    expect(eff.liftReason).toBe("lifted_by_emperor");
    expect(eff.liftedTurn).toBe(start);
  });

  it("无活跃禁足时解除是幂等 no-op", () => {
    const r = applyEffects(db, base, [
      { type: "lift_confinement", char: "lu_huaijin", at: now, reason: "lifted_by_emperor" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(confinementsOf(r.value, "lu_huaijin")).toHaveLength(0);
  });
});

describe("consort_decease 统一清理禁足", () => {
  it("赐死会作废活跃禁足（角色死后禁足不再生效）", () => {
    const confined = applyEffects(db, base, [confine(null)]);
    expect(confined.ok).toBe(true);
    if (!confined.ok) return;
    expect(isConfined(confined.value, "lu_huaijin")).toBe(true);
    const dead = applyEffects(db, confined.value, [
      { type: "consort_decease", char: "lu_huaijin", at: now, cause: "imperial_execution" },
    ]);
    expect(dead.ok).toBe(true);
    if (!dead.ok) return;
    expect(isConfined(dead.value, "lu_huaijin")).toBe(false);
    expect(dead.value.standing.lu_huaijin!.lifecycle).toBe("deceased");
    expect(dead.value.standing.lu_huaijin!.deathRecord?.cause).toBe("imperial_execution");
    // 历史保留：记录仍在，只是被标记 lifted。
    expect(confinementsOf(dead.value, "lu_huaijin")).toHaveLength(1);
  });
});
