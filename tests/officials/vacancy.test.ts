import { describe, expect, it } from "vitest";
import {
  getPostOccupancy,
  getVacantPosts,
  getVacantSeatCount,
  isPostVacant,
} from "../../src/engine/officials/selectors";
import { retireOfficial } from "../../src/engine/officials/lifecycle";
import { assignOfficialPost } from "../../src/engine/officials/assign";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const T = { year: 2, month: 1, period: "early" as const, dayIndex: 0 };

describe("vacancy selectors", () => {
  it("occupancy + vacant count reflect a single-seat post", () => {
    const s = createNewGameState(db, 1);
    const seated = Object.values(s.officials).find((o) => o.postId !== null && db.officialPosts[o.postId]!.seatCount === 1)!;
    const postId = seated.postId!;
    expect(getPostOccupancy(s, db, postId)).toBe(1);
    expect(getVacantSeatCount(s, db, postId)).toBe(0);
    expect(isPostVacant(s, db, postId)).toBe(false);
  });

  it("retiring an official opens the seat", () => {
    const s = createNewGameState(db, 1);
    const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
    const postId = seated.postId!;
    const r = retireOfficial(s, seated.id, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getPostOccupancy(r.value, db, postId)).toBe(getPostOccupancy(s, db, postId) - 1);
    expect(isPostVacant(r.value, db, postId)).toBe(true);
    expect(getVacantPosts(r.value, db).some((v) => v.postId === postId)).toBe(true);
  });

  it("multi-seat returns remaining count, not a boolean", () => {
    let s = createNewGameState(db, 1);
    // 取一个尚有 ≥2 空席的多席官职（worldgen 可能已占用部分席位，故以实时空席为准）。
    const multi = Object.values(db.officialPosts).find((p) => p.seatCount >= 3 && getVacantSeatCount(s, db, p.id) >= 2)!;
    const base = getPostOccupancy(s, db, multi.id);
    const movers = Object.values(s.officials).filter((o) => o.status === "active" && o.postId !== multi.id).slice(0, 2);
    for (const m of movers) {
      const r = assignOfficialPost(s, db, m.id, multi.id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.value;
    }
    expect(getPostOccupancy(s, db, multi.id)).toBe(base + 2);
    expect(getVacantSeatCount(s, db, multi.id)).toBe(multi.seatCount - (base + 2));
  });

  it("non-active officials do not count as occupants", () => {
    const s = createNewGameState(db, 1);
    const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
    const postId = seated.postId!;
    // 强制一个非法占职的 retired（绕过服务，仅测 selector 守卫）
    const corrupted = { ...s, officials: { ...s.officials, [seated.id]: { ...seated, status: "retired" as const } } };
    expect(getPostOccupancy(corrupted, db, postId)).toBe(0);
  });
});
