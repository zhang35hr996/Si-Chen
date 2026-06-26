/**
 * 大选（三年一次殿选）：日历门控触发、候选秀男生成、推荐位分、落库、NPC 自留。
 * 纯逻辑集中于此；殿选界面与 App 接线只调用本模块。确定性随机走 gestationRoll。
 */
import type { ContentDB } from "../engine/content/loader";
import { isAssignableRank, characterSchema, type CharacterRank, type CharacterContent, type EventEffect, type CanonicalReactionTrait } from "../engine/content/schemas";
import { gestationRoll, gestationRollRaw } from "../engine/characters/gestation";
import { chineseNumeral, dayIndexOf, MORNING_SLOT, shichenSlot, monthOrdinal, toGameTime } from "../engine/calendar/time";
import { memoryEntryId } from "../engine/state/newGame";
import {
  ARISTOCRATIC_SURNAME_POOL,
  ARISTOCRATIC_MALE_GIVEN_NAME_POOL,
} from "../engine/characters/shijunNames";
import type { GameState, KinshipRelation, PendingDaxuan } from "../engine/state/types";
import { getActiveSeatedOfficials } from "../engine/officials/selectors";
import { validateOfficialWorld } from "../engine/officials/validation";
import { isValidParentChildAge } from "../engine/officials/constraints";
import { materializePersonality, createDefaultHousehold } from "../engine/characters/consortAttrs";
import type { ConsortPersonality } from "../engine/state/types";
import { stateError, type GameError } from "../engine/infra/errors";
import { err, ok, type Result } from "../engine/infra/result";
import type { DecreeReaction } from "./empressDecree";
import type { ChengFengPrompt } from "./prompt";

// ── Personality generation helpers ───────────────────────────────────────────

type PersonalityKey = keyof ConsortPersonality;

/**
 * Base ranges for each personality dimension before trait biases are applied.
 * Using gestationRollRaw (full 32-bit) to avoid the % 100 modulo-bias present
 * in gestationRoll.
 */
const BASE_FLOORS: Record<PersonalityKey, number> = {
  intelligence: 30, scheming: 10, sociability: 20, compassion: 20,
  courage: 20, jealousy: 20, emotionalStability: 20, pride: 20,
};
const BASE_CEILINGS: Record<PersonalityKey, number> = {
  intelligence: 90, scheming: 70, sociability: 80, compassion: 80,
  courage: 80, jealousy: 80, emotionalStability: 80, pride: 80,
};

/** Per-trait minimum floor adjustments — ensure consistency between labels and numbers. */
const TRAIT_FLOORS: Partial<Record<CanonicalReactionTrait, Partial<Record<PersonalityKey, number>>>> = {
  calculating:      { scheming: 50, intelligence: 55 },
  compassionate:    { compassion: 65 },
  proud:            { pride: 60, emotionalStability: 50 },
  status_conscious: { pride: 55, jealousy: 50 },
  discreet:         { emotionalStability: 55 },
  blunt:            { courage: 50 },
  impulsive:        { courage: 45 },
};

/** Per-trait maximum ceiling adjustments — ensure consistency between labels and numbers. */
const TRAIT_CEILINGS: Partial<Record<CanonicalReactionTrait, Partial<Record<PersonalityKey, number>>>> = {
  cold:      { compassion: 35, sociability: 35 },
  impulsive: { emotionalStability: 45 },
  blunt:     { scheming: 40 },
};

/**
 * Pairs of reaction traits whose floor/ceiling constraints are mutually contradictory.
 * A candidate may not carry both members of any pair.
 * Example: calculating sets scheming floor=50, blunt sets scheming ceiling=40 → unsatisfiable.
 */
const INCOMPATIBLE_TRAIT_PAIRS: ReadonlyArray<readonly [CanonicalReactionTrait, CanonicalReactionTrait]> = [
  ["calculating", "blunt"],
  ["compassionate", "cold"],
  ["impulsive", "discreet"],
];

function traitConflicts(
  candidate: readonly CanonicalReactionTrait[],
  accumulated: ReadonlySet<CanonicalReactionTrait>,
): boolean {
  for (const [a, b] of INCOMPATIBLE_TRAIT_PAIRS) {
    const candHasA = candidate.includes(a), candHasB = candidate.includes(b);
    if ((candHasA && accumulated.has(b)) || (candHasB && accumulated.has(a))) return true;
    if (candHasA && candHasB) return true; // conflict within the entry itself
  }
  return false;
}

/**
 * Generate a ConsortPersonality deterministically from a seed string prefix,
 * biased by the character's canonical reaction traits for narrative consistency.
 */
function generatePersonality(seedPrefix: string, reactionTraits: CanonicalReactionTrait[]): ConsortPersonality {
  const floors = { ...BASE_FLOORS };
  const ceilings = { ...BASE_CEILINGS };

  for (const trait of reactionTraits) {
    for (const [k, v] of Object.entries(TRAIT_FLOORS[trait] ?? {})) {
      const key = k as PersonalityKey;
      floors[key] = Math.max(floors[key], v);
    }
    for (const [k, v] of Object.entries(TRAIT_CEILINGS[trait] ?? {})) {
      const key = k as PersonalityKey;
      ceilings[key] = Math.min(ceilings[key], v);
    }
  }

  const roll = (key: PersonalityKey, sub: string): number => {
    const lo = floors[key];
    // floor <= ceiling is guaranteed by INCOMPATIBLE_TRAIT_PAIRS filtering; no Math.max needed
    const hi = ceilings[key];
    return lo + (gestationRollRaw(`${seedPrefix}:${sub}`) % (hi - lo + 1));
  };

  return {
    intelligence:       roll("intelligence", "intel"),
    scheming:           roll("scheming", "scheme"),
    sociability:        roll("sociability", "social"),
    compassion:         roll("compassion", "cps"),
    courage:            roll("courage", "courage"),
    jealousy:           roll("jealousy", "jealous"),
    emotionalStability: roll("emotionalStability", "estab"),
    pride:              roll("pride", "pride"),
  };
}

/** 大选年：元年、四年、七年…（每三年）。 */
export function isDaxuanYear(year: number): boolean {
  return (year - 1) % 3 === 0;
}

export function daxuanAnnounceFlagKey(year: number): string {
  return `daxuan:announce:${year}`;
}

export function daxuanDianxuanFlagKey(year: number): string {
  return `daxuan:dianxuan:${year}`;
}

/** 皇后推荐位分：父官品(gradeOrder 18=正一品…) 或平民 → rank id。 */
export function recommendRank(grade: number | "commoner"): string {
  if (grade === "commoner") return "gengyi";
  if (grade >= 17) return "guiren";   // 一品/皇亲
  if (grade >= 13) return "meiren";   // 二三品
  if (grade >= 9) return "changzai";  // 四五品
  if (grade >= 5) return "daying";    // 六七品
  return "gengyi";                    // 八品以下
}

/** 初始恩宠随位分缩放：观南子(52)→10，皇贵驸(194)→20，线性，夹在 10–20。 */
export function initialFavorForRank(order: number): number {
  const raw = 10 + Math.round((10 * (order - 52)) / 142);
  return Math.max(10, Math.min(20, raw));
}

/** 玩家可选位分：order 50（观南子以上）–200（皇贵驸以下），排除皇后和已废弃位分；降序。 */
export function pickableRanks(db: ContentDB): CharacterRank[] {
  return Object.values(db.ranks)
    .filter((r) => isAssignableRank(r) && r.domain === "harem" && r.id !== "huanghou" && r.order >= 50 && r.order <= 200)
    .sort((a, b) => b.order - a.order);
}

// ── 生成池（确定性取样） ──────────────────────────────────────────────
const SPECIALTY_POOL = ["古筝", "琵琶", "书法", "丹青", "刺绣", "烹茶", "棋艺", "舞乐", "诗赋", "骑射"];
// Each pool entry carries the narrative display word AND its canonical reaction
// traits, so generated consorts never need free-text trait inference.
const TRAIT_POOL = [
  { display: "温婉", reactionTraits: ["compassionate", "discreet"] },
  { display: "活泼", reactionTraits: ["blunt"] },
  { display: "沉静", reactionTraits: ["discreet"] },
  { display: "孤傲", reactionTraits: ["proud", "cold"] },
  { display: "机敏", reactionTraits: ["calculating"] },
  { display: "腼腆", reactionTraits: ["discreet"] },
  { display: "爽利", reactionTraits: ["blunt"] },
  { display: "细腻", reactionTraits: ["compassionate"] },
  { display: "执拗", reactionTraits: ["proud"] },
  { display: "娴雅", reactionTraits: ["status_conscious", "discreet"] },
] as const satisfies readonly { display: string; reactionTraits: readonly CanonicalReactionTrait[] }[];
const LIKES_POOL = ["玉器", "香料", "古籍", "骏马", "茶饮", "花木", "字画", "珠玉", "琴谱", "棋具"];
const PORTRAIT_SETS = ["consort1", "consort2", "consort3", "consort4", "consort5", "consort6"];

function pick<T>(pool: readonly T[], seed: string): T {
  return pool[gestationRollRaw(seed) % pool.length]!;
}

/** 候选秀男（生成态，未落库）。 */
export interface Candidate {
  content: CharacterContent;
  /** 世家候选的生母官员 id（女尊：官员为母）。良家子则 undefined。 */
  motherOfficialId?: string;
  /** 母官品 gradeOrder，或平民。驱动皇后推荐位分。 */
  grade: number | "commoner";
  /** 礼官宣读词。 */
  announce: string;
}

/** 用 gestationRoll 确定性生成 8–12 位候选秀男。 */
export function generateCandidates(db: ContentDB, state: GameState, year: number): Candidate[] {
  const base = `daxuan:gen:${year}`;
  const count = 8 + (gestationRollRaw(`${base}:n`) % 5); // 8–12
  // 世家候选只能出自「在任且有有效官职」的官员（避免从已故/告老者中抽人）。
  const activeOfficials = getActiveSeatedOfficials(state, db);
  const out: Candidate[] = [];

  // 候选 id 须避开所有人物命名空间（authored/官员/家族成员/已落库动态侍君 + 本批已用）。
  const taken = new Set<string>([
    ...Object.keys(db.characters),
    ...Object.keys(state.officials),
    ...Object.keys(state.familyMembers),
    ...Object.keys(state.generatedConsorts),
  ]);
  let nextSeq = 0;
  const nextCandidateId = (): string => {
    let candId: string;
    do {
      candId = `xiunan_${year}_${nextSeq}`;
      nextSeq += 1;
    } while (taken.has(candId));
    taken.add(candId);
    return candId;
  };

  for (let i = 0; i < count; i++) {
    const seed = `${base}:${i}`;

    let surname: string;
    let motherOfficialId: string | undefined;
    let maternalClan: NonNullable<CharacterContent["maternalClan"]> | undefined;
    let grade: number | "commoner";
    let announce: string;

    const givenName = pick(ARISTOCRATIC_MALE_GIVEN_NAME_POOL, `${seed}:given`);
    const age = 14 + (gestationRollRaw(`${seed}:age`) % 9); // 14–22

    // 生母必须年龄合规（officialAge − candidateAge ∈ [MIN_GAP, MAX_GAP]）且有有效在任官职，否则只能为良家子。
    const eligibleMothers = activeOfficials.filter((o) => o.postId !== null && isValidParentChildAge(o.age, age));
    const isShijia = eligibleMothers.length > 0 && gestationRollRaw(`${seed}:shijia`) % 100 < 60;

    if (isShijia) {
      const mother = eligibleMothers[gestationRollRaw(`${seed}:mother`) % eligibleMothers.length]!;
      motherOfficialId = mother.id;
      surname = mother.surname;
      const motherPost = db.officialPosts[mother.postId!]!; // eligibleMothers 已过滤有效在任官职
      grade = motherPost.gradeOrder;
      announce = `${motherPost.name}之男 ${surname}${givenName}，年${chineseNumeral(age)}。`;
      // 完整母族来源持久化进 content.maternalClan（确定性嫡庶/排行），入宫后 familyText 不退化为平民。
      maternalClan = {
        familyId: mother.familyId,
        postId: mother.postId!,
        legitimate: gestationRollRaw(`${seed}:legit`) % 100 < 70,
        birthOrder: 1 + (gestationRollRaw(`${seed}:order`) % 4),
      };
    } else {
      surname = pick(ARISTOCRATIC_SURNAME_POOL, `${seed}:surname`);
      grade = "commoner";
      announce = `良家子 ${surname}${givenName}，年${chineseNumeral(age)}。`;
    }

    const traitCount = 2 + (gestationRollRaw(`${seed}:tc`) % 2); // 2–3
    const picked: (typeof TRAIT_POOL)[number][] = [];
    const accumulatedTraits = new Set<CanonicalReactionTrait>();
    for (let t = 0; t < traitCount; t++) {
      // Try original slot first; on conflict or duplicate, try fallback seeds until a
      // compatible entry is found. Uses up to TRAIT_POOL.length attempts so it always
      // terminates, even in edge cases where most of the pool is excluded.
      for (let attempt = 0; attempt < TRAIT_POOL.length; attempt++) {
        const candidateSeed = attempt === 0 ? `${seed}:trait:${t}` : `${seed}:trait:${t}:fb${attempt}`;
        const tr = pick(TRAIT_POOL, candidateSeed);
        if (picked.includes(tr)) continue;
        if (traitConflicts(tr.reactionTraits, accumulatedTraits)) continue;
        picked.push(tr);
        tr.reactionTraits.forEach(rt => accumulatedTraits.add(rt));
        break;
      }
    }
    const traits = picked.map((p) => p.display);
    const reactionTraits = [...accumulatedTraits];
    const specialty = pick(SPECIALTY_POOL, `${seed}:spec`);
    const likes = [pick(LIKES_POOL, `${seed}:like0`), pick(LIKES_POOL, `${seed}:like1`)]
      .filter((v, idx, arr) => arr.indexOf(v) === idx);

    const content: CharacterContent = {
      id: nextCandidateId(),
      kind: "consort",
      attributes: {
        appearance: 40 + (gestationRoll(`${seed}:app`) % 56), // 40–95
        health: 50 + (gestationRoll(`${seed}:hp`) % 46),       // 50–95
        nurture: 40 + (gestationRoll(`${seed}:nur`) % 56),     // 40–95
        specialty,
        likes,
      },
      hidden: {
        // gestationRollRaw avoids the % 100 modulo-bias present in gestationRoll
        affection: 30 + (gestationRollRaw(`${seed}:aff`)  % 31), // 30–60
        fear:      20 + (gestationRollRaw(`${seed}:fear`) % 41), // 20–60
        ambition:  20 + (gestationRollRaw(`${seed}:amb`)  % 61), // 20–80
        // personality biased by reactionTraits for narrative consistency
        personality: generatePersonality(seed, reactionTraits),
      },
      profile: {
        name: `${surname}${givenName}`,
        surname,
        age,
        role: isShijia ? "殿选新晋，世家出身" : "殿选新晋，良家子",
        appearance: "眉目清秀，举止拘谨，初入宫闱，难掩怯意。",
        personalityTraits: traits,
        reactionTraits,
        coreFacts: [isShijia ? "经三年大选入宫，初居储秀宫" : "良家子，经大选入宫，初居储秀宫"],
        goals: ["在宫中站稳脚跟", "得陛下垂顾"],
        speechStyle: "语气谨慎，言辞守礼。",
      },
      defaultLocation: "chuxiu_gong",
      portraitSet: pick(PORTRAIT_SETS, `${seed}:portrait`),
      expressions: ["neutral"],
      voice: { register: "formal", quirks: [], tabooTopics: [] },
      initialMemories: [],
      secrets: [],
      ...(maternalClan ? { maternalClan } : {}),
    };

    const parsed = characterSchema.safeParse(content);
    if (!parsed.success) {
      throw new Error(`generateCandidates produced an invalid candidate ${content.id}: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
    }
    out.push({ content: parsed.data, motherOfficialId, grade, announce });
  }
  return out;
}

// ── 抬头/才艺 模板化描述（确定性） ───────────────────────────────────
export function describeRaiseHead(content: CharacterContent): string {
  const app = content.attributes?.appearance ?? 50;
  const trait = content.profile.personalityTraits[0] ?? "腼腆";
  const looks = app >= 75 ? "眉目如画、容色出众" : app >= 50 ? "面目清秀" : "样貌寻常却也周正";
  return `秀男${trait}地微微抬头，是个${looks}的小男儿。`;
}

export function describeTalent(content: CharacterContent): string {
  const specialty = content.attributes?.specialty ?? "女红";
  return `秀男恭敬回道：小男儿自幼习${specialty}，略通一二，让陛下见笑了。`;
}

/**
 * 「到点即补触发」判定（与生产 gestationDue 同构）：当前日历是否已到/已过 `year` 年
 * `month`·`period` 的辰时。错过单槽不再丢失——该到期日之后持续为真，直到对应 flag 置位。
 * year 显式传入（而非取 cal.year），使「按 pending 自身年份消费」成为可能（跨年存档稳定）。
 */
function dueAtOrAfter(cal: GameState["calendar"], year: number, month: number, period: "early" | "mid" | "late"): boolean {
  const dueDayIndex = dayIndexOf(year, month, period);
  if (cal.dayIndex < dueDayIndex) return false;
  if (cal.dayIndex === dueDayIndex && shichenSlot(cal) < MORNING_SLOT) return false;
  return true;
}

/** 二月报告到点未报：大选年、未报 flag、且已到/过二月上旬辰时（按当前日历年）。 */
export function daxuanAnnounceDue(state: GameState): boolean {
  const cal = state.calendar;
  return isDaxuanYear(cal.year) && !state.flags[daxuanAnnounceFlagKey(cal.year)] && dueAtOrAfter(cal, cal.year, 2, "early");
}

/** 四月殿选到点未决：大选年、未决 flag、且已到/过四月下旬辰时（按当前日历年）。 */
export function daxuanDianxuanDue(state: GameState): boolean {
  const cal = state.calendar;
  return isDaxuanYear(cal.year) && !state.flags[daxuanDianxuanFlagKey(cal.year)] && dueAtOrAfter(cal, cal.year, 4, "late");
}

/**
 * 指定年份的殿选是否已到点未决（按 pending.year，年份权威；当前日历已过该年四月下旬辰时
 * 且该年 dianxuan flag 未置）。用于 announce 消费后链接同年 dianxuan、及跨年存档消费。
 */
export function daxuanDianxuanDueForYear(state: GameState, year: number): boolean {
  return !state.flags[daxuanDianxuanFlagKey(year)] && dueAtOrAfter(state.calendar, year, 4, "late");
}

/**
 * 该 pending 对应的 flag 是否已置（已报 / 已决）→ 陈旧，应调和清除而非永久 sticky。
 * 用于时间事务边界与 UI 消费两处去重，避免陈旧 pending 阻塞下一大选年的探测。
 */
export function isPendingDaxuanResolved(state: GameState, pending: PendingDaxuan): boolean {
  const key = pending.kind === "announce" ? daxuanAnnounceFlagKey(pending.year) : daxuanDianxuanFlagKey(pending.year);
  return Boolean(state.flags[key]);
}

/**
 * 殿选解决的完整性不变量：当前确有「该 year、未决」的 dianxuan 待消费事件。
 * 殿选 enter/delegate 据此拒绝陈旧/重复/错年点击——store 才是真正的去重边界（React 移除
 * prompt 不足为凭：按钮无同步一次性锁，双击/滞留动作可能重复触发）。
 */
export function matchesPendingDianxuan(state: GameState, year: number): boolean {
  const pd = state.pendingDaxuan;
  return pd?.kind === "dianxuan" && pd.year === year && !state.flags[daxuanDianxuanFlagKey(year)];
}

/**
 * 当前应入队的大选日历事件（announce 优先于 dianxuan；皆未到点则 null）。
 * 由时间事务统一入口（advanceCandidate）调用，使触发与具体行动路径解耦。
 */
export function nextPendingDaxuan(state: GameState): PendingDaxuan | null {
  if (daxuanAnnounceDue(state)) return { kind: "announce", year: state.calendar.year };
  if (daxuanDianxuanDue(state)) return { kind: "dianxuan", year: state.calendar.year };
  return null;
}

/** 二月大选报告的播报节拍（纯：与到期无关，消费时按 pending.year 执行）。 */
export function daxuanAnnounceBeats(): DecreeReaction[] {
  return [
    {
      speakerId: "cheng_feng",
      lines: [
        "陛下，皇后娘娘遣人来禀——三年一度的大选已备得差不多了，秀男们都已入住储秀宫，正学着宫里的规矩呢。",
      ],
    },
  ];
}

/** 指定年份的殿选 prompt（两选项均携带该 year；纯：不做到期判定）。 */
export function daxuanDianxuanPromptFor(year: number): ChengFengPrompt {
  return {
    speakerId: "cheng_feng",
    line: "陛下，礼部来报，殿选已准备完毕，请陛下移驾体元殿选看秀男，皇后娘娘与太后娘娘都已到了。",
    choices: [
      { label: "前往体元殿", action: { type: "daxuanEnter", year } },
      { label: "让太后皇后决定", action: { type: "daxuanDelegate", year } },
    ],
  };
}

/**
 * 大选年、未报过、且已到/已过「二月上旬辰时」→ 皇后遣人禀告大选已备妥（设 flag + 节拍）。
 * 仅供纯到期判定测试 / 旧调用方使用；实机消费走 store.consumeDaxuanAnnounce（按 pending.year）。
 */
export function buildDaxuanAnnounce(
  _db: ContentDB,
  state: GameState,
): { effects: EventEffect[]; beats: DecreeReaction[] } | null {
  if (!daxuanAnnounceDue(state)) return null;
  return {
    effects: [{ type: "flag", key: daxuanAnnounceFlagKey(state.calendar.year), value: true }],
    beats: daxuanAnnounceBeats(),
  };
}

/**
 * 大选年、未决、且已到/已过「四月下旬辰时」→ 殿选 prompt（前往 / 委托）。否则 null。
 * 仅供纯到期判定测试 / 旧调用方使用；实机消费走 pending-aware daxuanDianxuanPromptFor。
 */
export function buildDaxuanDianxuanPrompt(_db: ContentDB, state: GameState): ChengFengPrompt | null {
  if (!daxuanDianxuanDue(state)) return null;
  return daxuanDianxuanPromptFor(state.calendar.year);
}

// ── NPC 自留（委托 + 早退场） ──────────────────────────────────────

/** NPC（太后/皇后）留下的秀男及自动定的位分。 */
export interface KeptConsort {
  candidate: Candidate;
  rank: string;
}

/** 委托路径：20% 几率留 1–2 位随机秀男，按家世推荐位分；否则空。 */
export function npcKeepOnDelegate(db: ContentDB, _state: GameState, year: number): KeptConsort[] {
  const cands = generateCandidates(db, _state, year);
  if (cands.length === 0) return [];
  if (gestationRoll(`daxuan:npc:delegate:${year}`) >= 20) return [];
  const n = 1 + (gestationRollRaw(`daxuan:npc:delegate:n:${year}`) % 2); // 1–2
  const picked: KeptConsort[] = [];
  for (let i = 0; i < n && i < cands.length; i++) {
    const idx = gestationRollRaw(`daxuan:npc:delegate:pick:${year}:${i}`) % cands.length;
    const cand = cands[idx]!;
    if (picked.some((k) => k.candidate.content.id === cand.content.id)) continue;
    picked.push({ candidate: cand, rank: recommendRank(cand.grade) });
  }
  return picked;
}

/** 早退场：20% 几率从剩余未审阅者中留 1 位随机，按家世推荐位分；否则 null。 */
export function npcKeepOnLeave(remaining: Candidate[], _state: GameState, year: number): KeptConsort | null {
  if (remaining.length === 0) return null;
  if (gestationRoll(`daxuan:npc:leave:${year}`) >= 20) return null;
  const idx = gestationRollRaw(`daxuan:npc:leave:pick:${year}`) % remaining.length;
  const cand = remaining[idx]!;
  return { candidate: cand, rank: recommendRank(cand.grade) };
}

/**
 * 把一位殿选中选秀男落库：generatedConsorts + standing + memories + bedchamber（不可变）。
 * favor 由调用方按位分算好传入。motherOfficialId 给出时（世家子弟），原子写入母族关联：
 * standing.birthFamilyId + child→mother(mother) + mother→child(son) + 与同母已有子女的
 * sibling 双向边。所有边去重。
 *
 * 返回 Result：身份冲突（重复 id 但家族/内容/位分不一致）拒绝，绝不覆盖旧 standing 而残留旧亲缘；
 * 完全相同的重复提交幂等返回原 state；母族校验失败（mother 不存在 / maternalClan 不匹配 /
 * 母子年龄非法）亦拒绝。
 */
export function addGeneratedConsort(
  state: GameState,
  db: ContentDB,
  content: CharacterContent,
  rank: string,
  favor: number,
  motherOfficialId?: string,
): Result<GameState, GameError> {
  const id = content.id;
  const now = toGameTime(state.calendar);

  const mother = motherOfficialId ? state.officials[motherOfficialId] : undefined;
  const birthFamilyId = mother?.familyId;

  // ── 重复 / 冲突提交（generatedConsorts 命名空间）──
  const existing = state.generatedConsorts[id];
  if (existing) {
    const existingFamily = state.standing[id]?.birthFamilyId;
    if (existingFamily !== birthFamilyId) {
      return err(stateError("CONSORT_FAMILY_CONFLICT",
        `侍君「${id}」二次落库母族冲突（${existingFamily ?? "无"} vs ${birthFamilyId ?? "无"}）`,
        { context: { id, existingFamily, proposed: birthFamilyId } }));
    }
    if (state.standing[id]?.rank !== rank || JSON.stringify(existing) !== JSON.stringify(content)) {
      return err(stateError("CONSORT_OVERWRITE_CONFLICT",
        `侍君「${id}」二次落库与既有身份不一致（位分/内容）`, { context: { id } }));
    }
    return ok(state); // 完全相同的重复提交：幂等。
  }

  // ── 全局人物 id 冲突（其它命名空间一律拒绝，绝不静默覆盖）──
  if (db.characters[id] || state.officials[id] || state.familyMembers[id]) {
    return err(stateError("PERSON_ID_CONFLICT", `侍君 id「${id}」与既有人物冲突`, { context: { id } }));
  }

  // ── maternalClan 与 motherOfficialId 必须成对（世家：皆有；良家子：皆无）──
  const hasClan = content.maternalClan !== undefined;
  const hasMother = motherOfficialId !== undefined;
  if (hasClan !== hasMother) {
    return err(stateError("CONSORT_CLAN_PAIRING",
      `侍君「${id}」maternalClan 与 motherOfficialId 必须成对出现`, { context: { id, hasClan, hasMother } }));
  }

  // ── 母族校验 ──
  if (motherOfficialId) {
    if (!mother) {
      return err(stateError("OFFICIAL_NOT_FOUND", `母官员「${motherOfficialId}」不存在`, { context: { id, motherOfficialId } }));
    }
    if (mother.status !== "active") {
      return err(stateError("OFFICIAL_NOT_ACTIVE", `母官员「${mother.id}」非在任（${mother.status}）`, { context: { id, motherOfficialId } }));
    }
    if (mother.postId === null) {
      return err(stateError("OFFICIAL_NO_POST", `母官员「${mother.id}」无官职`, { context: { id, motherOfficialId } }));
    }
    if (!db.officialPosts[mother.postId]) {
      return err(stateError("OFFICIAL_BAD_POST", `母官员「${mother.id}」官职「${mother.postId}」不存在`, { context: { id, motherOfficialId } }));
    }
    const mc = content.maternalClan!;
    if (mc.familyId !== mother.familyId || mc.postId !== mother.postId) {
      return err(stateError("CONSORT_CLAN_MISMATCH",
        `侍君「${id}」maternalClan 与母官员不符（familyId/postId）`,
        { context: { id, motherFamily: mother.familyId, motherPost: mother.postId, clan: mc } }));
    }
    if (!isValidParentChildAge(mother.age, content.profile.age)) {
      return err(stateError("CONSORT_BAD_AGE",
        `侍君「${id}」(${content.profile.age}) 与母官员「${mother.id}」(${mother.age}) 年龄关系不合理`,
        { context: { id } }));
    }
  }

  // 亲缘边（仅在确有有效母官员时）：去重累加。
  const kinship = [...state.kinship];
  if (mother) {
    const seen = new Set(kinship.map((k) => `${k.fromPersonId}|${k.toPersonId}|${k.type}`));
    const add = (from: string, to: string, type: KinshipRelation["type"]) => {
      const key = `${from}|${to}|${type}`;
      if (!seen.has(key)) {
        seen.add(key);
        kinship.push({ fromPersonId: from, toPersonId: to, type });
      }
    };
    add(id, mother.id, "mother");
    add(mother.id, id, "son");
    // 与同母已有子女互为同胞（含开局已生成的子女与先前入宫的侍君）。
    const siblings = state.kinship
      .filter((k) => k.toPersonId === mother.id && k.type === "mother" && k.fromPersonId !== id)
      .map((k) => k.fromPersonId);
    for (const sib of siblings) {
      add(id, sib, "sibling");
      add(sib, id, "sibling");
    }
  }

  const next: GameState = {
    ...state,
    kinship,
    generatedConsorts: { ...state.generatedConsorts, [id]: content },
    standing: {
      ...state.standing,
      [id]: {
        rank,
        favor,
        affection: content.hidden?.affection ?? 50,
        fear:      content.hidden?.fear      ?? 30,
        ambition:  content.hidden?.ambition  ?? 35,
        loyalty:   content.hidden?.loyalty   ?? 50,
        personality: materializePersonality(content.hidden?.personality),
        household: createDefaultHousehold(),
        residence: "chuxiu_gong",
        chamber: "main",
        availableFromMonth: monthOrdinal({ year: state.calendar.year, month: 5 }),
        palaceEnteredAt: now, // 入宫时刻（知情资格用）：殿选承恩即此刻入宫
        health: content.attributes?.health ?? 100,
        healthStatus: "healthy",
        ageAtEntry: content.profile.age,
        enteredAtYear: state.calendar.year,
        ...(birthFamilyId !== undefined ? { birthFamilyId } : {}),
      },
    },
    memories: {
      ...state.memories,
      [id]: {
        entries: [{
          id: memoryEntryId(id, 1),
          ownerId: id,
          kind: "episodic",
          subjectIds: ["player", id],
          perspective: "witness",
          summary: "殿选承恩，蒙陛下留牌子，迁入储秀宫。",
          strength: 60,
          retention: "slow",
          emotions: { joy: 40 },
          triggerTags: ["daxuan", "player"],
          unresolved: false,
          createdAt: now,
        }],
        nextSeq: 2,
      },
    },
    bedchamber: { ...state.bedchamber, [id]: { encounters: [] } },
  };

  // 成功返回的 state 必须立即通过完整性校验，不依赖之后存档才发现损坏。
  const integrity = validateOfficialWorld(next, db);
  if (integrity.length > 0) {
    const first = integrity[0]!;
    return err(stateError("CONSORT_INTEGRITY", `落库后官员完整性失败（${first.code}）：${first.message}`, { context: { id, code: first.code } }));
  }

  return ok(next);
}
