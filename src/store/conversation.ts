/**
 * 与在场侍君「对话」（消耗 1 行动点）的脚本化反应台词。按生命周期 + 恩宠分支，
 * 与 rankOps / bedchamber 同构：返回纯台词，经 ReactionScreen 对话缝隙重放。
 * 返回 null 表示对象不是侍君（调用方不应给出对话入口）。
 */
import { renderSelfRef, resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";

export function buildConversation(db: ContentDB, state: GameState, charId: string): string[] | null {
  const ch = db.characters[charId];
  if (!ch || ch.kind !== "consort") return null;
  const st = state.standing[charId];
  const rank = st ? db.ranks[st.rank] : undefined;
  const name = resolveDisplayName(ch, st, rank);
  const self = renderSelfRef(rank);
  const lifecycle = st?.lifecycle ?? "normal";

  if (lifecycle === "carrying") {
    return [
      `${name}抚着微隆的小腹，向陛下屈膝行礼，言谈格外小心。`,
      `${self}定当安心养胎，护持皇嗣周全，不负圣恩。`,
    ];
  }
  if (lifecycle === "delivered") {
    return [`${name}向陛下盈盈下拜，言及育儿琐事，眉眼间难掩慈色。`];
  }
  if (lifecycle === "candidate") {
    return [`${name}神色恭谨，似已知晓宗正寺之议，垂首听候陛下示下。`];
  }

  // normal：按恩宠深浅分亲疏。
  const favor = st?.favor ?? 0;
  if (favor >= 60) {
    return [`${name}见陛下亲临，喜动颜色，敛衽近前，柔声叙话，言谈间满是孺慕之情。`];
  }
  if (favor >= 30) {
    return [`${name}从容行礼，应对得体，与陛下闲谈片刻，神色渐渐舒展。`];
  }
  return [`${name}屈膝见礼，言辞拘谨，对答之间，略显疏离。`];
}
