/** PR2B 名册/官位表 selector：状态筛选、高位空缺、未决告老。 */
import { describe, expect, it } from "vitest";
import {
  getHighVacancyPosts,
  getOfficialsByStatus,
  HIGH_POST_GRADE_ORDER,
  hasPendingRetirement,
} from "../../src/engine/officials/selectors";
import { retireOfficial } from "../../src/engine/officials/lifecycle";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const T = { year: 2, month: 1, period: "early" as const, dayIndex: 0 };

describe("getOfficialsByStatus", () => {
  it("partitions officials by status; retiring moves one out of active", () => {
    const s = createNewGameState(db, 1);
    const activeBefore = getOfficialsByStatus(s, "active").length;
    expect(getOfficialsByStatus(s, "retired")).toHaveLength(0);
    const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
    const r = retireOfficial(s, seated.id, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getOfficialsByStatus(r.value, "active").length).toBe(activeBefore - 1);
    expect(getOfficialsByStatus(r.value, "retired").map((o) => o.id)).toContain(seated.id);
  });
});

describe("getHighVacancyPosts", () => {
  it("only returns vacant posts at/above the high-grade threshold", () => {
    const s = createNewGameState(db, 1);
    const high = getHighVacancyPosts(s, db);
    for (const v of high) {
      expect(db.officialPosts[v.postId]!.gradeOrder).toBeGreaterThanOrEqual(HIGH_POST_GRADE_ORDER);
      expect(v.vacantSeatCount).toBeGreaterThan(0);
    }
    // 退掉一个高位官员 → 该高位官职出现在提醒中
    const highSeated = Object.values(s.officials).find((o) => o.postId !== null && db.officialPosts[o.postId]!.gradeOrder >= HIGH_POST_GRADE_ORDER);
    if (highSeated) {
      const r = retireOfficial(s, highSeated.id, T);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(getHighVacancyPosts(r.value, db).some((v) => v.postId === highSeated.postId)).toBe(true);
    }
  });
});

describe("hasPendingRetirement", () => {
  it("reflects pendingRetirements", () => {
    const s = createNewGameState(db, 1);
    const id = Object.keys(s.officials)[0]!;
    expect(hasPendingRetirement(s, id)).toBe(false);
    const withPending = { ...s, pendingRetirements: [{ officialId: id, requestedAt: T }] };
    expect(hasPendingRetirement(withPending, id)).toBe(true);
  });
});
