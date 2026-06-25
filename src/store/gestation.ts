/**
 * 孕育流程装配层（供 App 编排）：解析配置 → 纯函数裁决 → 组装 effects + 反应台词。
 * effects 走正常漏斗；lines 经 ReactionScreen 对话缝隙重放。
 */
import { monthOrdinal, toGameTime } from "../engine/calendar/time";
import { resolveBirth, type BirthVerdict } from "../engine/characters/birth";
import {
  DEFAULT_GESTATION,
  birthSlot,
  plannedBirthMonth,
  recoverUntilMonth,
  type GestationConfig,
} from "../engine/characters/gestation";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState, GestationState } from "../engine/state/types";
import { bedchamberConfig } from "./bedchamber";
import { childbirthCostDelta } from "./pregnancyCost";
import { planHealthChange } from "./health";

export function gestationConfig(db: ContentDB): GestationConfig {
  return db.world.gestation ?? DEFAULT_GESTATION;
}

function displayName(db: ContentDB, state: GameState, charId: string): string {
  const ch = db.characters[charId];
  if (!ch) return charId;
  const st = state.standing[charId];
  return resolveDisplayName(ch, st, st ? db.ranks[st.rank] : undefined);
}

export interface BirthTiming {
  birthMonthOrdinal: number;
  birthSlot: number;
}

/** 某条胎息的确定生产月 + 当月行动点 slot。 */
export function plannedBirthOf(db: ContentDB, state: GameState, gest: GestationState): BirthTiming {
  const cfg = gestationConfig(db);
  const bm = plannedBirthMonth(state.rngSeed, gest.conceivedAt, gest.carrier, cfg);
  return { birthMonthOrdinal: bm, birthSlot: birthSlot(state.rngSeed, bm, state.calendar.apMax) };
}

/** 确定的生产月 + 当月行动点 slot（首条胎息）。无胎息返回 null。 */
export function plannedBirth(db: ContentDB, state: GameState): BirthTiming | null {
  const gest = state.resources.bloodline.gestations[0];
  return gest ? plannedBirthOf(db, state, gest) : null;
}

/** 某条胎息是否已到生产时机（到月 + slot；过月即补触发）。 */
function gestationDue(db: ContentDB, state: GameState, gest: GestationState): boolean {
  const timing = plannedBirthOf(db, state, gest);
  const cur = monthOrdinal(state.calendar);
  if (cur > timing.birthMonthOrdinal) return true;
  if (cur < timing.birthMonthOrdinal) return false;
  const slot = state.calendar.apMax - state.calendar.ap;
  return slot >= timing.birthSlot;
}

/** 当前到产的第一条胎息（多线孕育下逐条生产）。无则返回 null。 */
export function dueGestation(db: ContentDB, state: GameState): GestationState | null {
  return state.resources.bloodline.gestations.find((g) => gestationDue(db, state, g)) ?? null;
}

/** 是否有任意胎息到产。 */
export function birthDue(db: ContentDB, state: GameState): boolean {
  return dueGestation(db, state) !== null;
}

export type BirthOutcome = "safe" | "child_dies" | "bearer_dies" | "both";

export interface GestationPlan {
  effects: EventEffect[];
  lines: string[];
  /** 生产承载侍君（非自孕安产时供产后晋升用）；自孕为 "sovereign"。 */
  bearer: "sovereign" | string;
  bearerOutcome: BirthOutcome;
}

/**
 * 生产裁决 → birth effect + 播报台词。默认对「到产的第一条胎息」裁决；可显式指定
 * 一条胎息。无可裁决胎息返回 null。
 */
export function buildBirth(db: ContentDB, state: GameState, gestation?: GestationState): GestationPlan | null {
  const gest = gestation ?? dueGestation(db, state) ?? state.resources.bloodline.gestations[0];
  if (!gest) return null;
  const cfg = gestationConfig(db);
  const now = toGameTime(state.calendar);
  const bearerIsFenghou = gest.carrier === "shen_zhibai";

  const verdict = resolveBirth({
    rngSeed: state.rngSeed,
    now,
    carrier: gest.carrier,
    fatherId: gest.fatherId ?? null,
    transferredAtMonth: gest.transferredAtMonth,
    bearerIsFenghou,
    carrierRecord: gest.carrier === "sovereign" ? undefined : state.bedchamber[gest.carrier],
    thresholds: bedchamberConfig(db).tiers,
    cfg,
  });

  const safe = verdict.bearerOutcome === "safe";
  const recover =
    gest.carrier !== "sovereign" && (safe || verdict.bearerOutcome === "child_dies")
      ? recoverUntilMonth(monthOrdinal(now), safe, cfg)
      : undefined;

  const lines = buildBirthLines(db, state, gest.carrier, verdict.bearerOutcome, verdict);

  const birthEffect: EventEffect = {
    type: "birth",
    sex: verdict.sex,
    ...(verdict.twinSex !== undefined ? { twinSex: verdict.twinSex } : {}),
    fatherId: verdict.fatherId,
    bearer: verdict.bearer,
    legitimate: verdict.legitimate,
    favor: verdict.favor,
    ...(verdict.twinFavor !== undefined ? { twinFavor: verdict.twinFavor } : {}),
    bearerOutcome: verdict.bearerOutcome,
    ...(recover !== undefined ? { recoverUntilMonth: recover } : {}),
  };

  const bearerSurvives = verdict.bearerOutcome === "safe" || verdict.bearerOutcome === "child_dies";
  const costDelta = childbirthCostDelta(verdict.bearerOutcome); // safe −5 / child_dies −10 / 其它 0
  let maternalFx: EventEffect[] = [];
  if (gest.carrier !== "sovereign") {
    maternalFx = bearerSurvives
      ? (costDelta !== 0
          ? planHealthChange(state, { subject: { kind: "consort", id: gest.carrier }, healthDelta: costDelta, cause: "childbirth", at: now }).effects
          : [])
      : planHealthChange(state, { subject: { kind: "consort", id: gest.carrier }, forceDeath: true, cause: "childbirth", at: now }).effects;
  }

  return {
    effects: [birthEffect, ...maternalFx], // 先落库皇嗣/移除 gestation，再扣血/置死母方（§5 顺序）
    lines,
    bearer: gest.carrier,
    bearerOutcome: verdict.bearerOutcome,
  };
}

/**
 * 生产名词短语（含数量/种类）：作为一个整体嵌入叙事句，避免"两位龙凤双胎"式拼接。
 * 导出供叙事测试直接验证短语形式。
 */
export function birthPhrase(sex: BirthVerdict["sex"], twinSex?: BirthVerdict["twinSex"]): string {
  if (twinSex === undefined) return sex === "daughter" ? "一位皇子" : "一位皇郎";
  if ((sex === "son" && twinSex === "daughter") || (sex === "daughter" && twinSex === "son")) {
    return "一对龙凤胎";
  }
  if (sex === "daughter") return "两位双生皇子";
  return "两位双生皇郎";
}

function omenLine(omen: BirthVerdict["omen"] | undefined, text: string | undefined, childLabel: string): string | null {
  if (!omen || !text) return null;
  if (omen === "auspicious") return `${childLabel}降生之时，${text}，宫人皆以为天降吉兆，陛下对此子倍加垂怜。`;
  return `${childLabel}降生之时，${text}，太史令进言此为凶兆，宫中上下不免暗自惶恐。`;
}

function buildBirthLines(
  db: ContentDB,
  state: GameState,
  carrier: string,
  outcome: BirthOutcome,
  verdict: BirthVerdict,
): string[] {
  const isTwin = verdict.twinSex !== undefined;
  const phrase = birthPhrase(verdict.sex, verdict.twinSex);

  let main: string;
  if (carrier === "sovereign") {
    main = `陛下临盆，诞下${phrase}，母子均安，举国称庆。`;
  } else {
    const name = displayName(db, state, carrier);
    switch (outcome) {
      case "safe":
        main = `${name}临盆，顺利诞下${phrase}，父子均安。`;
        break;
      case "child_dies":
        main = isTwin
          ? `${name}难产，两名皇嗣皆未能保住，太医勉力保住了${name}性命。噩耗传来，宫中一片缄默。`
          : `${name}难产，胎死腹中，太医勉力保住了${name}性命。噩耗传来，宫中一片缄默。`;
        break;
      case "bearer_dies":
        main = `${name}难产，拼死诞下${phrase}，自己却血崩而亡。宫人垂泪相送。`;
        break;
      case "both":
        main = isTwin
          ? `${name}难产，一尸三命。太医跪地请罪，宫中举哀。`
          : `${name}难产，一尸两命。太医跪地请罪，宫中举哀。`;
        break;
    }
  }

  const lines: string[] = [main];

  // Omen lines only for actually surviving children (safe or bearer_dies)
  const childSurvives = outcome === "safe" || outcome === "bearer_dies";
  if (childSurvives) {
    const firstLabel = isTwin ? (verdict.sex === "son" ? "长子" : "长女") : "此子";
    const l1 = omenLine(verdict.omen, verdict.omenText, firstLabel);
    if (l1) lines.push(l1);

    if (isTwin) {
      const secondLabel = verdict.twinSex === "son" ? "次子" : "次女";
      const l2 = omenLine(verdict.twinOmen, verdict.twinOmenText, secondLabel);
      if (l2) lines.push(l2);
    }
  }

  return lines;
}
