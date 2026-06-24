import { describe, expect, it } from "vitest";
import { assignOfficialPost } from "../../src/engine/officials/assign";
import { powerOf } from "../../src/engine/officials/power";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const T = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

describe("assignOfficialPost", () => {
  it("reassigns to a free post; keeps loyalty; power follows; input not mutated", () => {
    const state = createNewGameState(db);
    const id = Object.keys(state.officials)[0]!;
    const before = state.officials[id]!;
    const r = assignOfficialPost(state, db, id, "dianshi", T); // 从九品（单席，预期空闲）
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
    const r = assignOfficialPost(state, db, seated.id, null, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[seated.id]!.postId).toBeNull();
  });

  it("rejects an unknown official", () => {
    const state = createNewGameState(db);
    const r = assignOfficialPost(state, db, "nobody", "dianshi", T);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_NOT_FOUND");
  });

  it("rejects an unknown post", () => {
    const state = createNewGameState(db);
    const id = Object.keys(state.officials)[0]!;
    const r = assignOfficialPost(state, db, id, "no_such_post", T);
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
    const r = assignOfficialPost(state, db, other.id, seated.postId, T);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_SEAT_FULL");
  });

  it("is idempotent when assigning the current post", () => {
    const state = createNewGameState(db);
    const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
    const r = assignOfficialPost(state, db, seated.id, seated.postId, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(state); // 原样返回
  });

  it.each(["dead", "retired", "imprisoned", "exiled"] as const)(
    "refuses to seat a non-active (%s) official to a post",
    (status) => {
      const state = createNewGameState(db);
      const id = Object.keys(state.officials)[0]!;
      state.officials[id] = { ...state.officials[id]!, status, postId: null };
      const r = assignOfficialPost(state, db, id, "dianshi", T);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe("OFFICIAL_NOT_ACTIVE");
    },
  );

  it("still allows clearing a seat (null) for a non-active official", () => {
    const state = createNewGameState(db);
    const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
    state.officials[seated.id] = { ...seated, status: "retired" };
    const r = assignOfficialPost(state, db, seated.id, null, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[seated.id]!.postId).toBeNull();
  });

  // 顺序回归：非 active 且已非法占职者，重分配「同一官职」不得被幂等误放行。
  it.each(["retired", "imprisoned", "exiled", "dead"] as const)(
    "rejects re-assigning a non-active (%s) official to its CURRENT post",
    (status) => {
      const state = createNewGameState(db);
      const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
      state.officials[seated.id] = { ...seated, status }; // 保留 postId（非法占职态）
      const r = assignOfficialPost(state, db, seated.id, seated.postId, T);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe("OFFICIAL_NOT_ACTIVE");
    },
  );

  it.each(["retired", "imprisoned", "exiled", "dead"] as const)(
    "allows null (释放) for a non-active (%s) official holding a post",
    (status) => {
      const state = createNewGameState(db);
      const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
      state.officials[seated.id] = { ...seated, status };
      const r = assignOfficialPost(state, db, seated.id, null, T);
      expect(r.ok).toBe(true);
    },
  );

  it("non-active official already vacant: null again is idempotent ok", () => {
    const state = createNewGameState(db);
    const o = Object.values(state.officials)[0]!;
    state.officials[o.id] = { ...o, status: "retired", postId: null };
    const r = assignOfficialPost(state, db, o.id, null, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(state);
  });
});

describe("assignOfficialPost — appointedAt 语义", () => {
  const T2 = { year: 6, month: 3, period: "late" as const, dayIndex: 555 };

  it("transfer postA→postB writes appointedAt=at", () => {
    const state = createNewGameState(db);
    const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
    const free = Object.values(db.officialPosts).find((p) => p.gradeOrder > 0 && p.id !== seated.postId && !Object.values(state.officials).some((o) => o.postId === p.id))!;
    const r = assignOfficialPost(state, db, seated.id, free.id, T2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[seated.id]!.appointedAt).toEqual(T2);
  });

  it("null → post (reappointment) writes appointedAt=at", () => {
    let state = createNewGameState(db);
    const o = Object.values(state.officials).find((x) => x.postId !== null)!;
    const cleared = assignOfficialPost(state, db, o.id, null, T);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    state = cleared.value;
    const r = assignOfficialPost(state, db, o.id, "dianshi", T2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[o.id]!.appointedAt).toEqual(T2);
  });

  it("idempotent same post does NOT update appointedAt", () => {
    const state = createNewGameState(db);
    const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
    const original = seated.appointedAt;
    const r = assignOfficialPost(state, db, seated.id, seated.postId, T2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[seated.id]!.appointedAt).toEqual(original);
  });

  it("去职 (post → null) retains the last appointedAt (not cleared)", () => {
    const state = createNewGameState(db);
    const seated = Object.values(state.officials).find((o) => o.postId !== null)!;
    const original = seated.appointedAt;
    const r = assignOfficialPost(state, db, seated.id, null, T2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[seated.id]!.appointedAt).toEqual(original);
  });
});
