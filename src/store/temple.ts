/** 寺庙动作（上香/求签）：确定性纯逻辑，给定 state+key 输出确定。 */
import { gestationRoll } from "../engine/characters/gestation";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export interface TempleResult {
  effects: EventEffect[];
  lines: string[];
}

export type FortuneTier = "大吉" | "吉" | "中平" | "凶" | "大凶";

const sov = (field: string, delta: number): EventEffect =>
  ({ type: "resource", pillar: "sovereign", field, delta }) as EventEffect;
const nat = (field: string, delta: number): EventEffect =>
  ({ type: "resource", pillar: "nation", field, delta }) as EventEffect;

/** a..b 闭区间内的确定性取值。 */
const mag = (key: string, tag: string, a: number, b: number): number =>
  a + (gestationRoll(`${key}:${tag}`) % (b - a + 1));

/** 上香祈福：民心/威望/健康 各 +0..5。 */
export function buildIncense(_db: ContentDB, _state: GameState, key: string): TempleResult {
  return {
    effects: [
      nat("publicSupport", mag(key, "ps", 0, 5)),
      sov("prestige", mag(key, "pr", 0, 5)),
      sov("health", mag(key, "he", 0, 5)),
    ],
    lines: [
      "陛下亲临佛前，焚香祝祷，愿国泰民安、风调雨顺。",
      "钟磬声中香烟缭绕，陛下心绪渐宁，群臣称颂圣德。",
    ],
  };
}

/** roll(0–99) → 签档：0–9 大吉 / 10–34 吉 / 35–64 中平 / 65–89 凶 / 90–99 大凶。 */
export function fortuneTierFromRoll(roll: number): FortuneTier {
  if (roll < 10) return "大吉";
  if (roll < 35) return "吉";
  if (roll < 65) return "中平";
  if (roll < 90) return "凶";
  return "大凶";
}

const FORTUNE_LINES: Record<FortuneTier, string[]> = {
  大吉: ["签筒轻摇，落下一支上上签。住持合十贺曰：紫气东来，国运昌隆，万民咸服。"],
  吉: ["落签为吉。住持笑道：风调雨顺，仓廪渐丰，乃太平之兆。"],
  中平: ["得一中平签。住持曰：守成持重，无咎无誉，静待天时。"],
  凶: ["落签为凶。住持蹙眉：近日恐有微词流于市井，望陛下慎之。"],
  大凶: ["签落于地，赫然下下签。住持神色凝重：民怨暗生、流言四起，宜修德安民以解之。"],
};

/** 求签：先按 roll 分档，再档内取量级（均 ≤ AXIS_CAP=10）。整体偏正。 */
export function buildFortune(
  _db: ContentDB,
  _state: GameState,
  key: string,
): TempleResult & { tier: FortuneTier } {
  const tier = fortuneTierFromRoll(gestationRoll(`${key}:tier`));
  const effects: EventEffect[] = [];
  if (tier === "大吉") {
    effects.push(nat("publicSupport", mag(key, "ps", 8, 10)));
    effects.push(nat("productivity", mag(key, "pd", 8, 10)));
    effects.push(
      gestationRoll(`${key}:extra`) % 2 === 0
        ? sov("prestige", mag(key, "ex", 4, 6))
        : nat("treasury", mag(key, "ex", 4, 6)),
    );
  } else if (tier === "吉") {
    effects.push(nat("publicSupport", mag(key, "ps", 5, 7)));
    effects.push(nat("productivity", mag(key, "pd", 5, 7)));
  } else if (tier === "中平") {
    effects.push(nat("publicSupport", mag(key, "ps", 0, 2)));
  } else if (tier === "凶") {
    effects.push(nat("publicSupport", -mag(key, "ps", 2, 4)));
  } else {
    effects.push(nat("publicSupport", -mag(key, "ps", 6, 8)));
    effects.push(
      gestationRoll(`${key}:extra`) % 2 === 0
        ? nat("rumor", mag(key, "ex", 2, 4))
        : nat("clanDiscontent", mag(key, "ex", 2, 4)),
    );
  }
  return { tier, effects, lines: FORTUNE_LINES[tier] };
}
