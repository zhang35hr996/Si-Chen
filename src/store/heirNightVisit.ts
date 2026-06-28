/** 毓庆宫夜访：私下、夜间、非正式的探视互动（谈心 / 陪坐片刻）。纯逻辑，无副作用。 */
import { heirPortraitSet, listHeirsBySex, residesInYuqing } from "../engine/characters/heirs";
import { timeOfDay } from "../engine/calendar/time";
import { resolveCustodianAvailability, custodianCanCareNow } from "../engine/characters/custodianAvailability";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState, Heir } from "../engine/state/types";

// ── 派生文字描述（毓庆宫近况 / 养父关系；隐藏属性不显示数值）──────────────────

/** 忽视程度的近况描述。 */
export function describeHeirNeglect(neglect: number): string {
  if (neglect <= 19) return "起居安稳";
  if (neglect <= 39) return "偶有寂寥";
  if (neglect <= 59) return "近来似受冷落";
  if (neglect <= 79) return "久疏照拂";
  return "性情已显孤僻戒备";
}

function describeBond(custodianBond: number): string {
  if (custodianBond <= 19) return "与抚养人颇为生疏";
  if (custodianBond <= 39) return "尚在相处";
  if (custodianBond <= 59) return "日渐亲近";
  if (custodianBond <= 79) return "感情深厚";
  return "视若亲父";
}

/** 养父关系描述：无有效抚养人时返回提示；否则按 custodianBond 分档。 */
export function describeCustodianRelation(db: ContentDB, state: GameState, heir: Heir): string {
  const { availability } = resolveCustodianAvailability(db, state, heir);
  if (!custodianCanCareNow(availability)) return "当前无人能够亲自照料。";
  return describeBond(heir.custodianBond);
}

/** 抚养人显示名（无/失效返回 null）。 */
export function custodianDisplayName(db: ContentDB, state: GameState, heir: Heir): string | null {
  const { custodianId, availability } = resolveCustodianAvailability(db, state, heir);
  if (!custodianId) return null;
  if (custodianId === "taihou") return "太后";
  const char = db.characters[custodianId] ?? state.generatedConsorts[custodianId];
  if (!char || char.kind !== "consort") return null;
  const st = state.standing[custodianId];
  const rank = st ? db.ranks[st.rank] : undefined;
  const name = resolveDisplayName(char, st, rank);
  // 暂时失效（禁足/冷宫）仍显示名字，但近况描述会另行提示无人照料。
  void availability;
  return name;
}

export type NightVisitAction = "heart_to_heart" | "quiet_company";

export interface HeirNightVisitPlan {
  effects: EventEffect[];
  lines: string[];
  portraitSet: string;
  speakerName: string;
}

function displayName(state: GameState, heir: Heir): string {
  const rows = listHeirsBySex(state.resources.bloodline.heirs, heir.sex);
  const ord = rows.find((r) => r.heir.id === heir.id)?.name ?? "皇嗣";
  const nick = heir.givenName ?? (heir.petName || "");
  return nick ? `${ord}·${nick}` : ord;
}

function pronoun(heir: Heir): string {
  return heir.sex === "daughter" ? "她" : "他";
}

function activeCompanionName(state: GameState, heirId: string): string | null {
  const a = state.heirCompanions[heirId];
  return a && a.status === "active" ? a.profile.name : null;
}

// ── 谈心 ───────────────────────────────────────────────────────────────────────

function heartToHeartLines(
  state: GameState,
  db: ContentDB,
  heir: Heir,
  name: string,
): string[] {
  const ta = pronoun(heir);
  const { neglect, imperialFear, closeness, custodianBond } = heir;
  const { sociability } = heir.personality;
  const companion = activeCompanionName(state, heir.id);
  const { availability } = resolveCustodianAvailability(db, state, heir);
  const hasCustodian = custodianCanCareNow(availability);

  const opening = `夜色已深，陛下移步毓庆宫，在${name}榻前坐下，问起近来起居。`;
  const lines = [opening];

  if (neglect >= 60) {
    lines.push(
      `${name}起初只是安静坐着，对陛下的关切似乎有些无所适从。过了许久，才低声说起近日的一桩小事。`,
    );
  } else if (imperialFear >= 60) {
    lines.push(
      `${name}每句话都答得规矩，直到陛下不再追问功课，${ta}的肩背才渐渐松了下来。`,
    );
  } else if (companion) {
    lines.push(
      `${name}提起今日与伴读${companion}在文昭殿相处的种种，说着说着，眉眼间便添了几分笑意。`,
    );
  } else if (custodianBond >= 60 && hasCustodian) {
    lines.push(`${name}说起养父昨日送来的书，眉眼间不自觉带了笑。`);
  } else if (closeness >= 60 || sociability >= 65) {
    lines.push(`${name}话头一开便收不住，絮絮说起文昭殿与毓庆宫的种种琐事，神情雀跃。`);
  } else {
    lines.push(`${name}起先有些拘谨，应答几句后才渐渐放开，与陛下说起些日常小事。`);
  }

  if (!hasCustodian && neglect >= 40) {
    lines.push(`陛下听${ta}言语间少有人照拂，心下微动，多陪了${ta}一会儿。`);
  }
  return lines;
}

// ── 陪坐片刻 ───────────────────────────────────────────────────────────────────

function quietCompanyLines(
  state: GameState,
  heir: Heir,
  name: string,
): string[] {
  const ta = pronoun(heir);
  const { neglect, imperialFear } = heir;
  const { assertiveness, guile } = heir.personality;
  const companion = activeCompanionName(state, heir.id);

  const opening = `陛下未多言语，只在${name}身边坐下，陪${ta}消磨这夜里的一段时光。`;
  const lines = [opening];

  if (companion) {
    lines.push(`${name}一边摆弄棋子，一边絮絮说着与伴读${companion}相处的点滴，陛下静静听着，并不打断。`);
  } else if (imperialFear >= 60) {
    lines.push(`${name}起先正襟危坐，见陛下只是安静陪着，并不考较功课，神色才慢慢松弛下来。`);
  } else if (neglect >= 60) {
    lines.push(`${name}全程少言，却悄悄往陛下身边挪了挪，似是难得有人这样陪着。`);
  } else if (assertiveness >= 65) {
    lines.push(`${name}拉着陛下看${ta}新得的弓，比划着今日骑射的招式，兴致颇高。`);
  } else if (guile >= 65) {
    lines.push(`${name}不动声色地偎在一旁，言语不多，却把陛下的神色看在眼里。`);
  } else {
    lines.push(`${name}捧着一卷书，与陛下一同就着灯火翻看，偶尔低声念上一两句。`);
  }
  return lines;
}

// ── 公开 API ───────────────────────────────────────────────────────────────────

/** 构造夜访台词与 effect。非在居/已故/非夜间返回 null（与 effect 校验一致）。 */
export function buildHeirNightVisit(
  db: ContentDB,
  state: GameState,
  heirId: string,
  action: NightVisitAction,
): HeirNightVisitPlan | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || heir.lifecycle !== "alive") return null;
  if (!residesInYuqing(heir, state.calendar)) return null;
  if (timeOfDay(state.calendar) !== "night") return null;

  const name = displayName(state, heir);
  const lines =
    action === "heart_to_heart"
      ? heartToHeartLines(state, db, heir, name)
      : quietCompanyLines(state, heir, name);

  return {
    effects: [{ type: "heir_night_visit", heirId, action }],
    lines,
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
  };
}
