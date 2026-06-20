import { describe, expect, it } from "vitest";
import { changeOfficialGrade } from "../../src/engine/officials/changeGrade";
import { powerOf } from "../../src/engine/officials/power";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("changeOfficialGrade", () => {
  it("changes postId and keeps loyalty; power follows the new post; input not mutated", () => {
    const state = createNewGameState(db);
    const id = Object.keys(state.officials)[0]!;
    const before = state.officials[id]!;
    const next = changeOfficialGrade(state, id, "zhixian"); // 正七品
    expect(next.officials[id]!.postId).toBe("zhixian");
    expect(next.officials[id]!.loyalty).toBe(before.loyalty);
    expect(state.officials[id]!.postId).toBe(before.postId); // 不可变
    const post = db.officialPosts["zhixian"]!;
    expect(powerOf(post, id)).toBeGreaterThan(0);
  });
});
