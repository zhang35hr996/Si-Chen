import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createLogger } from "../../src/engine/infra/logger";
import {
  autosave,
  CORRUPT_KEY_PREFIX,
  exportSaveText,
  hashContent,
  importSaveText,
  listSaves,
  loadWithRecovery,
  readSlot,
  SAVE_FORMAT_VERSION,
  writeSave,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage, type KVStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

/** A "played" state: one event resolved through the funnel, memory written. */
const playedState = (): GameState => {
  const result = applyEffects(db, createNewGameState(db), [
    { type: "favor", char: "shen_zhibai", delta: 3 },
    { type: "flag", key: "rite_scheduled", value: true },
    {
      type: "memory",
      char: "shen_zhibai",
      entry: { kind: "episodic", summary: "存档测试记忆。", strength: 30, retention: "slow", subjectIds: ["player"], perspective: "witness", triggerTags: ["test"], unresolved: false, emotions: {} },
    },
  ]);
  if (!result.ok) throw new Error("fixture failed");
  return result.value;
};

const setup = () => {
  const storage = createMemoryStorage();
  const logger = createLogger({ now: () => 0 });
  return { storage, logger };
};

describe("roundtrip", () => {
  it("write → read → deep-equal state, then continues identically", () => {
    const { storage, logger } = setup();
    const state = playedState();

    const written = writeSave(storage, db, state, "slot1", { logger });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.bytes).toBeLessThan(100_000); // localStorage ceiling watch
    expect(logger.entries().some((e) => e.message.includes("save written"))).toBe(true); // size logged

    const loaded = readSlot(storage, db, "slot1", { logger });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state).toEqual(state);
    expect(loaded.value.warnings).toEqual([]);

    // continues identically: same effect on saved-then-loaded state = same result
    const a = applyEffects(db, state, [{ type: "favor", char: "shen_zhibai", delta: 2 }]);
    const b = applyEffects(db, loaded.value.state, [{ type: "favor", char: "shen_zhibai", delta: 2 }]);
    expect(a).toEqual(b);
  });
});

describe("corruption ladder", () => {
  const tamper = (storage: KVStorage, mutate: (raw: string) => string) => {
    const key = "sichen.save.slot1";
    storage.set(key, mutate(storage.get(key)!));
  };

  it("checksum mismatch (devtools-edited save) → CORRUPT + quarantine, original removed", () => {
    const { storage, logger } = setup();
    writeSave(storage, db, playedState(), "slot1", { logger });
    tamper(storage, (raw) => raw.replace('"rite_scheduled":true', '"rite_scheduled":false'));

    const result = readSlot(storage, db, "slot1", { logger, now: () => 1234 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CORRUPT");
    expect(result.error.message).toContain("checksum");
    expect(storage.get("sichen.save.slot1")).toBeNull(); // moved, not destroyed
    expect(storage.get(`${CORRUPT_KEY_PREFIX}1234`)).not.toBeNull();
  });

  it("invalid JSON and malformed envelopes quarantine too", () => {
    const { storage, logger } = setup();
    storage.set("sichen.save.slot1", "{not json");
    expect(readSlot(storage, db, "slot1", { logger }).ok).toBe(false);
    expect(storage.keys().some((k) => k.startsWith(CORRUPT_KEY_PREFIX))).toBe(true);

    storage.set("sichen.save.slot2", JSON.stringify({ hello: "world" }));
    const result = readSlot(storage, db, "slot2", { logger });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CORRUPT");
  });

  it("a FUTURE format version is refused but NOT quarantined", () => {
    const { storage, logger } = setup();
    writeSave(storage, db, playedState(), "slot1", { logger });
    tamper(storage, (raw) => raw.replace(`"formatVersion":${SAVE_FORMAT_VERSION}`, '"formatVersion":99'));

    const result = readSlot(storage, db, "slot1", { logger });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FUTURE_VERSION");
    expect(storage.get("sichen.save.slot1")).not.toBeNull(); // future data preserved in place
  });

  it("save referencing unknown content ids is quarantined with MISSING_REF", () => {
    const { storage, logger } = setup();
    const state: GameState = {
      ...playedState(),
      eventLog: [{ eventId: "ev_ghost", firedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } }],
    };
    writeSave(storage, db, state, "slot1", { logger });
    const result = readSlot(storage, db, "slot1", { logger });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MISSING_REF");
      expect(result.error.message).toContain("ev_ghost");
      expect(result.error.message).toContain("已隔离"); // severe tier: quarantined, not loaded
    }
  });
});

describe("content mismatch warning", () => {
  it("hash mismatch loads with a VISIBLE warning when ids still resolve", () => {
    const { storage, logger } = setup();
    writeSave(storage, db, playedState(), "slot1", { logger });

    const changedDb = { ...db, contentVersion: "0.2.0" } as ContentDB;
    expect(hashContent(changedDb)).not.toBe(hashContent(db));

    const result = readSlot(storage, changedDb, "slot1", { logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]?.code).toBe("CONTENT_MISMATCH");
    expect(result.value.warnings[0]?.message).toContain("不一致");
    expect(result.value.warnings[0]?.message).toContain("可载入");
    expect(logger.entries().some((e) => e.message.includes("CONTENT_MISMATCH"))).toBe(true); // never silent
  });
});

describe("autosave rotation + recovery ladder", () => {
  it("autosave rotates auto → auto.prev", () => {
    const { storage, logger } = setup();
    const first = playedState();
    autosave(storage, db, first, { logger });
    const second = { ...first, playerLocation: "yuhuayuan" };
    autosave(storage, db, second, { logger });

    const auto = readSlot(storage, db, "auto", { logger });
    const prev = readSlot(storage, db, "auto.prev", { logger });
    expect(auto.ok && auto.value.state.playerLocation).toBe("yuhuayuan");
    expect(prev.ok && prev.value.state.playerLocation).toBe("zichendian");
  });

  it("corrupt auto recovers from auto.prev with a warning", () => {
    const { storage, logger } = setup();
    autosave(storage, db, playedState(), { logger });
    autosave(storage, db, playedState(), { logger }); // auto + auto.prev both valid
    storage.set("sichen.save.auto", "{broken");

    const result = loadWithRecovery(storage, db, { logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usedSlot).toBe("auto.prev");
    expect(result.value.warnings.some((w) => w.code === "RECOVERED")).toBe(true);

    const both = createMemoryStorage();
    const failed = loadWithRecovery(both, db, { logger });
    expect(failed.ok).toBe(false); // nothing to recover → UI offers slots/new game
  });
});

describe("storage failure + listing + import/export", () => {
  it("quota/unavailable write returns SaveError:STORAGE and logs once — play continues", () => {
    const throwing: KVStorage = {
      get: () => null,
      set: () => {
        throw new Error("QuotaExceededError");
      },
      remove: () => {},
      keys: () => [],
    };
    const logger = createLogger({ now: () => 0 });
    const result = writeSave(throwing, db, playedState(), "slot1", { logger });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STORAGE");
    expect(logger.entries()).toHaveLength(1);
  });

  it("listSaves never throws: empty / ok / corrupt statuses", () => {
    const { storage, logger } = setup();
    writeSave(storage, db, playedState(), "slot1", { logger, now: () => 42_000 });
    storage.set("sichen.save.slot2", "{broken");
    const infos = listSaves(storage);
    expect(infos.find((s) => s.slot === "slot1")).toMatchObject({ status: "ok" });
    expect(infos.find((s) => s.slot === "slot2")?.status).toBe("corrupt");
    expect(infos.find((s) => s.slot === "slot3")?.status).toBe("empty");
    expect(infos.find((s) => s.slot === "slot1")?.createdAt).toBe(new Date(42_000).toISOString());
  });

  it("export → import roundtrips through the same validation ladder", () => {
    const state = playedState();
    const text = exportSaveText(db, state);
    const imported = importSaveText(db, text);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.value.state).toEqual(state);

    expect(importSaveText(db, "not json").ok).toBe(false);
    expect(importSaveText(db, JSON.stringify({ nope: 1 })).ok).toBe(false);
  });
});
