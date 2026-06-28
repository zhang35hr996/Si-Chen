import { describe, expect, it } from "vitest";
import { greetingAttendees } from "../../src/engine/characters/greeting";
import { consortLocationAt } from "../../src/engine/characters/presence";
import { MAO_SLOT } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = withConsort(createNewGameState(db), db, "lu_huaijin");
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

describe("consortLocationAt - 生病侍君留在寝殿", () => {
  const home = "zhongcui_gong"; // 陆怀瑾的默认住处

  it("健康侍君卯时前往请安地点（不在自己寝殿）", () => {
    const loc = consortLocationAt(db, base, "lu_huaijin", MAO_SLOT);
    // 请安地点由皇后（坤宁宫）决定，不等于自己的 zhongcui_gong
    expect(loc).not.toBe(home);
  });

  it("生病侍君卯时留在寝殿", () => {
    const s: GameState = {
      ...base,
      standing: { ...base.standing, lu_huaijin: { ...base.standing["lu_huaijin"]!, healthStatus: "sick" } },
    };
    expect(consortLocationAt(db, s, "lu_huaijin", MAO_SLOT)).toBe(home);
  });

  it("危重侍君卯时留在寝殿", () => {
    const s: GameState = {
      ...base,
      standing: { ...base.standing, lu_huaijin: { ...base.standing["lu_huaijin"]!, healthStatus: "critical" } },
    };
    expect(consortLocationAt(db, s, "lu_huaijin", MAO_SLOT)).toBe(home);
  });
});
