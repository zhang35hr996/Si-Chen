/** store 候补授官 + 榜单 acknowledged 命令（Phase 3 PR3B）。 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import {
  getEligibleOfficialCandidates,
  getUnacknowledgedExaminationResults,
  settleAnnualExamination,
} from "../../src/engine/officials/examination";
import { getVacantPostsForCandidate } from "../../src/engine/officials/candidateAppointmentSelectors";
import { appointedOfficialId } from "../../src/engine/officials/appointment";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

function storeWithExam(): GameStore {
  const store = new GameStore();
  store.loadState(settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1)));
  return store;
}

describe("appointOfficialCandidate command", () => {
  it("seats an official and updates candidate + occupancy; world stays valid", () => {
    const store = storeWithExam();
    const c = getEligibleOfficialCandidates(store.getState())[0]!;
    const postId = getVacantPostsForCandidate(store.getState(), db, c.id)[0]!.postId;
    const r = store.appointOfficialCandidate(db, c.id, postId);
    expect(r.ok).toBe(true);
    const s = store.getState();
    expect(s.officials[appointedOfficialId(c.id)]!.postId).toBe(postId);
    expect(s.officialCandidates[c.id]!.status).toBe("appointed");
    expect(validateOfficialWorld(s, db)).toEqual([]);
  });

  it("a failed appointment leaves the store state reference unchanged", () => {
    const store = storeWithExam();
    const before = store.getState();
    const r = store.appointOfficialCandidate(db, "cand_ghost", "post_ghost");
    expect(r.ok).toBe(false);
    expect(store.getState()).toBe(before);
  });
});

describe("acknowledgeExaminationResult command", () => {
  it("flips acknowledged once, idempotent", () => {
    const store = storeWithExam();
    expect(getUnacknowledgedExaminationResults(store.getState())).toHaveLength(1);
    expect(store.acknowledgeExaminationResult(1).ok).toBe(true);
    expect(getUnacknowledgedExaminationResults(store.getState())).toHaveLength(0);
    const ref = store.getState();
    expect(store.acknowledgeExaminationResult(1).ok).toBe(true);
    expect(store.getState()).toBe(ref); // 幂等：无变化
  });
});
