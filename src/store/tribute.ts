/** 属地进贡 / 大臣进献：动态概率 + 物品池 + 乘风报告（声明式选择）。 */
import { gestationRoll } from "../engine/characters/gestation";
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";
import type { ChengFengPrompt } from "./prompt";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 属地贡物类别（非食物非珍宝）。 */
const PROVINCE_CATEGORIES = ["妆品", "香", "绸缎", "皮毛", "文房", "乐器", "玩器"];
/** 大臣进献珍宝类别。 */
const MINISTER_CATEGORIES = ["器玩", "珍禽异兽"];
/** 属地名（确定性取）。 */
const PROVINCES = ["蜀地", "江南", "岭南", "西域", "闽地", "北地", "海疆", "山东"];

export function tributeChance(state: GameState): number {
  const { productivity, publicSupport } = state.resources.nation;
  const { prestige } = state.resources.sovereign;
  return clamp(Math.round(10 + 0.1 * ((productivity - 50) + (publicSupport - 50) + (prestige - 50))), 3, 40);
}

export function ministerTributeChance(state: GameState): number {
  const { ministerLoyalty, corruption } = state.resources.nation;
  const { prestige } = state.resources.sovereign;
  return clamp(Math.round(10 + 0.1 * ((ministerLoyalty - 50) + (corruption - 50) + (prestige - 50))), 3, 40);
}

function pick<T>(arr: T[], seed: string): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[gestationRoll(seed) % arr.length];
}

function itemsInCategories(db: ContentDB, cats: string[]): string[] {
  return Object.values(db.items).filter((i) => cats.includes(i.category)).map((i) => i.id);
}

function twoChoices(itemId: string): ChengFengPrompt["choices"] {
  return [
    { label: "赏赐", action: { type: "gift", itemId } },
    { label: "知道了，收进库房", action: { type: "stash", itemId } },
  ];
}

export function buildProvinceTribute(db: ContentDB, state: GameState, seedKey: string): ChengFengPrompt | null {
  if (gestationRoll(`prov:gate:${seedKey}`) % 100 >= tributeChance(state)) return null;
  const pool = itemsInCategories(db, PROVINCE_CATEGORIES);
  const itemId = pick(pool, `prov:item:${seedKey}`);
  if (!itemId) return null;
  const province = pick(PROVINCES, `prov:place:${seedKey}`)!;
  const name = db.items[itemId]!.name;
  return {
    speakerId: "cheng_feng",
    line: `陛下，${province}进贡了${name}，是否收进私库？`,
    choices: twoChoices(itemId),
  };
}

export function buildMinisterTribute(db: ContentDB, state: GameState, seedKey: string): ChengFengPrompt | null {
  if (gestationRoll(`min:gate:${seedKey}`) % 100 >= ministerTributeChance(state)) return null;
  const officials = Object.values(state.officials);
  if (officials.length === 0) return null;
  const pool = itemsInCategories(db, MINISTER_CATEGORIES);
  const itemId = pick(pool, `min:item:${seedKey}`);
  if (!itemId) return null;
  const official = officials[gestationRoll(`min:who:${seedKey}`) % officials.length]!;
  const postName = (official.postId ? db.officialPosts[official.postId]?.name : undefined) ?? "大臣";
  const name = db.items[itemId]!.name;
  return {
    speakerId: "cheng_feng",
    line: `陛下，${postName}${official.surname}${official.givenName}进献了${name}，是否收进私库？`,
    choices: twoChoices(itemId),
  };
}
