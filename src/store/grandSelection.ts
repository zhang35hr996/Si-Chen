/**
 * 大选（三年一次殿选）：日历门控触发、候选秀男生成、推荐位分、落库、NPC 自留。
 * 纯逻辑集中于此；殿选界面与 App 接线只调用本模块。确定性随机走 gestationRoll。
 */
import type { ContentDB } from "../engine/content/loader";
import type { CharacterRank, CharacterContent, EventEffect } from "../engine/content/schemas";
import { characterSchema } from "../engine/content/schemas";
import { gestationRoll, gestationRollRaw } from "../engine/characters/gestation";
import { chineseNumeral, dayIndexOf, MORNING_SLOT, shichenSlot, monthOrdinal, toGameTime } from "../engine/calendar/time";
import { memoryEntryId } from "../engine/state/newGame";
import {
  ARISTOCRATIC_SURNAME_POOL,
  ARISTOCRATIC_MALE_GIVEN_NAME_POOL,
} from "../engine/characters/shijunNames";
import type { GameState, PendingDaxuan } from "../engine/state/types";
import type { DecreeReaction } from "./empressDecree";
import type { ChengFengPrompt } from "./prompt";

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

/** 初始恩宠随位分缩放：更衣(50)→10，皇贵君(180)→20，线性，夹在 10–20。 */
export function initialFavorForRank(order: number): number {
  const raw = 10 + Math.round((10 * (order - 50)) / 130);
  return Math.max(10, Math.min(20, raw));
}

/** 玩家可选位分：order 50（更衣）–180（皇贵君），排除凤后；降序。 */
export function pickableRanks(db: ContentDB): CharacterRank[] {
  return Object.values(db.ranks)
    .filter((r) => r.domain === "harem" && r.id !== "fenghou" && r.order >= 50 && r.order <= 180)
    .sort((a, b) => b.order - a.order);
}

// ── 生成池（确定性取样） ──────────────────────────────────────────────
const SPECIALTY_POOL = ["古筝", "琵琶", "书法", "丹青", "刺绣", "烹茶", "棋艺", "舞乐", "诗赋", "骑射"];
const TRAIT_POOL = ["温婉", "活泼", "沉静", "孤傲", "机敏", "腼腆", "爽利", "细腻", "执拗", "娴雅"];
const LIKES_POOL = ["玉器", "香料", "古籍", "骏马", "茶饮", "花木", "字画", "珠玉", "琴谱", "棋具"];
const PORTRAIT_SETS = ["consort1", "consort2", "consort3", "consort4", "consort5", "consort6"];

function pick<T>(pool: readonly T[], seed: string): T {
  return pool[gestationRollRaw(seed) % pool.length]!;
}

/** 候选秀男（生成态，未落库）。 */
export interface Candidate {
  content: CharacterContent;
  fatherOfficialId?: string;
  /** 父官品 gradeOrder，或平民。驱动皇后推荐位分。 */
  grade: number | "commoner";
  /** 礼官宣读词。 */
  announce: string;
}

/** 用 gestationRoll 确定性生成 8–12 位候选秀男。 */
export function generateCandidates(db: ContentDB, state: GameState, year: number): Candidate[] {
  const base = `daxuan:gen:${year}`;
  const count = 8 + (gestationRollRaw(`${base}:n`) % 5); // 8–12
  const officialIds = Object.keys(state.officials);
  const out: Candidate[] = [];

  for (let i = 0; i < count; i++) {
    const seed = `${base}:${i}`;
    const isShijia = officialIds.length > 0 && gestationRollRaw(`${seed}:shijia`) % 100 < 60;

    let surname: string;
    let fatherOfficialId: string | undefined;
    let grade: number | "commoner";
    let announce: string;

    const givenName = pick(ARISTOCRATIC_MALE_GIVEN_NAME_POOL, `${seed}:given`);
    const age = 14 + (gestationRollRaw(`${seed}:age`) % 9); // 14–22

    if (isShijia) {
      fatherOfficialId = officialIds[gestationRollRaw(`${seed}:father`) % officialIds.length]!;
      const father = state.officials[fatherOfficialId]!;
      surname = father.surname;
      grade = db.officialPosts[father.postId]?.gradeOrder ?? "commoner";
      const postName = db.officialPosts[father.postId]?.name ?? "官员";
      announce = `${postName}之男 ${surname}${givenName}，年${chineseNumeral(age)}。`;
    } else {
      surname = pick(ARISTOCRATIC_SURNAME_POOL, `${seed}:surname`);
      grade = "commoner";
      announce = `良家子 ${surname}${givenName}，年${chineseNumeral(age)}。`;
    }

    const traitCount = 2 + (gestationRollRaw(`${seed}:tc`) % 2); // 2–3
    const traits: string[] = [];
    for (let t = 0; t < traitCount; t++) {
      const tr = pick(TRAIT_POOL, `${seed}:trait:${t}`);
      if (!traits.includes(tr)) traits.push(tr);
    }
    const specialty = pick(SPECIALTY_POOL, `${seed}:spec`);
    const likes = [pick(LIKES_POOL, `${seed}:like0`), pick(LIKES_POOL, `${seed}:like1`)]
      .filter((v, idx, arr) => arr.indexOf(v) === idx);

    const content: CharacterContent = {
      id: `xiunan_${year}_${i}`,
      kind: "consort",
      attributes: {
        appearance: 40 + (gestationRoll(`${seed}:app`) % 56), // 40–95
        health: 50 + (gestationRoll(`${seed}:hp`) % 46),       // 50–95
        nurture: 40 + (gestationRoll(`${seed}:nur`) % 56),     // 40–95
        specialty,
        likes,
      },
      hidden: {
        affection: 30 + (gestationRoll(`${seed}:aff`) % 31),   // 30–60
        fear: 20 + (gestationRoll(`${seed}:fear`) % 41),       // 20–60
        ambition: 20 + (gestationRoll(`${seed}:amb`) % 61),    // 20–80
      },
      profile: {
        name: `${surname}${givenName}`,
        surname,
        age,
        role: isShijia ? "殿选新晋，世家出身" : "殿选新晋，良家子",
        appearance: "眉目清秀，举止拘谨，初入宫闱，难掩怯意。",
        personalityTraits: traits,
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
    };

    const parsed = characterSchema.safeParse(content);
    if (!parsed.success) {
      throw new Error(`generateCandidates produced an invalid candidate ${content.id}: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
    }
    out.push({ content: parsed.data, fatherOfficialId, grade, announce });
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
        "陛下，凤后娘娘遣人来禀——三年一度的大选已备得差不多了，秀男们都已入住储秀宫，正学着宫里的规矩呢。",
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
 * 大选年、未报过、且已到/已过「二月上旬辰时」→ 凤后遣人禀告大选已备妥（设 flag + 节拍）。
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

/** 把一位殿选中选秀男落库：generatedConsorts + standing + memories + bedchamber（不可变）。
 *  favor 由调用方按位分算好传入（见 GameStore.commitDaxuanConsort）。 */
export function addGeneratedConsort(
  state: GameState,
  content: CharacterContent,
  rank: string,
  favor: number,
): GameState {
  const id = content.id;
  const now = toGameTime(state.calendar);
  return {
    ...state,
    generatedConsorts: { ...state.generatedConsorts, [id]: content },
    standing: {
      ...state.standing,
      [id]: {
        rank,
        favor,
        residence: "chuxiu_gong",
        chamber: "main",
        availableFromMonth: monthOrdinal({ year: state.calendar.year, month: 5 }),
        palaceEnteredAt: now, // 入宫时刻（知情资格用）：殿选承恩即此刻入宫
        health: content.attributes?.health ?? 100,
        healthStatus: "healthy",
        ageAtEntry: content.profile.age,
        enteredAtYear: state.calendar.year,
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
}
