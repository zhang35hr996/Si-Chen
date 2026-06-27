import { describe, expect, it } from "vitest";
import { greetingAttendees } from "../../src/engine/characters/greeting";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);
const atSlot = (s: GameState, slot: number): GameState => ({ ...s, calendar: { ...s.calendar, ap: s.calendar.apMax - slot } });

describe("greetingAttendees", () => {
  it("卯时返回在宫侍君（不含皇后）", () => {
    const ids = greetingAttendees(db, atSlot(base, 0)).map((c) => c.id);
    expect(ids).toContain("lu_huaijin");
    expect(ids).not.toContain("shen_zhibai"); // 皇后是受礼者
  });

  it("非卯时返回空", () => {
    expect(greetingAttendees(db, atSlot(base, 2))).toEqual([]);
  });

  it("被免者不在出席名单", () => {
    const s = atSlot({ ...base, excusedFromGreeting: { dayIndex: base.calendar.dayIndex, charIds: ["lu_huaijin"] } }, 0);
    expect(greetingAttendees(db, s).map((c) => c.id)).not.toContain("lu_huaijin");
  });

  it("生病/危重侍君不出席请安", () => {
    const s = atSlot({
      ...base,
      standing: {
        ...base.standing,
        lu_huaijin: { ...base.standing["lu_huaijin"]!, healthStatus: "sick" },
      },
    }, 0);
    expect(greetingAttendees(db, s).map((c) => c.id)).not.toContain("lu_huaijin");

    const s2 = atSlot({
      ...base,
      standing: {
        ...base.standing,
        lu_huaijin: { ...base.standing["lu_huaijin"]!, healthStatus: "critical" },
      },
    }, 0);
    expect(greetingAttendees(db, s2).map((c) => c.id)).not.toContain("lu_huaijin");
  });
});
