/**
 * Versioned save system (skeleton-plan §9).
 *
 * Load ladder per slot: parse → envelope → version gate → migrations →
 * checksum → state schema → content-id cross-check → contentHash warning.
 * Any corruption quarantines the blob to `sichen.corrupt.<ts>` (user data is
 * never destroyed) and the original key is removed. Future versions are
 * REFUSED but not quarantined. Mid-scene saving is structurally impossible:
 * no save UI is reachable from the dialogue screen, and SceneSessions are
 * never serialized.
 */
import type { ContentDB } from "../content/loader";
import { saveError, type GameError } from "../infra/errors";
import type { RingBufferLogger } from "../infra/logger";
import { err, ok, type Result } from "../infra/result";
import type { GameState } from "../state/types";
import { canonicalStringify, checksumOf, fnv1a64Hex } from "./canonical";
import { gameStateSchema, saveEnvelopeSchema, type SaveEnvelope } from "./stateSchema";
import type { KVStorage } from "./storage";

export const SAVE_FORMAT_VERSION = 3;
export const ENGINE_VERSION = "0.1.0";
export const SAVE_KEY_PREFIX = "sichen.save.";
export const CORRUPT_KEY_PREFIX = "sichen.corrupt.";

export const MANUAL_SLOTS = ["slot1", "slot2", "slot3"] as const;
export const ALL_SLOTS = ["auto", "auto.prev", ...MANUAL_SLOTS] as const;
export type SaveSlot = (typeof ALL_SLOTS)[number];

/**
 * Migration chain: vN → vN+1 steps. Each receives the parsed envelope and must
 * return a new envelope with a bumped formatVersion and a recomputed checksum
 * (the checksum gate runs AFTER migrations).
 *
 * v1 → v2: single-line `gestation?` → multi-line `gestations[]`.
 */
const MIGRATIONS: Record<number, (old: unknown) => unknown> = {
  1: (old) => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    const bloodline = ((state.resources as Record<string, unknown> | undefined)?.bloodline ??
      {}) as Record<string, unknown>;
    const single = bloodline.gestation;
    delete bloodline.gestation;
    bloodline.gestations = single !== undefined && single !== null ? [single] : [];
    return { ...env, formatVersion: 2, state, checksum: checksumOf(state) };
  },
  2: (old) => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    const bloodline = ((state.resources as Record<string, unknown> | undefined)?.bloodline ??
      {}) as Record<string, unknown>;
    const heirs = (bloodline.heirs as Record<string, unknown>[] | undefined) ?? [];
    for (const h of heirs) {
      if (h.petName === undefined) h.petName = "";
      if (h.education === undefined) h.education = { scholarship: 5, martial: 5, virtue: 5 };
    }
    return { ...env, formatVersion: 3, state, checksum: checksumOf(state) };
  },
};

export interface SaveSystemOptions {
  logger?: RingBufferLogger;
  now?: () => number;
}

export interface SaveData extends SaveEnvelope {
  state: GameState;
}

export interface LoadedSave {
  state: GameState;
  warnings: GameError[];
  /** Envelope summary for previews (e.g. the import flow before it writes a slot). */
  meta: { createdAt: string; contentVersion: string; slot: string };
}

const keyOf = (slot: SaveSlot): string => `${SAVE_KEY_PREFIX}${slot}`;

export function hashContent(db: ContentDB): string {
  return fnv1a64Hex(canonicalStringify(db));
}

export function createSaveData(
  db: ContentDB,
  state: GameState,
  slot: string,
  options: SaveSystemOptions = {},
): SaveData {
  return {
    formatVersion: SAVE_FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    contentVersion: db.contentVersion,
    contentHash: hashContent(db),
    createdAt: new Date((options.now ?? Date.now)()).toISOString(),
    slot,
    checksum: checksumOf(state),
    state,
  };
}

export function writeSave(
  storage: KVStorage,
  db: ContentDB,
  state: GameState,
  slot: SaveSlot,
  options: SaveSystemOptions = {},
): Result<{ key: string; bytes: number }, GameError> {
  const payload = JSON.stringify(createSaveData(db, state, slot, options));
  try {
    storage.set(keyOf(slot), payload);
  } catch (cause) {
    const error = saveError("STORAGE", `cannot write save "${slot}" (quota/unavailable)`, {
      context: { slot },
      cause,
    });
    options.logger?.logGameError(error);
    return err(error);
  }
  // Save size is logged from day one — the localStorage ceiling is ~5 MB.
  options.logger?.info(`save written: ${slot}`, { bytes: payload.length });
  return ok({ key: keyOf(slot), bytes: payload.length });
}

/** Rotate auto → auto.prev, then write the new auto (corruption safety net). */
export function autosave(
  storage: KVStorage,
  db: ContentDB,
  state: GameState,
  options: SaveSystemOptions = {},
): Result<{ key: string; bytes: number }, GameError> {
  const previous = storage.get(keyOf("auto"));
  if (previous !== null) {
    try {
      storage.set(keyOf("auto.prev"), previous);
    } catch {
      // rotation is best-effort; the fresh autosave below still reports failures
    }
  }
  return writeSave(storage, db, state, "auto", options);
}

function quarantine(
  storage: KVStorage,
  slot: SaveSlot,
  raw: string,
  options: SaveSystemOptions,
): string {
  const corruptKey = `${CORRUPT_KEY_PREFIX}${(options.now ?? Date.now)()}`;
  try {
    storage.set(corruptKey, raw);
    storage.remove(keyOf(slot)); // preserved under the corrupt key — never destroyed
  } catch {
    // if even quarantine fails, leave the original in place
  }
  return corruptKey;
}

/** Validate a parsed save against content — shared by slot reads and imports. */
function validateSave(
  db: ContentDB,
  data: unknown,
): Result<LoadedSave, { error: GameError; quarantineWorthy: boolean }> {
  const envelope = saveEnvelopeSchema.safeParse(data);
  if (!envelope.success) {
    return err({
      error: saveError("CORRUPT", "save envelope is malformed"),
      quarantineWorthy: true,
    });
  }
  let save = envelope.data;

  if (save.formatVersion > SAVE_FORMAT_VERSION) {
    // A future version is not corruption — refuse, never destroy.
    return err({
      error: saveError("FUTURE_VERSION", `save format v${save.formatVersion} is newer than v${SAVE_FORMAT_VERSION}`),
      quarantineWorthy: false,
    });
  }
  for (let v = save.formatVersion; v < SAVE_FORMAT_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) {
      return err({
        error: saveError("CORRUPT", `no migration from save format v${v}`),
        quarantineWorthy: true,
      });
    }
    const migrated = saveEnvelopeSchema.safeParse(migrate(save));
    if (!migrated.success) {
      return err({
        error: saveError("CORRUPT", `migration from v${v} produced an invalid save`),
        quarantineWorthy: true,
      });
    }
    save = migrated.data;
  }

  if (checksumOf(save.state) !== save.checksum) {
    return err({
      error: saveError("CORRUPT", "checksum mismatch — save content was altered or truncated"),
      quarantineWorthy: true,
    });
  }

  const parsedState = gameStateSchema.safeParse(save.state);
  if (!parsedState.success) {
    return err({
      error: saveError("CORRUPT", `saved state fails validation: ${parsedState.error.issues[0]?.message ?? ""}`),
      quarantineWorthy: true,
    });
  }
  const state = parsedState.data;

  // Content-id cross-check: a save may only load against content that still
  // knows every id it references.
  const missing: string[] = [];
  if (state.playerLocation !== "" && !db.locations[state.playerLocation]) {
    missing.push(`location:${state.playerLocation}`);
  }
  for (const charId of [
    ...Object.keys(state.relationships),
    ...Object.keys(state.standing),
    ...Object.keys(state.memories),
  ]) {
    if (!db.characters[charId]) missing.push(`character:${charId}`);
  }
  for (const entry of state.eventLog) {
    if (!db.events[entry.eventId]) missing.push(`event:${entry.eventId}`);
  }
  for (const sceneId of state.sceneHistory) {
    if (!db.scenes[sceneId]) missing.push(`scene:${sceneId}`);
  }
  // Severe tier: the save points at content objects that no longer exist.
  // It cannot load coherently → quarantine, never silently load (plan §9).
  if (missing.length > 0) {
    const refs = [...new Set(missing)];
    return err({
      error: saveError("MISSING_REF", `存档引用了当前内容不存在的对象（${refs.join("、")}），已隔离`, {
        context: { missing: refs },
      }),
      quarantineWorthy: true,
    });
  }

  // Warn tier: every referenced id still resolves, but the content changed
  // since the save. Loadable, but values may read oddly → visible warning,
  // never silent (plan §9). This is NOT the severe tier above.
  const warnings: GameError[] = [];
  if (save.contentHash !== hashContent(db) || save.contentVersion !== db.contentVersion) {
    warnings.push(
      saveError(
        "CONTENT_MISMATCH",
        `存档内容版本（${save.contentVersion}）与当前（${db.contentVersion}）不一致：可载入，但部分内容可能与存档时不同`,
        {
          severity: "warn",
          context: { saved: save.contentVersion, current: db.contentVersion },
        },
      ),
    );
  }
  return ok({
    state,
    warnings,
    meta: { createdAt: save.createdAt, contentVersion: save.contentVersion, slot: save.slot },
  });
}

export function readSlot(
  storage: KVStorage,
  db: ContentDB,
  slot: SaveSlot,
  options: SaveSystemOptions = {},
): Result<LoadedSave, GameError> {
  const raw = storage.get(keyOf(slot));
  if (raw === null) {
    return err(saveError("NOT_FOUND", `no save in slot "${slot}"`, { severity: "warn" }));
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    const key = quarantine(storage, slot, raw, options);
    const error = saveError("CORRUPT", `slot "${slot}" is not valid JSON; quarantined to ${key}`, {
      context: { slot, quarantineKey: key },
    });
    options.logger?.logGameError(error);
    return err(error);
  }

  const validated = validateSave(db, data);
  if (!validated.ok) {
    if (validated.error.quarantineWorthy) {
      const key = quarantine(storage, slot, raw, options);
      const error = saveError(validated.error.error.code, `slot "${slot}": ${validated.error.error.message}; quarantined to ${key}`, {
        context: { ...validated.error.error.context, slot, quarantineKey: key },
      });
      options.logger?.logGameError(error);
      return err(error);
    }
    options.logger?.logGameError(validated.error.error);
    return err(validated.error.error);
  }
  for (const warning of validated.value.warnings) options.logger?.logGameError(warning);
  return ok(validated.value);
}

export interface RecoveredSave extends LoadedSave {
  usedSlot: SaveSlot;
}

/** auto → auto.prev recovery ladder (UI offers older slots / new game after). */
export function loadWithRecovery(
  storage: KVStorage,
  db: ContentDB,
  options: SaveSystemOptions = {},
): Result<RecoveredSave, GameError[]> {
  const errors: GameError[] = [];
  for (const slot of ["auto", "auto.prev"] as const) {
    const result = readSlot(storage, db, slot, options);
    if (result.ok) {
      if (slot === "auto.prev") {
        const warning = saveError("RECOVERED", "自动存档已损坏，已从上一份自动存档恢复", {
          severity: "warn",
        });
        options.logger?.logGameError(warning);
        return ok({ ...result.value, warnings: [...result.value.warnings, warning], usedSlot: slot });
      }
      return ok({ ...result.value, usedSlot: slot });
    }
    errors.push(result.error);
  }
  return err(errors);
}

export interface SlotInfo {
  slot: SaveSlot;
  status: "empty" | "ok" | "corrupt";
  createdAt?: string;
}

/** Shallow listing for the save menu — never quarantines, never throws. */
export function listSaves(storage: KVStorage): SlotInfo[] {
  return ALL_SLOTS.map((slot) => {
    const raw = storage.get(keyOf(slot));
    if (raw === null) return { slot, status: "empty" as const };
    try {
      const data = JSON.parse(raw) as { createdAt?: unknown };
      return {
        slot,
        status: "ok" as const,
        ...(typeof data.createdAt === "string" ? { createdAt: data.createdAt } : {}),
      };
    } catch {
      return { slot, status: "corrupt" as const };
    }
  });
}

/** Export the LIVE state as a save file payload (debug + user backup). */
export function exportSaveText(db: ContentDB, state: GameState, options: SaveSystemOptions = {}): string {
  return JSON.stringify(createSaveData(db, state, "export", options), null, 2);
}

/** Import runs the exact same ladder as slot reads (minus quarantine). */
export function importSaveText(db: ContentDB, text: string): Result<LoadedSave, GameError> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err(saveError("CORRUPT", "导入的文件不是有效的存档 JSON"));
  }
  const validated = validateSave(db, data);
  if (!validated.ok) return err(validated.error.error);
  return ok(validated.value);
}
