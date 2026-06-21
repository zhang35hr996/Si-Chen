import { describe, expect, it } from "vitest";
import { absentAt } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);
const atSlot = (s: GameState, slot: number): GameState => ({ ...s, calendar: { ...s.calendar, ap: s.calendar.apMax - slot } });

describe("absentAt", () => {
  it("卯时某后宫居所：住客去请安 → 映射到 kunninggong", () => {
    const a = absentAt(db, atSlot(base, 0), "zhongcui_gong");
    expect(a.lu_huaijin).toBe("kunninggong");
  });

  it("夜里住客都在家 → 无缺席", () => {
    expect(absentAt(db, atSlot(base, 5), "zhongcui_gong")).toEqual({});
  });
});
