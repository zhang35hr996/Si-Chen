import { describe, expect, it } from "vitest";
import { buildRankOp } from "../../src/store/rankOps";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";

const db = loadRealContent();

describe("buildRankOp", () => {
  const state = createNewGameState(db); // lu_huaijin starts at 承徽
  it("promote to 君 emits set_rank + memory and 谢恩 lines", () => {
    const op = buildRankOp(db, state, "lu_huaijin", { kind: "set_rank", rank: "jun" });
    expect(op).not.toBeNull();
    if (!op) return;
    expect(op.kind).toBe("promote");
    expect(op.effects[0]).toEqual({ type: "set_rank", char: "lu_huaijin", rank: "jun" });
    expect(op.effects.some((e) => e.type === "memory")).toBe(true);
    expect(op.lines[0]).toContain("臣侍");
  });
  it("selecting the SAME rank is a no-op (null)", () => {
    expect(buildRankOp(db, state, "lu_huaijin", { kind: "set_rank", rank: "chenghui" })).toBeNull();
  });
  it("strip_title classifies as strip_title and emits remove_title", () => {
    const titled = structuredClone(state);
    titled.standing.lu_huaijin!.title = "婉";
    const op = buildRankOp(db, titled, "lu_huaijin", { kind: "remove_title" });
    expect(op?.kind).toBe("strip_title");
    expect(op?.effects[0]).toEqual({ type: "remove_title", char: "lu_huaijin" });
  });
});
