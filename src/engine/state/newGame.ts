/**
 * New game from content (skeleton-plan §5): world.json + character files
 * become the initial GameState. The ContentDB is already cross-validated,
 * so this is a pure, deterministic mapping.
 */
import { createCalendar, toGameTime } from "../calendar/time";
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import { generateOfficialWorld } from "../officials/worldgen";
import { assertGeneratedOfficialWorld } from "../officials/validation";
import type { BedchamberRecord, CharacterMemoryStore, GameState, CharacterStanding } from "./types";
import { createEmptyJusticeState } from "../justice/types";

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
  character: {
    kind: string;
    hidden?: { affection?: number; fear?: number; ambition?: number; loyalty?: number };
    initialStanding?: Partial<CharacterStanding>;
    attributes?: { health: number };
  },
  startTime: GameTime,
): Partial<CharacterStanding> {
  if (character.kind !== "consort") return {};
  return {
    ...(character.hidden ? {
      affection: character.hidden.affection ?? 50,
      fear:      character.hidden.fear      ?? 30,
      ambition:  character.hidden.ambition  ?? 35,
      loyalty:   character.hidden.loyalty   ?? 50,
    } : {}),
    palaceEnteredAt: character.initialStanding?.palaceEnteredAt ?? startTime,
    health: (character as { attributes?: { health: number } }).attributes?.health ?? 100,
    healthStatus: "healthy",
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

  // 官员世界（官职席位/官员/家族/成员/亲缘/侍君母族关联）一次性确定性生成。
  const officialWorld = generateOfficialWorld(db, rngSeed, startTime);

  for (const character of Object.values(db.characters)) {
    if (character.initialStanding) {
      const birthFamilyId = officialWorld.consortBirthFamily[character.id];
      standing[character.id] = {
        ...character.initialStanding,
        ...consortStandingExtras(character, startTime),
        ...(birthFamilyId !== undefined ? { birthFamilyId } : {}),
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

  const newState: GameState = {
    calendar,
    playerLocation: db.world.startingLocation,
    taihou: { health: 70, healthStatus: "healthy" },
    resources: {
      sovereign: { ...db.world.startingResources.sovereign, healthStatus: "healthy" as const },
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
    generatedConsorts: {},
    officials: officialWorld.officials,
    officialFamilies: officialWorld.officialFamilies,
    familyMembers: officialWorld.familyMembers,
    kinship: officialWorld.kinship,
    pendingRetirements: [],
    officialHistory: [],
    officialCandidates: {},
    examinationResults: [],
    annualReviews: [],
    personnelDecisions: {},
    memories,
    bedchamber,
    eventLog: [],
    chronicle: [],
    statusEffects: [],
    haremAdministration: { mode: "empress" },
    justice: createEmptyJusticeState(),
    emotionalConditions: [],
    mentionLog: [],
    eventReactionLog: [],
    sceneHistory: [],
    pendingAftermath: [],
    coldPalaceIncidents: [],
    rngSeed,
  };

  // 开局自检（fail-fast）：持久不变量 + 生成期年龄合理性。仅在建档时执行一次（唯一入口），
  // 数据量小，非重复扫描。load/import 路径只跑 validateOfficialWorld（不含年龄差）。
  const integrity = assertGeneratedOfficialWorld(newState, db);
  if (integrity.length > 0) {
    const first = integrity[0]!;
    throw new Error(`createNewGameState: official world integrity failed (${first.code}): ${first.message}`);
  }

  return newState;
}
