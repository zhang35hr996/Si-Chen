import { describe, expect, it } from "vitest";
import { assignOfficialPost } from "../../src/engine/officials/assign";
import { powerOf } from "../../src/engine/officials/power";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("assignOfficialPost", () => {
  it("reassigns to a free post; keeps loyalty; power follows; input not mutated", () => {
    const state = createNewGameState(db);
    const id = Object.keys(state.officials)[0]!;
    const before = state.officials[id]!;
    const r = assignOfficialPost(state, db, id, "dianshi"); // 从九品（单席，预期空闲）
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[id]!.postId).toBe("dianshi");
    expect(r.value.officials[id]!.loyalty).toBe(before.loyalty);
    expect(state.officials[id]!.postId).toBe(before.postId); // 不可变
    expect(powerOf(db.officialPosts["dianshi"]!, id)).toBeGreaterThan(0);
  });

  it("null clears the seat (去职)", () => {
    const state = createNewGameState(db);
    const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
    const r = assignOfficialPost(state, db, seated.id, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[seated.id]!.postId).toBeNull();
  });

  it("rejects an unknown official", () => {
    const state = createNewGameState(db);
    const r = assignOfficialPost(state, db, "nobody", "dianshi");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_NOT_FOUND");
  });

  it("rejects an unknown post", () => {
    const state = createNewGameState(db);
    const id = Object.keys(state.officials)[0]!;
    const r = assignOfficialPost(state, db, id, "no_such_post");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_BAD_POST");
  });

  it("rejects overflowing a single-seat post", () => {
    const state = createNewGameState(db);
    // 取一名已占某单席官职的官员，再让另一名官员去抢同一席 → 超额。
    const seated = Object.values(state.officials).find(
      (o) => o.postId !== null && db.officialPosts[o.postId]!.seatCount === 1,
    )!;
    const other = Object.values(state.officials).find((o) => o.id !== seated.id)!;
    const r = assignOfficialPost(state, db, other.id, seated.postId);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_SEAT_FULL");
  });

  it("is idempotent when assigning the current post", () => {
    const state = createNewGameState(db);
    const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
    const r = assignOfficialPost(state, db, seated.id, seated.postId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(state); // 原样返回
  });

  it("refuses to seat a dead official", () => {
    const state = createNewGameState(db);
    const id = Object.keys(state.officials)[0]!;
    state.officials[id] = { ...state.officials[id]!, status: "dead", postId: null };
    const r = assignOfficialPost(state, db, id, "dianshi");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_DEAD");
  });
});
