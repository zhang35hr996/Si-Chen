/** 候补池/科举字段存档（Phase 3 PR3A）：round-trip 稳定；v11 旧档经 MIGRATIONS[11] 补空。 */
import { describe, it, expect } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  createSaveData,
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { settleAnnualExamination } from "../../src/engine/officials/examination";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

describe("examination save", () => {
  it("SAVE_FORMAT_VERSION ≥ 12", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(12);
  });

  it("round-trips officialCandidates + examinationResults", () => {
    let s = createNewGameState(db, 1);
    s = settleAnnualExamination(s, db, 1, at(1));
    s = settleAnnualExamination(s, db, 2, at(2));
    expect(Object.keys(s.officialCandidates).length).toBeGreaterThan(0);

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, s, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.officialCandidates).toEqual(s.officialCandidates);
    expect(loaded.value.state.examinationResults).toEqual(s.examinationResults);
  });

  it("an eligible candidate in its expiry YEAR's January (before Feb settlement) round-trips (not quarantined)", () => {
    // 年-1 入榜，expiresAtYear=6。六年正月、六年科举尚未结算 → 仍 eligible 合法。
    const s1 = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    const expiry = Object.values(s1.officialCandidates)[0]!.expiresAtYear;
    const jan: GameState = { ...s1, calendar: { ...s1.calendar, year: expiry, month: 1, period: "early", dayIndex: dayIndexOf(expiry, 1, "early") } };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, jan, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 10 });
    expect(loaded.ok).toBe(true); // 合法存档不被隔离
    if (!loaded.ok) return;
    expect(Object.values(loaded.value.state.officialCandidates).some((c) => c.status === "eligible")).toBe(true);
  });

  it("after the expiry year's February settlement the cohort is expired and still round-trips", () => {
    const s1 = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    const expiry = Object.values(s1.officialCandidates)[0]!.expiresAtYear;
    // 摆到 expiry 年二月并结算该年科举 → 年-1 cohort 转 expired，最新结算年 = expiry。
    const feb = settleAnnualExamination({ ...s1, calendar: { ...s1.calendar, year: expiry, month: 2, period: "early", dayIndex: dayIndexOf(expiry, 2, "early") } }, db, expiry, at(expiry));
    expect(Object.values(feb.officialCandidates).some((c) => c.examinationYear === 1 && c.status === "expired")).toBe(true);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, feb, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 11 });
    expect(loaded.ok).toBe(true);
  });

  it("v11 old save is rejected as OBSOLETE_VERSION (not quarantined)", () => {
    const s = createNewGameState(db, 1);
    const stateV11 = { ...s } as Record<string, unknown>;
    delete stateV11["officialCandidates"];
    delete stateV11["examinationResults"];
    const env = {
      ...createSaveData(db, s, "slot1"),
      formatVersion: 11,
      state: stateV11,
      checksum: checksumOf(stateV11 as unknown as GameState),
    };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 2 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("OBSOLETE_VERSION");
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).not.toBeNull();
  });
});
