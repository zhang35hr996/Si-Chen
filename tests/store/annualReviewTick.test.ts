/** 吏部考课经时间事务触发（Phase 3 PR3C-2）+ 存档。 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { hasReviewedYear, getLatestAnnualReview } from "../../src/engine/officials/annualReview";
import { settleAnnualExamination } from "../../src/engine/officials/examination";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createSaveData, readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { checksumOf } from "../../src/engine/save/canonical";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const examAt = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

describe("annual review fires through the time transaction", () => {
  it("crossing into 十一月 runs the review once; idempotent within the month; world valid", () => {
    let s = settleAnnualExamination(createNewGameState(db, 7), db, 1, examAt(1));
    const store = new GameStore();
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 10, period: "late", dayIndex: dayIndexOf(1, 10, "late"), ap: 1 } });
    expect(hasReviewedYear(store.getState(), 1)).toBe(false);
    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.month).toBe(11);
    expect(hasReviewedYear(store.getState(), 1)).toBe(true);
    expect(getLatestAnnualReview(store.getState())!.year).toBe(1);
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
    // 同月再推进不重复考课。
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    expect(store.getState().annualReviews.filter((rec) => rec.year === 1)).toHaveLength(1);
    s = store.getState();
  });

  it("catch-up: loaded past 十一月 with no review still runs once on next advance", () => {
    const s = settleAnnualExamination(createNewGameState(db, 3), db, 1, examAt(1));
    const store = new GameStore();
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 11, period: "late", dayIndex: dayIndexOf(1, 11, "late"), ap: 1 }, annualReviews: [] });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 }); // → 十二月
    expect(hasReviewedYear(store.getState(), 1)).toBe(true);
  });
});

describe("annual review save", () => {
  it("SAVE_FORMAT_VERSION ≥ 15; round-trips annualReviews", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(15);
    const s = settleAnnualExamination(createNewGameState(db, 1), db, 1, examAt(1));
    const store = new GameStore();
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 11, period: "early", dayIndex: dayIndexOf(1, 11, "early"), ap: 6 } });
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    const reviewed = store.getState();
    expect(reviewed.annualReviews.length).toBeGreaterThan(0);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, reviewed, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.state.annualReviews).toEqual(reviewed.annualReviews);
  });

  it("v14 old save (no annualReviews) migrates to current", () => {
    const s = createNewGameState(db, 1) as unknown as Record<string, unknown>;
    delete s["annualReviews"];
    const env = { ...createSaveData(db, s as unknown as GameState, "slot1"), formatVersion: 14, state: s, checksum: checksumOf(s as unknown as GameState) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 2 });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.state.annualReviews).toEqual([]);
  });
});

/** 多年 exam + review 连续运行后世界仍合法、可存档。 */
describe("long sweep — exam + annual review over years", () => {
  it("seeds 1..8 over 8 years stay valid + save/load", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const store = new GameStore();
      store.loadState(createNewGameState(db, seed));
      let guard = 0;
      while (store.getState().calendar.year < 8 && guard < 400) {
        const r = store.advanceTime(db, { type: "SKIP_REMAINDER" });
        if (!r.ok || r.value.healthOutcome?.sovereignDied) break;
        guard += 1;
      }
      const st = store.getState();
      const errs = validateOfficialWorld(st, db);
      if (errs.length) throw new Error(`seed ${seed}: ${errs.map((e) => e.code).join(",")}`);
      const storage = createMemoryStorage();
      storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, st, "slot1")));
      expect(readSlot(storage, db, "slot1", { now: () => seed }).ok).toBe(true);
    }
  });
});
