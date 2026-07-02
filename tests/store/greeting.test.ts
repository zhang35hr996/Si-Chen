import { describe, expect, it } from "vitest";
import { excuseFromGreeting, dismissOvernight, recordOvernight } from "../../src/store/greeting";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const base = withConsort(createNewGameState(db), db, "lu_huaijin");
const home = base.generatedConsorts.lu_huaijin!.defaultLocation; // zhongcui_gong

describe("excuseFromGreeting", () => {
  it("favor +2、affection +3，并记入当日 excused，清 overnightWith", () => {
    const seed = {
      ...base,
      overnightWith: { charId: "lu_huaijin", morningDayIndex: base.calendar.dayIndex },
    };
    const before = seed.standing.lu_huaijin!;
    const baseAff = before.affection ?? db.characters.lu_huaijin!.hidden!.affection;
    const next = excuseFromGreeting(seed, db, "lu_huaijin");
    expect(next.standing.lu_huaijin!.favor).toBe(before.favor + 2);
    expect(next.standing.lu_huaijin!.affection).toBe(baseAff + 3);
    expect(next.excusedFromGreeting).toEqual({ dayIndex: base.calendar.dayIndex, charIds: ["lu_huaijin"] });
    expect(next.overnightWith).toBeUndefined();
  });
});

describe("recordOvernight", () => {
  it("rolledOver 且玩家在该侍君住处 → 写 overnightWith", () => {
    const s = { ...base, playerLocation: home };
    const next = recordOvernight(s, db, "lu_huaijin", true);
    expect(next.overnightWith).toEqual({ charId: "lu_huaijin", morningDayIndex: base.calendar.dayIndex });
  });

  it("未滚旬 → 不记录", () => {
    const s = { ...base, playerLocation: home };
    expect(recordOvernight(s, db, "lu_huaijin", false).overnightWith).toBeUndefined();
  });

  it("玩家不在该侍君住处（如翻牌子在御书房）→ 不记录", () => {
    const s = { ...base, playerLocation: "zichendian" };
    expect(recordOvernight(s, db, "lu_huaijin", true).overnightWith).toBeUndefined();
  });
});

describe("dismissOvernight", () => {
  it("清 overnightWith", () => {
    const s = { ...base, overnightWith: { charId: "lu_huaijin", morningDayIndex: 1 } };
    expect(dismissOvernight(s).overnightWith).toBeUndefined();
  });
});

import { GameStore } from "../../src/store/gameStore";

describe("GameStore 请安方法", () => {
  it("applyExcuseGreeting 改 state 并保留 dayIndex", () => {
    const store = new GameStore();
    store.loadState(withConsort(createNewGameState(db), db, "lu_huaijin"));
    const di = store.getState().calendar.dayIndex;
    store.applyExcuseGreeting(db, "lu_huaijin");
    expect(store.getState().excusedFromGreeting).toEqual({ dayIndex: di, charIds: ["lu_huaijin"] });
  });
});
