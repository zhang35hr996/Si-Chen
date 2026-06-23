import { describe, expect, it } from "vitest";
import {
  CONFINEMENT_DURATIONS,
  activeConfinement,
  confinementsOf,
  expiredUnrecordedConfinements,
  isConfined,
  isConfinementActiveAt,
  nextStatusEffectId,
} from "../../src/engine/characters/confinement";
import { dayIndexOf, makeGameTime, type MonthPeriod } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { ConfinementEffect, GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);

function confinement(
  charId: string,
  startTurn: number,
  durationTurns: number | null,
  over: Partial<ConfinementEffect> = {},
): ConfinementEffect {
  return {
    id: `status_${charId}_000001`,
    kind: "confinement",
    characterId: charId,
    startTurn,
    endTurnExclusive: durationTurns === null ? null : startTurn + durationTurns,
    imposedAt: makeGameTime(1, 1, "early"),
    imposedBy: "emperor",
    ...over,
  };
}

function withConfinement(turn: number, eff: ConfinementEffect): GameState {
  const cal = { ...base.calendar, ...invert(turn) };
  return { ...base, calendar: cal, statusEffects: [eff] };
}

/** turn → {year,month,period,dayIndex} for the calendar. */
function invert(turn: number) {
  const year = Math.floor(turn / 36) + 1;
  const within = turn % 36;
  const month = Math.floor(within / 3) + 1;
  const period = (["early", "mid", "late"] as const)[within % 3]!;
  return { year, month, period, dayIndex: turn };
}

describe("CONFINEMENT_DURATIONS 期限换算", () => {
  it("一个月=3旬、三个月=9旬、半年=18旬、一年=36旬、无诏=null", () => {
    expect(CONFINEMENT_DURATIONS.one_month).toBe(3);
    expect(CONFINEMENT_DURATIONS.three_months).toBe(9);
    expect(CONFINEMENT_DURATIONS.half_year).toBe(18);
    expect(CONFINEMENT_DURATIONS.one_year).toBe(36);
    expect(CONFINEMENT_DURATIONS.indefinite).toBeNull();
  });
});

describe("isConfinementActiveAt — 当前旬为第一旬 / 边界", () => {
  const start = 10;
  const eff = confinement("lu_huaijin", start, 3); // end = 13 (独占)

  it("下旨当旬即生效（第一旬）", () => {
    expect(isConfinementActiveAt(eff, start)).toBe(true);
  });
  it("到期前一旬仍生效", () => {
    expect(isConfinementActiveAt(eff, 12)).toBe(true); // 12 < 13
  });
  it("endTurnExclusive 当旬起解除（独占上界）", () => {
    expect(isConfinementActiveAt(eff, 13)).toBe(false);
    expect(isConfinementActiveAt(eff, 14)).toBe(false);
  });
  it("下旨前不生效", () => {
    expect(isConfinementActiveAt(eff, 9)).toBe(false);
  });
});

describe("一个月禁足：上/中/下旬下旨 → 次月同旬解除", () => {
  const cases: Array<[MonthPeriod, number, MonthPeriod, number]> = [
    ["early", 5, "early", 6],
    ["mid", 5, "mid", 6],
    ["late", 5, "late", 6],
  ];
  for (const [startPeriod, startMonth, endPeriod, endMonth] of cases) {
    it(`${startMonth}月${startPeriod} → ${endMonth}月${endPeriod}`, () => {
      const startTurn = dayIndexOf(3, startMonth, startPeriod);
      const eff = confinement("lu_huaijin", startTurn, CONFINEMENT_DURATIONS.one_month);
      const releaseTurn = dayIndexOf(3, endMonth, endPeriod);
      // 解除旬即 endTurnExclusive：解除旬不再生效，前一旬仍生效。
      expect(eff.endTurnExclusive).toBe(releaseTurn);
      expect(isConfinementActiveAt(eff, releaseTurn - 1)).toBe(true);
      expect(isConfinementActiveAt(eff, releaseTurn)).toBe(false);
    });
  }
});

describe("无诏不得出永不自动到期", () => {
  const eff = confinement("lu_huaijin", 0, null);
  it("远期仍生效", () => {
    expect(isConfinementActiveAt(eff, 0)).toBe(true);
    expect(isConfinementActiveAt(eff, 9999)).toBe(true);
  });
  it("不进入到期 sweep 列表", () => {
    const s = withConfinement(9999, eff);
    expect(expiredUnrecordedConfinements(s, 9999)).toHaveLength(0);
  });
});

describe("手动解除立即失效", () => {
  it("liftedTurn 一旦 <= 当前旬即不活跃", () => {
    const eff = confinement("lu_huaijin", 10, null, { liftedTurn: 12, liftReason: "lifted_by_emperor" });
    expect(isConfinementActiveAt(eff, 11)).toBe(true);
    expect(isConfinementActiveAt(eff, 12)).toBe(false);
  });
});

describe("state 级查询", () => {
  it("isConfined / activeConfinement 反映活跃记录", () => {
    const eff = confinement("lu_huaijin", 0, 3);
    const s = withConfinement(1, eff);
    expect(isConfined(s, "lu_huaijin")).toBe(true);
    expect(activeConfinement(s, "lu_huaijin")?.id).toBe(eff.id);
    expect(isConfined(s, "cheng_feng")).toBe(false);
  });

  it("confinementsOf 含历史（已解除）记录", () => {
    const eff = confinement("lu_huaijin", 0, 3, { liftedTurn: 3, liftReason: "term_expired" });
    const s = withConfinement(5, eff);
    expect(confinementsOf(s, "lu_huaijin")).toHaveLength(1);
    expect(isConfined(s, "lu_huaijin")).toBe(false); // 已解除：不活跃
  });

  it("nextStatusEffectId 单调递增", () => {
    const s = withConfinement(1, confinement("lu_huaijin", 0, 3));
    expect(nextStatusEffectId(s, "lu_huaijin")).toBe("status_lu_huaijin_000002");
    expect(nextStatusEffectId(s, "cheng_feng")).toBe("status_cheng_feng_000001");
  });
});
