/**
 * New game from content (skeleton-plan §5): world.json + character files
 * become the initial GameState. The ContentDB is already cross-validated,
 * so this is a pure, deterministic mapping.
 */
import { createCalendar, toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { BedchamberRecord, CharacterMemoryStore, GameState, CharacterStanding } from "./types";

export function memoryEntryId(charId: string, seq: number): string {
  return `mem_${charId}_${String(seq).padStart(6, "0")}`;
}

export function createNewGameState(db: ContentDB, rngSeed = 1): GameState {
  const calendar = createCalendar({
    ...db.world.calendar.start,
    apMax: db.world.calendar.apMax,
  });
  const startTime = toGameTime(calendar);

  const standing: Record<string, CharacterStanding> = {};
  const memories: Record<string, CharacterMemoryStore> = {};
  const bedchamber: Record<string, BedchamberRecord> = {};

  for (const character of Object.values(db.characters)) {
    if (character.initialStanding) {
      standing[character.id] = { ...character.initialStanding };
    }
    memories[character.id] = {
      entries: character.initialMemories.map((draft, index) => ({
        id: memoryEntryId(character.id, index + 1),
        kind: draft.kind,
        summary: draft.summary,
        salience: draft.salience,
        createdAt: startTime,
        tags: [...draft.tags],
        participants: [...draft.participants],
        ...(draft.locationId !== undefined ? { locationId: draft.locationId } : {}),
        source: "authored" as const, // 既有背景记忆 — may be protected
        protected: draft.protected,
      })),
      nextSeq: character.initialMemories.length + 1,
    };
    if (character.kind === "consort") {
      bedchamber[character.id] = { encounters: [] };
    }
  }

  return {
    calendar,
    playerLocation: db.world.startingLocation,
    taihou: { ill: false },
    resources: {
      sovereign: { ...db.world.startingResources.sovereign },
      nation: { ...db.world.startingResources.nation },
      bloodline: {
        ...db.world.startingResources.bloodline,
        pregnancy: { status: "none", candidateIds: [] },
        gestations: [],
        heirs: [],
      },
    },
    flags: {},
    standing,
    memories,
    bedchamber,
    eventLog: [],
    sceneHistory: [],
    rngSeed,
  };
}
