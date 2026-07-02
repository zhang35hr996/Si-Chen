/** 寺庙动作（上香/求签）：确定性纯逻辑，给定 state+key 输出确定。 */
import { gestationRoll } from "../engine/characters/gestation";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export interface TempleResult {
  effects: EventEffect[];
  /** 住持（zhuchi）当面禀报的签辞/祝祷。 */
  zhuchiLines: string[];
  /** 乘风（cheng_feng）随后回禀的俗世应验（如流言四起、民心归附）。 */
  chengfengLines: string[];
}

export type FortuneTier = "大吉" | "吉" | "中平" | "凶" | "大凶";

const sov = (field: string, delta: number): EventEffect =>
  ({ type: "resource", pillar: "sovereign", field, delta }) as EventEffect;
const nat = (field: string, delta: number): EventEffect =>
  ({ type: "resource", pillar: "nation", field, delta }) as EventEffect;

/** a..b 闭区间内的确定性取值。 */
const mag = (key: string, tag: string, a: number, b: number): number =>
  a + (gestationRoll(`${key}:${tag}`) % (b - a + 1));

/** 上香祈福：民心/威望/健康 各 +0..5。住持祝祷，乘风回禀民心。 */
export function buildIncense(_db: ContentDB, _state: GameState, key: string): TempleResult {
  return {
    effects: [
      nat("publicSupport", mag(key, "ps", 0, 5)),
      sov("prestige", mag(key, "pr", 0, 5)),
      sov("health", mag(key, "he", 0, 5)),
    ],
    zhuchiLines: [
      "陛下亲临佛前，焚香祝祷。贫僧谨为陛下祈愿：国泰民安，风调雨顺。",
      "钟磬声中香烟缭绕，唯愿陛下圣体康泰，社稷长安。",
    ],
    chengfengLines: [
      "陛下，京中已传开陛下亲临慈恩寺为万民祈福之事，百姓无不感念圣德，民心归附、口碑日隆。",
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

/** 住持当面的签辞（住持视角直述）。 */
const ZHUCHI_LINES: Record<FortuneTier, string[]> = {
  大吉: ["签筒轻摇，落下一支上上签。住持合十贺曰：紫气东来，国运昌隆，万民臣服。"],
  吉: ["所落为吉签。住持贺曰：风调雨顺，仓廪渐丰，乃太平之兆。"],
  中平: ["所得为中平签。住持曰：守成持重，无咎无誉，静待天时即可。"],
  凶: ["所落为凶签。住持蹙眉道：近日恐有微词流于市井，望陛下慎之。"],
  大凶: ["签落于地，赫然下下签。住持神色凝重：民怨暗生、流言四起，宜修德安民以解之。"],
};

/** 乘风随后回禀的俗世应验。 */
const CHENGFENG_LINES: Record<FortuneTier, string[]> = {
  大吉: ["陛下，签辞果然应验。这几日各地报来皆是好消息，民心振奋、市井皆颂圣明。"],
  吉: ["陛下，臣听闻坊间近来颇为安乐，仓廪渐实，确是好兆头。"],
  中平: ["陛下，臣瞧着，近来朝野无甚大事，平平稳稳的。"],
  凶: ["陛下，属下留心着市井里已隐隐有几句不中听的闲话传开了。"],
  大凶: ["陛下，臣不敢瞒，京中近日流言四起，民间已有怨声，怕是得费些心思了。"],
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
    effects.push(sov("prestige", mag(key, "ex", 4, 6)));
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
  return { tier, effects, zhuchiLines: ZHUCHI_LINES[tier], chengfengLines: CHENGFENG_LINES[tier] };
}
