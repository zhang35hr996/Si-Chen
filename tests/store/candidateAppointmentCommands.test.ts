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
import { dayIndexOf } from "../../src/engine/calendar/time";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
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

describe("appointment survives official lifecycle aging (P1 regression)", () => {
  it("after crossing into next 正月 the official ages but the candidate freezes; validator + save/load OK", () => {
    // 年-1 二月授官，把日历摆到年-1 十二月下旬余 1 AP，推进跨入年-2 正月触发官员年度增龄。
    const store = storeWithExam();
    const c = getEligibleOfficialCandidates(store.getState())[0]!;
    const postId = getVacantPostsForCandidate(store.getState(), db, c.id)[0]!.postId;
    expect(store.appointOfficialCandidate(db, c.id, postId).ok).toBe(true);
    const offId = appointedOfficialId(c.id);
    const ageAtAppoint = store.getState().officials[offId]!.age;

    const s = store.getState();
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 12, period: "late", dayIndex: dayIndexOf(1, 12, "late"), ap: 1 } });
    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.year).toBe(2);

    const off = store.getState().officials[offId]!;
    if (off.status === "active") expect(off.age).toBe(ageAtAppoint + 1); // 官员增龄
    expect(store.getState().officialCandidates[c.id]!.age).toBe(ageAtAppoint); // 候补冻结
    expect(store.getState().officialCandidates[c.id]!.status).toBe("appointed");
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]); // 不再误判损坏

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, store.getState(), "slot1")));
    expect(readSlot(storage, db, "slot1", { now: () => 1 }).ok).toBe(true);
  });
});

describe("appointOfficialCandidate — rejects non-graded posts (P2)", () => {
  it("refuses a gradeOrder<=0 post even though it is not in getVacantPosts", () => {
    const store = storeWithExam();
    const c = getEligibleOfficialCandidates(store.getState())[0]!;
    const commoner = Object.values(db.officialPosts).find((p) => p.gradeOrder <= 0);
    if (!commoner) return; // 内容无平民席位则跳过
    const r = store.appointOfficialCandidate(db, c.id, commoner.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("OFFICIAL_BAD_POST");
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
