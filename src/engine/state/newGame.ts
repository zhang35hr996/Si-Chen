/**
 * New game from content (skeleton-plan §5): world.json + character files
 * become the initial GameState. The ContentDB is already cross-validated,
 * so this is a pure, deterministic mapping.
 */
import { createCalendar, toGameTime } from "../calendar/time";
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import { generateOfficials } from "../officials/generate";
import type { BedchamberRecord, CharacterMemoryStore, GameState, CharacterStanding } from "./types";

/** 新游戏私库种子（id 须存在于 content/items.json）。 */
const STOREHOUSE_SEED: Record<string, number> = {
  luozidai: 2,
  yunjin: 1,
  diaopi: 1,
  mingqian_longjing: 2,
  meihua_gao: 3,
};

export function memoryEntryId(charId: string, seq: number): string {
  return `mem_${charId}_${String(seq).padStart(6, "0")}`;
}

/**
 * 侍君 standing 的运行时补充：affection 初值 + 入宫时刻（不覆盖 authored）。
 * initialStanding 复用真实 `CharacterStanding`（Partial），避免手写缩窄形状导致
 * 测试对象字面量触发 excess-property error / 平行类型漂移。
 */
export function consortStandingExtras(
  character: { kind: string; hidden?: { affection: number }; initialStanding?: Partial<CharacterStanding> },
  startTime: GameTime,
): Partial<CharacterStanding> {
  if (character.kind !== "consort") return {};
  return {
    ...(character.hidden ? { affection: character.hidden.affection } : {}),
    palaceEnteredAt: character.initialStanding?.palaceEnteredAt ?? startTime,
  };
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
      standing[character.id] = {
        ...character.initialStanding,
        ...consortStandingExtras(character, startTime),
      };
    }
    memories[character.id] = {
      entries: character.initialMemories.map((draft, index) => ({
        id: memoryEntryId(character.id, index + 1),
        ownerId: character.id,
        kind: draft.kind,
        ...(draft.sourceEventId !== undefined ? { sourceEventId: draft.sourceEventId } : {}),
        subjectIds: [...draft.subjectIds],
        perspective: draft.perspective,
        summary: draft.summary,
        strength: draft.strength,
        retention: draft.retention,
        emotions: { ...draft.emotions },
        triggerTags: [...draft.triggerTags],
        unresolved: draft.unresolved,
        createdAt: startTime,
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
      storehouse: { items: { ...STOREHOUSE_SEED } },
    },
    flags: {},
    standing,
    officials: generateOfficials(db, rngSeed),
    memories,
    bedchamber,
    eventLog: [],
    chronicle: [],
    sceneHistory: [],
    rngSeed,
  };
}
