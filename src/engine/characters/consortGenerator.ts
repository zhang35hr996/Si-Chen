/**
 * 开局随机侍君生成器。
 *
 * 仅在 createNewGameState 时调用一次，结果直接持久化到 GameState；
 * 读档不重新抽取。所有随机值由游戏 rngSeed 确定性派生，同 seed 必得同结果。
 */
import { fnv1a64Hex } from "../save/canonical";
import { OFFICIAL_SURNAME_POOL } from "../officials/namePool";
import { materializePersonality, createDefaultHousehold } from "./consortAttrs";
import type { CharacterContent } from "../content/schemas";
import type { CharacterStanding, ConsortPersonality } from "../state/types";
import type { GameTime } from "../calendar/time";

// ── Seeded RNG helpers ────────────────────────────────────────────────────────

function seededRoll(seed: string, max: number): number {
  return parseInt(fnv1a64Hex(seed).slice(0, 8), 16) % max;
}

function seededRange(seed: string, min: number, max: number): number {
  return min + seededRoll(seed, max - min + 1);
}

// ── Consort name pool ─────────────────────────────────────────────────────────

// 侍君专用双字名池：婉约雅致，符合男性内宫身份。
export const CONSORT_GIVEN_NAME_POOL: readonly string[] = [
  "砚秋", "墨白", "清晏", "云舒", "玉书", "琅玉", "凌霜",
  "冷月", "寒松", "梅溪", "竹隐", "若虚", "素华", "星阑",
  "晴川", "绮罗", "烟雨", "翠微", "碧落", "流苏", "锦言",
  "玉泽", "华章", "晨曦", "暮雪", "青岚", "鸿羽", "芸窗",
  "桐荫", "雪岫", "兰亭", "霁月", "明镜", "春霖", "秋水",
  "远山", "浮云", "惜墨", "知音", "悠然", "怡颜", "文渊",
  "慕云", "朝华", "思远", "镜湖", "含章", "行云", "素心",
  "霜华", "玉璋", "龙城", "含玉", "澄怀", "栖迟", "映雪",
];

// ── Archetype definitions ─────────────────────────────────────────────────────

type Range = [number, number];

interface ArchetypeDef {
  readonly id: string;
  readonly role: string;
  readonly speechStyle: string;
  readonly personalityTraits: readonly string[];
  readonly specialties: readonly string[];
  readonly appearanceRange: Range;
  readonly nurtureRange: Range;
  readonly personality: {
    readonly intelligence: Range;
    readonly scheming: Range;
    readonly sociability: Range;
    readonly compassion: Range;
    readonly courage: Range;
    readonly jealousy: Range;
    readonly emotionalStability: Range;
    readonly pride: Range;
  };
}

const ARCHETYPES: readonly ArchetypeDef[] = [
  {
    id: "cool",
    role: "出身书香，气质清冷，才学过人，不善周旋。",
    speechStyle: "言简意赅，淡漠疏离，偶露锋芒。",
    personalityTraits: ["清冷自持", "才思敏捷", "不事逢迎", "心有成算"],
    specialties: ["古琴", "棋艺", "书法", "诗文"],
    appearanceRange: [55, 90],
    nurtureRange: [40, 80],
    personality: {
      intelligence:        [65, 90],
      scheming:            [25, 60],
      sociability:         [15, 45],
      compassion:          [30, 60],
      courage:             [35, 65],
      jealousy:            [10, 45],
      emotionalStability:  [60, 85],
      pride:               [55, 80],
    },
  },
  {
    id: "gentle",
    role: "性情温柔，与人为善，无心争斗，只愿安稳。",
    speechStyle: "声音柔和，言语谨慎，温婉体贴。",
    personalityTraits: ["温顺体贴", "心地良善", "不争不抢", "随遇而安"],
    specialties: ["女红", "烹茶", "弄弦", "绘画"],
    appearanceRange: [45, 80],
    nurtureRange: [50, 90],
    personality: {
      intelligence:        [35, 70],
      scheming:            [5,  40],
      sociability:         [40, 75],
      compassion:          [55, 85],
      courage:             [20, 50],
      jealousy:            [10, 45],
      emotionalStability:  [50, 80],
      pride:               [30, 60],
    },
  },
  {
    id: "proud",
    role: "出身显贵，从小锦衣玉食，个性骄纵，不知收敛。",
    speechStyle: "语气傲慢，偶有刁难，却也直率坦荡。",
    personalityTraits: ["骄纵任性", "争强好胜", "容貌出众", "行事直接"],
    specialties: ["舞蹈", "歌唱", "骑射", "击鞠"],
    appearanceRange: [60, 95],
    nurtureRange: [25, 60],
    personality: {
      intelligence:        [35, 75],
      scheming:            [35, 70],
      sociability:         [45, 80],
      compassion:          [10, 40],
      courage:             [55, 85],
      jealousy:            [60, 95],
      emotionalStability:  [20, 55],
      pride:               [70, 95],
    },
  },
  {
    id: "cautious",
    role: "出身寒微，入宫后步步为营，行事极为谨慎。",
    speechStyle: "字斟句酌，不轻易表态，言多必有深意。",
    personalityTraits: ["心思缜密", "谨言慎行", "善于观察", "城府颇深"],
    specialties: ["弈棋", "机关术", "诗词", "刺绣"],
    appearanceRange: [40, 75],
    nurtureRange: [40, 75],
    personality: {
      intelligence:        [50, 80],
      scheming:            [45, 75],
      sociability:         [30, 60],
      compassion:          [35, 65],
      courage:             [25, 55],
      jealousy:            [30, 65],
      emotionalStability:  [55, 80],
      pride:               [40, 70],
    },
  },
  {
    id: "ambitious",
    role: "胸怀大志，入宫绝非安于平淡，时刻谋划晋升之道。",
    speechStyle: "滴水不漏，言语中藏着机锋。",
    personalityTraits: ["野心勃勃", "心机深沉", "目光长远", "不甘居下"],
    specialties: ["辞令", "笛箫", "算学", "文史"],
    appearanceRange: [50, 85],
    nurtureRange: [35, 70],
    personality: {
      intelligence:        [55, 85],
      scheming:            [55, 85],
      sociability:         [40, 70],
      compassion:          [10, 45],
      courage:             [50, 80],
      jealousy:            [50, 80],
      emotionalStability:  [45, 75],
      pride:               [55, 85],
    },
  },
  {
    id: "lively",
    role: "性情活泼，招人喜爱，凭天真烂漫在宫中如鱼得水。",
    speechStyle: "言语活泼，笑声爽朗，不拘礼数。",
    personalityTraits: ["开朗活泼", "人缘极好", "笑口常开", "心无城府"],
    specialties: ["蹴鞠", "歌唱", "调香", "踏歌"],
    appearanceRange: [50, 85],
    nurtureRange: [40, 80],
    personality: {
      intelligence:        [35, 65],
      scheming:            [10, 40],
      sociability:         [65, 95],
      compassion:          [50, 80],
      courage:             [50, 80],
      jealousy:            [15, 50],
      emotionalStability:  [40, 70],
      pride:               [30, 60],
    },
  },
] as const;

// ── Rank pool with weights ────────────────────────────────────────────────────

interface RankEntry {
  readonly rank: string;
  readonly weight: number;
  /** True for 贵驸 (max 1 per opening). */
  readonly tier1?: boolean;
  /** True for 贤/良/德/驸 group (max 2 combined). */
  readonly tier2?: boolean;
}

const RANK_POOL: readonly RankEntry[] = [
  { rank: "guifu",    weight: 1,  tier1: true },   // 贵驸 — max 1
  { rank: "xianfu",  weight: 2,  tier2: true },    // 贤驸 \
  { rank: "liangfu", weight: 3,  tier2: true },    // 良驸  |— max 2 combined
  { rank: "defu",    weight: 3,  tier2: true },    // 德驸  |
  { rank: "fu",      weight: 4,  tier2: true },    // 驸   /
  { rank: "zhaoyi",  weight: 9  },                 // 昭仪
  { rank: "zhaohui", weight: 9  },                 // 昭徽
  { rank: "zhaode",  weight: 9  },                 // 昭德
  { rank: "chengyi", weight: 10 },                 // 承仪
  { rank: "chenghui",weight: 10 },                 // 承徽
  { rank: "chengde", weight: 10 },                 // 承德
  { rank: "jieyu",   weight: 10 },                 // 倢伃
  { rank: "shichen", weight: 9  },                 // 侍宸
  { rank: "changyu", weight: 8  },                 // 长御
  { rank: "shaoshi", weight: 7  },                 // 少使
  { rank: "guiren",  weight: 10 },                 // 贵人
  { rank: "liangren",weight: 8  },                 // 良人
  { rank: "meiren",  weight: 10 },                 // 美人
  { rank: "cairen",  weight: 8  },                 // 才人
  { rank: "changzai",weight: 6  },                 // 常在
  { rank: "daying",  weight: 4  },                 // 答应
  { rank: "gengyi",  weight: 2  },                 // 更衣
  { rank: "xuanshi", weight: 1  },                 // 选侍
] as const;

function pickRank(seed: string, tier1Used: number, tier2Used: number): string {
  const eligible = RANK_POOL.filter(
    (r) => !(r.tier1 && tier1Used >= 1) && !(r.tier2 && tier2Used >= 2),
  );
  const total = eligible.reduce((s, r) => s + r.weight, 0);
  let roll = seededRoll(seed, total);
  for (const e of eligible) {
    if (roll < e.weight) return e.rank;
    roll -= e.weight;
  }
  return eligible[eligible.length - 1]!.rank;
}

// ── Harem palace pool (excluding empress & cold palace) ───────────────────────

const CONSORT_PALACES: readonly string[] = [
  "zhongcui_gong",
  "yikun_gong",
  "chenghui_gong",
  "jiyue_gong",
  "jingren_gong",
  "yanhe_gong",
  "chengqian_gong",
  "wenzhaodian",
  "zhaoning_gong",
  "chuxiu_gong",
  "xianfugong",
  "yongshou_gong",
];

// ── Portrait pool ─────────────────────────────────────────────────────────────
// 侍君立绘统一编号（consort1–consort33，跳过 consort31 因文件名含特殊字符）。
// 每位生成侍君从池中确定性随机取一张；同号可被多人复用。

const PORTRAIT_POOL: readonly string[] = [
  "consort1",  "consort2",  "consort3",  "consort4",  "consort5",
  "consort6",  "consort7",  "consort8",  "consort9",  "consort10",
  "consort11", "consort12", "consort13", "consort14", "consort15",
  "consort16", "consort17", "consort18", "consort19", "consort20",
  "consort21", "consort22", "consort23", "consort24", "consort25",
  "consort26", "consort27", "consort28", "consort29", "consort30",
  "consort32", "consort33",
];

// ── Likes pool ────────────────────────────────────────────────────────────────

const LIKES_POOL: readonly string[] = [
  "古籍", "香料", "丝绸", "玉器", "书画", "乐器",
  "珍馐", "茗茶", "奇花", "珍鸟", "首饰", "舆图",
];

// ── Main export ───────────────────────────────────────────────────────────────

export interface GeneratedConsortEntry {
  content: CharacterContent;
  standing: CharacterStanding;
}

/**
 * 基于 rngSeed 确定性生成 1–5 位开局侍君。
 * 结果直接写入 GameState（generatedConsorts + standing + memories + bedchamber）。
 * 读档时不调用此函数。
 */
export function generateInitialConsorts(
  rngSeed: number,
  startTime: GameTime,
  validRankIds: ReadonlySet<string>,
): GeneratedConsortEntry[] {
  const prefix = `init_consort:${rngSeed}`;

  const count = 1 + seededRoll(`${prefix}:count`, 5);

  // Deterministic shuffle of palace pool
  const palaces = [...CONSORT_PALACES];
  for (let i = palaces.length - 1; i > 0; i--) {
    const j = seededRoll(`${prefix}:palaces:${i}`, i + 1);
    [palaces[i], palaces[j]] = [palaces[j]!, palaces[i]!];
  }

  const usedFullNames = new Set<string>();
  const usedSurnames = new Set<string>();
  let tier1Used = 0;
  let tier2Used = 0;

  const results: GeneratedConsortEntry[] = [];

  for (let i = 0; i < count; i++) {
    const p = `${prefix}:${i}`;

    // Archetype
    const archetype = ARCHETYPES[seededRoll(`${p}:arch`, ARCHETYPES.length)]!;

    // Surname (unique)
    const n = OFFICIAL_SURNAME_POOL.length;
    const surnameStart = seededRoll(`${p}:surname`, n);
    let surname = OFFICIAL_SURNAME_POOL[surnameStart]!;
    for (let k = 0; k < n; k++) {
      const s = OFFICIAL_SURNAME_POOL[(surnameStart + k) % n]!;
      if (!usedSurnames.has(s)) { surname = s; break; }
    }
    usedSurnames.add(surname);

    // Given name (unique full name)
    const m = CONSORT_GIVEN_NAME_POOL.length;
    const givenStart = seededRoll(`${p}:given`, m);
    let givenName = CONSORT_GIVEN_NAME_POOL[givenStart]!;
    for (let k = 0; k < m; k++) {
      const g = CONSORT_GIVEN_NAME_POOL[(givenStart + k) % m]!;
      if (!usedFullNames.has(`${surname}${g}`)) { givenName = g; break; }
    }
    usedFullNames.add(`${surname}${givenName}`);

    // Rank
    const rawRank = pickRank(`${p}:rank`, tier1Used, tier2Used);
    const rank = validRankIds.has(rawRank) ? rawRank : "meiren";
    const entry = RANK_POOL.find((r) => r.rank === rank)!;
    if (entry?.tier1) tier1Used++;
    if (entry?.tier2) tier2Used++;

    // Attributes
    const [apLo, apHi] = archetype.appearanceRange;
    const [nuLo, nuHi] = archetype.nurtureRange;
    const appearance = seededRange(`${p}:appear`, apLo, apHi);
    const health     = seededRange(`${p}:health`, 45, 95);
    const nurture    = seededRange(`${p}:nurture`, nuLo, nuHi);
    const age        = seededRange(`${p}:age`, 16, 28);
    const specialty  = archetype.specialties[seededRoll(`${p}:spec`, archetype.specialties.length)]!;

    const likeCount = 1 + seededRoll(`${p}:lc`, 2);
    const likes: string[] = [];
    for (let li = 0; li < likeCount; li++) {
      const like = LIKES_POOL[seededRoll(`${p}:like${li}`, LIKES_POOL.length)]!;
      if (!likes.includes(like)) likes.push(like);
    }
    if (likes.length === 0) likes.push(LIKES_POOL[0]!);

    // Hidden attrs
    const affection = seededRange(`${p}:aff`, 25, 65);
    const fear      = seededRange(`${p}:fear`, 15, 55);
    const ambition  = seededRange(`${p}:amb`, 10, 90);
    const loyalty   = seededRange(`${p}:loy`, 30, 75);

    // Personality within archetype range
    const pr = archetype.personality;
    const personality: ConsortPersonality = {
      intelligence:       seededRange(`${p}:int`, pr.intelligence[0],       pr.intelligence[1]),
      scheming:           seededRange(`${p}:sch`, pr.scheming[0],           pr.scheming[1]),
      sociability:        seededRange(`${p}:soc`, pr.sociability[0],        pr.sociability[1]),
      compassion:         seededRange(`${p}:comp`, pr.compassion[0],        pr.compassion[1]),
      courage:            seededRange(`${p}:cou`, pr.courage[0],            pr.courage[1]),
      jealousy:           seededRange(`${p}:jea`, pr.jealousy[0],           pr.jealousy[1]),
      emotionalStability: seededRange(`${p}:emo`, pr.emotionalStability[0], pr.emotionalStability[1]),
      pride:              seededRange(`${p}:pri`, pr.pride[0],              pr.pride[1]),
    };

    // Favor & residence
    const favor    = seededRange(`${p}:favor`, 5, 35);
    const residence = palaces[i] ?? CONSORT_PALACES[i % CONSORT_PALACES.length]!;

    // Personality traits (2–3)
    const traitPool = archetype.personalityTraits;
    const traitCount = Math.min(2 + seededRoll(`${p}:tc`, 2), traitPool.length);
    const traitSet = new Set<number>();
    while (traitSet.size < traitCount) {
      traitSet.add(seededRoll(`${p}:tr${traitSet.size}`, traitPool.length));
    }
    const traits = [...traitSet].map((idx) => traitPool[idx]!);

    const charId = `generated_consort_${rngSeed}_${i}`;

    const content: CharacterContent = {
      id: charId,
      kind: "consort",
      attributes: { appearance, health, nurture, specialty, likes },
      hidden: { affection, fear, ambition, loyalty, personality },
      profile: {
        name: givenName,
        surname,
        age,
        role: archetype.role,
        appearance: `容貌${appearance >= 70 ? "出众" : appearance >= 50 ? "清秀" : "平常"}，气质独特。`,
        personalityTraits: traits,
        reactionTraits: [],
        coreFacts: [`${surname}${givenName}`, `入宫为侍君`],
        goals: ["在宫中站稳脚跟", "博得君心"],
        speechStyle: archetype.speechStyle,
      },
      defaultLocation: residence,
      portraitSet: PORTRAIT_POOL[seededRoll(`${p}:portrait`, PORTRAIT_POOL.length)]!,
      expressions: ["neutral"],
      voice: {
        register: seededRoll(`${p}:voice`, 2) === 0 ? "formal" : "casual",
        quirks: [],
        tabooTopics: [],
      },
      initialStanding: { rank, favor, peakFavor: favor, residence },
      initialMemories: [],
      secrets: [],
    };

    const standing: CharacterStanding = {
      rank,
      favor,
      peakFavor: favor,
      residence,
      affection,
      fear,
      ambition,
      loyalty,
      personality: materializePersonality(personality),
      household: createDefaultHousehold(),
      palaceEnteredAt: startTime,
      health,
      healthStatus: "healthy",
    };

    results.push({ content, standing });
  }

  return results;
}
