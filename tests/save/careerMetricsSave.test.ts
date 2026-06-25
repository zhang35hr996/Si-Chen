/** 官员能力/履历存档（Phase 3 PR3C-1）：round-trip 稳定；v13 旧档经 MIGRATIONS[13] 确定性回填。 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { deriveOfficialAptitude, initialReviewState } from "../../src/engine/officials/careerMetrics";
import { appointOfficialCandidate, appointedOfficialId } from "../../src/engine/officials/appointment";
import { settleAnnualExamination, getEligibleOfficialCandidates } from "../../src/engine/officials/examination";
import { getVacantPosts } from "../../src/engine/officials/selectors";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

const db = loadRealContent();

describe("career-metrics save", () => {
  it("SAVE_FORMAT_VERSION ≥ 14", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(14);
  });

  it("round-trips aptitude + reviewState", () => {
    const s = createNewGameState(db, 1);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, s, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.officials).toEqual(s.officials);
  });

  it("v13 save (officials without metrics) migrates with deterministic backfill", () => {
    const s = createNewGameState(db, 2);
    const officialId = Object.keys(s.officials)[0]!;
    // 构造 v13 state：去掉所有官员的 aptitude/reviewState。
    const stripped: Record<string, unknown> = {};
    for (const [id, o] of Object.entries(s.officials)) {
      const { aptitude: _a, reviewState: _r, ...rest } = o;
      stripped[id] = rest;
    }
    const stateV13 = { ...s, officials: stripped } as unknown as GameState;
    const env = { ...createSaveData(db, s, "slot1"), formatVersion: 13, state: stateV13, checksum: checksumOf(stateV13) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));

    const loaded = readSlot(storage, db, "slot1", { now: () => 2 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const off = loaded.value.state.officials[officialId]!;
    expect(off.aptitude).toEqual(deriveOfficialAptitude(officialId, s.rngSeed)); // 与 worldgen 同口径
    expect(off.reviewState).toEqual(initialReviewState());
  });

  it("v13 candidate-appointed official inherits the CANDIDATE's aptitude (not derived) on migrate", () => {
    // 真实 v13：候补授官后，把正式官员的 aptitude/reviewState 删掉模拟旧档；候补仍保留能力+appointedOfficialId。
    let s = settleAnnualExamination(createNewGameState(db, 5), db, 1, at(1));
    const c = getEligibleOfficialCandidates(s)[0]!;
    const r = appointOfficialCandidate(s, db, c.id, getVacantPosts(s, db)[0]!.postId, at(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.value;
    const offId = appointedOfficialId(c.id);
    const candAptitude = s.officialCandidates[c.id]!.aptitude;

    const officials: Record<string, unknown> = {};
    for (const [id, o] of Object.entries(s.officials)) {
      const { aptitude: _a, reviewState: _r, ...rest } = o;
      officials[id] = rest;
    }
    const stateV13 = { ...s, officials } as unknown as GameState;
    const env = { ...createSaveData(db, s, "slot1"), formatVersion: 13, state: stateV13, checksum: checksumOf(stateV13) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));

    const loaded = readSlot(storage, db, "slot1", { now: () => 5 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const off = loaded.value.state.officials[offId]!;
    expect(off.aptitude).toEqual(candAptitude); // 继承候补能力
    expect(off.aptitude).not.toEqual(deriveOfficialAptitude(offId, s.rngSeed)); // 而非派生
  });

  it("migration preserves an already-present (custom) aptitude — never recomputes on load", () => {
    const s = createNewGameState(db, 3);
    const officialId = Object.keys(s.officials)[0]!;
    const custom = { governance: 1, scholarship: 2, military: 3, integrity: 4 };
    const officials: Record<string, unknown> = { ...s.officials };
    officials[officialId] = { ...s.officials[officialId]!, aptitude: custom };
    // 标成 v13 但保留自定义 aptitude（其余官员仍有 metrics）。
    const stateV13 = { ...s, officials } as unknown as GameState;
    const env = { ...createSaveData(db, s, "slot1"), formatVersion: 13, state: stateV13, checksum: checksumOf(stateV13) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 3 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.officials[officialId]!.aptitude).toEqual(custom); // 不被重算覆盖
  });
});
