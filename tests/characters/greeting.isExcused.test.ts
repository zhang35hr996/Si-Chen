import { describe, expect, it } from "vitest";
import { isExcused } from "../../src/engine/characters/greeting";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const base = createNewGameState(db);

describe("isExcused", () => {
  it("false when no excuse record", () => {
    expect(isExcused(base, "lu_huaijin")).toBe(false);
  });

  it("true only for matching dayIndex and listed charId", () => {
    const di = base.calendar.dayIndex;
    const s = { ...base, excusedFromGreeting: { dayIndex: di, charIds: ["lu_huaijin"] } };
    expect(isExcused(s, "lu_huaijin")).toBe(true);
    expect(isExcused(s, "shen_zhibai")).toBe(false);
  });

  it("stale record (different dayIndex) is ignored", () => {
    const s = { ...base, excusedFromGreeting: { dayIndex: base.calendar.dayIndex + 1, charIds: ["lu_huaijin"] } };
    expect(isExcused(s, "lu_huaijin")).toBe(false);
  });
});
