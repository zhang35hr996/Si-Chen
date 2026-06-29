import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/engine/state/initialState";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { SOVEREIGN_PERSON_ID } from "../../src/engine/state/types";

describe("parentage 容器脚手架", () => {
  it("createInitialState 初始化三容器为空、两计数器为 1", () => {
    const s = createInitialState();
    expect(s.parentage).toEqual({});
    expect(s.adoptionRecords).toEqual({});
    expect(s.royalResidences).toEqual({});
    expect(s.adoptionNextSeq).toBe(1);
    expect(s.royalResidenceNextSeq).toBe(1);
  });

  it("createNewGameState 同样初始化三容器与两计数器（验收 #18）", () => {
    const s = createNewGameState(loadRealContent());
    expect(s.parentage).toEqual({});
    expect(s.adoptionRecords).toEqual({});
    expect(s.royalResidences).toEqual({});
    expect(s.adoptionNextSeq).toBe(1);
    expect(s.royalResidenceNextSeq).toBe(1);
  });

  it("SOVEREIGN_PERSON_ID 为 'sovereign'", () => {
    expect(SOVEREIGN_PERSON_ID).toBe("sovereign");
  });
});
