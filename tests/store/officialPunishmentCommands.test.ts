/** store 官员惩戒/行政升迁命令 + PunishmentRecord domain-neutral 迁移（Phase 3 PR3C-3a）。 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createSaveData, readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { checksumOf } from "../../src/engine/save/canonical";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const seatedHigh = (s: GameState) => Object.values(s.officials).find((o) => o.status === "active" && o.postId && db.officialPosts[o.postId]!.gradeOrder >= 10)!;
const lowerVacant = (s: GameState, fromGrade: number) =>
  Object.values(db.officialPosts).find((p) => p.gradeOrder > 0 && p.gradeOrder < fromGrade && Object.values(s.officials).filter((o) => o.postId === p.id).length < p.seatCount)!.id;

describe("store official punishment commands", () => {
  it("punishOfficial commits a record + survives save/load", () => {
    const store = new GameStore();
    store.loadState(createNewGameState(db, 1));
    const o = seatedHigh(store.getState());
    const target = lowerVacant(store.getState(), db.officialPosts[o.postId!]!.gradeOrder);
    const r = store.punishOfficial(db, { officialId: o.id, kind: "official_demotion", toPostId: target });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(store.getState().justice.punishments[r.value.punishmentId]!.targetKind).toBe("official");
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, store.getState(), "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.state.justice.punishments).toEqual(store.getState().justice.punishments);
  });

  it("promoteOfficialAdministratively commits without a PunishmentRecord", () => {
    const store = new GameStore();
    const base = createNewGameState(db, 1);
    const o0 = Object.values(base.officials).find((x) => x.status === "active" && x.postId)!;
    store.loadState({ ...base, officials: { ...base.officials, [o0.id]: { ...o0, postId: "xunjian", appointedAt: base.calendar } } });
    const target = Object.values(db.officialPosts).find((p) => p.gradeOrder > 4 && p.gradeOrder <= 6 && Object.values(store.getState().officials).filter((o) => o.postId === p.id).length < p.seatCount)!.id;
    const before = Object.keys(store.getState().justice.punishments).length;
    expect(store.promoteOfficialAdministratively(db, o0.id, target).ok).toBe(true);
    expect(Object.keys(store.getState().justice.punishments).length).toBe(before); // 无新增惩罚记录
  });
});

describe("v15 → v16 PunishmentRecord migration", () => {
  it("SAVE_FORMAT_VERSION ≥ 16; backfills targetKind='consort' on legacy records", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(16);
    const full = createNewGameState(db, 1);
    const t = { year: full.calendar.year, month: full.calendar.month, period: full.calendar.period, dayIndex: full.calendar.dayIndex };
    const s = full as unknown as Record<string, unknown>;
    // 注入一条不带 targetKind 的旧侍君惩罚记录（v15 形状）。
    const legacy = {
      id: "pun_000001", targetId: "consort_x", actorId: "player", kind: "rank_demotion",
      severity: "moderate", imposedAt: t, publicity: "palace",
      lifecycle: { status: "completed", resolvedAt: t, resolution: "immediate" },
      details: { fromRankId: "guiren", toRankId: "changzai" },
    };
    s.justice = { cases: {}, punishments: { pun_000001: legacy }, nextSeq: { case: 1, punishment: 2, charge: 1, evidence: 1, confession: 1, verdict: 1 } };
    const env = { ...createSaveData(db, s as unknown as GameState, "slot1"), formatVersion: 15, state: s, checksum: checksumOf(s as unknown as GameState) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 2 });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.state.justice.punishments.pun_000001!.targetKind).toBe("consort");
  });
});
