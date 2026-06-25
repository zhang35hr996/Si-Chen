/**
 * 生产裁决（纯函数，确定性）：性别、难产结局、子嗣宠爱初值、双胎、生辰天象。
 * 帝王自孕（carrier="sovereign"）永不难产。宠爱按生产当月承载侍君的受宠程度派生。
 * 双胎各自独立判定生辰天象（吉兆/凶兆）；宠爱已包含天象加成。
 */
import { monthOrdinal, type GameTime } from "../calendar/time";
import { computeFavorStats, type BedchamberThresholds, type FavorTier } from "./favorTier";
import {
  dystociaChance,
  gestationRoll,
  type BirthOmenConfig,
  type GestationConfig,
  type TwinsConfig,
  DEFAULT_BIRTH_OMEN,
  DEFAULT_TWINS,
} from "./gestation";
import type { BedchamberRecord, HeirSex } from "../state/types";

export type BearerOutcome = "safe" | "child_dies" | "bearer_dies" | "both";
export type BirthOmen = "auspicious" | "inauspicious";

const AUSPICIOUS_OMENS = [
  "祥云缭绕，紫气东来",
  "久旱逢甘霖，万物得润",
  "阴雨连绵，骤然天晴，霞光万道",
  "百花不应时节，竟于此刻齐放，宫苑芬芳四溢",
];

const INAUSPICIOUS_OMENS = [
  "天忽电闪雷鸣，大雨倾盆",
  "大地微微震动，宫殿轻颤",
  "京郊洪水泛滥，汹涌漫道",
  "忽降冰雹，砸得宫中花木俱损",
  "宫苑百花无故凋零，衰败于一夕之间",
];

export interface BirthInput {
  rngSeed: number;
  now: GameTime;
  carrier: "sovereign" | string;
  fatherId: string | null;
  transferredAtMonth: number | undefined;
  bearerIsFenghou: boolean;
  /** 承载侍君的侍寝日志（自孕传 undefined）。 */
  carrierRecord: BedchamberRecord | undefined;
  thresholds: BedchamberThresholds;
  cfg: GestationConfig;
}

export interface BirthVerdict {
  sex: HeirSex;
  /** Present when twins are born; sex of the second child. */
  twinSex?: HeirSex;
  fatherId: string | null;
  bearer: "sovereign" | string;
  legitimate: boolean;
  /** First child's favor (omen delta already applied, clamped 0–100). */
  favor: number;
  /** Second child's favor; present only when twinSex is set. */
  twinFavor?: number;
  bearerOutcome: BearerOutcome;
  /** Birth omen for the first child (null = none). */
  omen: BirthOmen | null;
  /** Descriptive phrase for the omen phenomenon (absent when omen is null). */
  omenText?: string;
  /** Birth omen for the second child; present only when twinSex is set. */
  twinOmen?: BirthOmen | null;
  twinOmenText?: string;
}

const FENGHOU_CAP = 80;

function tierValue(tier: FavorTier, cfg: GestationConfig): number {
  return cfg.childFavor.tierValues[tier];
}

function pickOutcome(roll: number, cfg: GestationConfig): Exclude<BearerOutcome, "safe"> {
  const { childDies, bearerDies } = cfg.dystocia.outcomeSplit;
  if (roll < childDies) return "child_dies";
  if (roll < childDies + bearerDies) return "bearer_dies";
  return "both";
}

type TwinType = "dragonPhoenix" | "twoDaughters" | "twoSons";

function rollTwinType(rngSeed: number, bm: number, carrier: string, cfg: TwinsConfig): TwinType | null {
  const roll = gestationRoll(`twins:${rngSeed}:${bm}:${carrier}`);
  const dp = cfg.dragonPhoenixChance;
  const td = cfg.twoDaughtersChance;
  const ts = cfg.twoSonsChance;
  if (roll < dp) return "dragonPhoenix";
  if (roll < dp + td) return "twoDaughters";
  if (roll < dp + td + ts) return "twoSons";
  return null;
}

function rollOmen(
  rngSeed: number,
  bm: number,
  carrier: string,
  childIndex: number,
  cfg: BirthOmenConfig,
): { omen: BirthOmen | null; text?: string } {
  const roll = gestationRoll(`omen:${rngSeed}:${bm}:${carrier}:${childIndex}`);
  if (roll < cfg.auspiciousChance) {
    return { omen: "auspicious", text: AUSPICIOUS_OMENS[roll % AUSPICIOUS_OMENS.length] };
  }
  if (roll < cfg.auspiciousChance + cfg.inauspiciousChance) {
    const idx = roll - cfg.auspiciousChance;
    return { omen: "inauspicious", text: INAUSPICIOUS_OMENS[idx % INAUSPICIOUS_OMENS.length] };
  }
  return { omen: null };
}

function applyOmenToFavor(base: number, omen: BirthOmen | null, cfg: BirthOmenConfig): number {
  if (omen === "auspicious") return Math.min(100, Math.max(0, base + cfg.auspiciousFavorDelta));
  if (omen === "inauspicious") return Math.min(100, Math.max(0, base + cfg.inauspiciousFavorDelta));
  return Math.min(100, Math.max(0, base));
}

export function resolveBirth(input: BirthInput): BirthVerdict {
  const { rngSeed, now, carrier, fatherId, transferredAtMonth, bearerIsFenghou } = input;
  const bm = monthOrdinal(now);
  const twinsConfig = input.cfg.twins ?? DEFAULT_TWINS;
  const omenConfig = input.cfg.birthOmen ?? DEFAULT_BIRTH_OMEN;

  // Twin type determination (before individual sex rolls)
  const twinType = rollTwinType(rngSeed, bm, carrier, twinsConfig);

  // Sex assignment
  let sex: HeirSex;
  let twinSex: HeirSex | undefined;
  if (twinType === "dragonPhoenix") {
    sex = "son";
    twinSex = "daughter";
  } else if (twinType === "twoDaughters") {
    sex = "daughter";
    twinSex = "daughter";
  } else if (twinType === "twoSons") {
    sex = "son";
    twinSex = "son";
  } else {
    sex = gestationRoll(`sex:${rngSeed}:${bm}:${carrier}`) % 2 === 0 ? "daughter" : "son";
  }

  const legitimate = bearerIsFenghou || carrier === "sovereign";

  // Base favor
  let baseFavor: number;
  if (carrier === "sovereign") {
    baseFavor = input.cfg.childFavor.selfPregnancy;
  } else {
    const stats = computeFavorStats(input.carrierRecord, now, input.thresholds);
    baseFavor = tierValue(stats.tier, input.cfg);
    if (bearerIsFenghou) baseFavor = Math.min(FENGHOU_CAP, baseFavor + input.cfg.childFavor.fenghouBonus);
  }

  // Dystocia (self-pregnancy never dystocia)
  let bearerOutcome: BearerOutcome = "safe";
  if (carrier !== "sovereign") {
    const chance = dystociaChance(transferredAtMonth ?? input.cfg.transferEarliestMonth, input.cfg);
    const hit = chance > 0 && gestationRoll(`dystocia:${rngSeed}:${bm}:${carrier}`) < chance;
    if (hit) bearerOutcome = pickOutcome(gestationRoll(`outcome:${rngSeed}:${bm}:${carrier}`), input.cfg);
  }

  // Omen rolls (one per child)
  const { omen, text: omenText } = rollOmen(rngSeed, bm, carrier, 0, omenConfig);
  const favor = applyOmenToFavor(baseFavor, omen, omenConfig);

  if (twinSex !== undefined) {
    const { omen: twinOmen, text: twinOmenText } = rollOmen(rngSeed, bm, carrier, 1, omenConfig);
    const twinFavor = applyOmenToFavor(baseFavor, twinOmen, omenConfig);
    return {
      sex, twinSex, fatherId, bearer: carrier, legitimate,
      favor, twinFavor,
      bearerOutcome,
      omen, ...(omenText ? { omenText } : {}),
      twinOmen, ...(twinOmenText ? { twinOmenText } : {}),
    };
  }

  return {
    sex, fatherId, bearer: carrier, legitimate,
    favor,
    bearerOutcome,
    omen, ...(omenText ? { omenText } : {}),
  };
}
