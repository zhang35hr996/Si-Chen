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
      `${name}抚着微隆的小腹，向陛下屈膝行礼，动作格外小心。`,
      `${self}定当安心养胎，护持皇嗣周全，不负圣恩。`,
    ];
  }
  if (lifecycle === "delivered") {
    return [`${name}向陛下盈盈下拜，言及育儿琐事，眉眼间满是对孩子的慈爱。`];
  }
  if (lifecycle === "candidate") {
    return [`${name}神色轻快，似已听闻了好消息，眉眼间难掩喜色。`];
  }

  // normal：按恩宠深浅分亲疏。
  const favor = st?.favor ?? 0;
  if (favor >= 60) {
    return [`${name}见陛下亲临，喜形于色，敛衽近前，柔声请安，又忙着招呼宫人上茶点心，样样都是按皇帝的喜好来。`];
  }
  if (favor >= 30) {
    return [`${name}从容行礼，应对得体，与陛下闲谈片刻，尽是小男儿羞怯的神态。`];
  }
  return [`${name}屈膝见礼，言辞拘谨，对答之间，恪守礼仪。`];
}
