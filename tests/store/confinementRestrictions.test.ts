import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { greetingAttendees } from "../../src/engine/characters/greeting";
import { consortLocationAt, presentAt } from "../../src/engine/characters/presence";
import { canCharacterParticipate, getActionAvailability } from "../../src/engine/characters/restrictions";
import { canSummon } from "../../src/store/bedchamber";
import { buildShizhiEncounter, buildTaihouRebuke } from "../../src/store/taihou";
import { planPhysicianVisit } from "../../src/store/physician";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = withConsort(createNewGameState(db), db, "lu_huaijin");
const now = toGameTime(base.calendar);
const HOME = base.generatedConsorts.lu_huaijin!.defaultLocation; // zhongcui_gong

function confined(durationTurns: number | null = null): GameState {
  const r = applyEffects(db, base, [
    {
      type: "confine",
      char: "lu_huaijin",
      startTurn: base.calendar.dayIndex,
      endTurnExclusive: durationTurns === null ? null : base.calendar.dayIndex + durationTurns,
      imposedAt: now,
    },
  ]);
  if (!r.ok) throw new Error("setup confine failed");
  return r.value;
}

describe("禁足者从候选/出席中被排除", () => {
  it("不参加请安（坤宁宫晨省）", () => {
    expect(greetingAttendees(db, base).some((c) => c.id === "lu_huaijin")).toBe(true);
    expect(greetingAttendees(db, confined()).some((c) => c.id === "lu_huaijin")).toBe(false);
  });

  it("不外出：所有 slot 都留在本宫，不入御花园候选", () => {
    const s = confined();
    for (let slot = 0; slot < 6; slot++) {
      expect(consortLocationAt(db, s, "lu_huaijin", slot)).toBe(HOME);
    }
    // 任何非本宫地点的「此刻在场」都不含禁足者。
    expect(presentAt(db, s, "yuhuayuan").some((c) => c.id === "lu_huaijin")).toBe(false);
    expect(presentAt(db, s, "kunninggong").some((c) => c.id === "lu_huaijin")).toBe(false);
  });

  it("不进入侍寝/普通召见候选（canSummon=false）", () => {
    expect(canSummon(base, "lu_huaijin")).toBe(true);
    expect(canSummon(confined(), "lu_huaijin")).toBe(false);
  });

  it("不被太后召见训诫（rebukePool 排除）", () => {
    const s = confined();
    const ill = { ...s, taihou: { ...s.taihou, healthStatus: "healthy" as const } };
    let appeared = false;
    for (let i = 0; i < 300; i++) {
      const plan = buildTaihouRebuke(db, ill, String(i));
      if (plan?.targetId === "lu_huaijin") appeared = true;
    }
    expect(appeared).toBe(false);
  });

  it("不往慈宁宫侍疾（attendantPool 排除）", () => {
    const s = confined();
    const sick = { ...s, taihou: { ...s.taihou, healthStatus: "sick" as const } };
    let appeared = false;
    for (let i = 0; i < 300; i++) {
      const plan = buildShizhiEncounter(db, sick, String(i));
      if (plan?.attendantId === "lu_huaijin") appeared = true;
    }
    expect(appeared).toBe(false);
  });
});

describe("统一行动许可层 getActionAvailability", () => {
  it("禁足者所有受限玩法 allowed=false，附原因文案", () => {
    const s = confined();
    for (const act of ["greeting", "garden", "bedchamber", "visit_others", "visited_by_consort", "normal_visit", "normal_summon", "summoned_by_taihou"] as const) {
      const a = getActionAvailability(s, "lu_huaijin", act);
      expect(a.allowed).toBe(false);
      expect(a.reasonCode).toBe("confined");
      expect(a.message).toContain("宫门闭锁");
    }
  });

  it("未禁足者 allowed=true", () => {
    expect(canCharacterParticipate(base, "lu_huaijin", "greeting")).toBe(true);
  });

  it("解除后恢复普通资格", () => {
    const s = confined();
    const lifted = applyEffects(db, s, [{ type: "lift_confinement", char: "lu_huaijin", at: now, reason: "lifted_by_emperor" }]);
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(canCharacterParticipate(lifted.value, "lu_huaijin", "greeting")).toBe(true);
    expect(canSummon(lifted.value, "lu_huaijin")).toBe(true);
    expect(greetingAttendees(db, lifted.value).some((c) => c.id === "lu_huaijin")).toBe(true);
  });
});

describe("奉旨传太医为明确例外（不被禁足阻止）", () => {
  it("禁足者仍可被太医诊治", () => {
    const s = confined();
    // 令其患病，确保看诊计划成立。
    const sick = applyEffects(db, s, [{ type: "set_consort_health", char: "lu_huaijin", healthStatus: "sick" }]);
    expect(sick.ok).toBe(true);
    if (!sick.ok) return;
    const plan = planPhysicianVisit(sick.value, { kind: "consort", id: "lu_huaijin" }, now);
    expect(plan).not.toBeNull();
  });
});
