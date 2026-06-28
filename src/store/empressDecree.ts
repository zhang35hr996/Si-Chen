/** 皇后自行下旨升降「贵人及以下」侍君（纯逻辑，种子化确定性）。 */
import { gestationRoll } from "../engine/characters/gestation";
import { activeEmpressId, isEmpress } from "../engine/characters/empress";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import { isAssignableRank, type EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export const DECREE_CHANCE = 3; // 每行动点 3%
export const PROMOTE_FAVOR = 65;
export const DEMOTE_FAVOR = 35;
export const DECREE_RANK_CEILING = 116; // 贵人（正五品）
export const DECREE_RANK_FLOOR = 50; // 更衣（最低正式位分）

export type { ReactionBeat as DecreeReaction } from "../engine/punishments/types";
import type { ReactionBeat } from "../engine/punishments/types";

export interface DecreePlan {
  effects: EventEffect[];
  reactions: ReactionBeat[];
}

type Dir = "promote" | "demote";

function bandRanks(db: ContentDB): { id: string; order: number }[] {
  return Object.values(db.ranks)
    .filter((r) => isAssignableRank(r) && r.domain === "harem" && r.order >= DECREE_RANK_FLOOR && r.order <= DECREE_RANK_CEILING)
    .map((r) => ({ id: r.id, order: r.order }))
    .sort((a, b) => a.order - b.order);
}

/** 相邻一级位分 id（promote=更高的最近一级；demote=更低）。触边返回 null。 */
export function adjacentHaremRank(db: ContentDB, currentRankId: string, dir: Dir): string | null {
  const band = bandRanks(db);
  const cur = db.ranks[currentRankId];
  if (!cur) return null;
  if (dir === "promote") {
    const up = band.filter((r) => r.order > cur.order);
    return up.length ? up[0]!.id : null;
  }
  const down = band.filter((r) => r.order < cur.order);
  return down.length ? down[down.length - 1]!.id : null;
}

/** 选人 + 方向 + 相邻位分（不含概率门）。无合法懿旨返回 null。 */
export function decideDecree(db: ContentDB, state: GameState, seedKey: string): DecreePlan | null {
  const candidates = Object.values(db.characters).filter((c) => {
    if (c.kind !== "consort" || isEmpress(state, c.id)) return false;
    if (c.defaultLocation === "changmengong") return false;
    const st = state.standing[c.id];
    if (!st || st.lifecycle === "deceased") return false;
    const rank = db.ranks[st.rank];
    return !!rank && isAssignableRank(rank) && rank.domain === "harem" && rank.order >= DECREE_RANK_FLOOR && rank.order <= DECREE_RANK_CEILING;
  });
  if (candidates.length === 0) return null;

  const pick = candidates[gestationRoll(`empress:pick:${seedKey}`) % candidates.length]!;
  const st = state.standing[pick.id]!;
  const dir: Dir | null = st.favor >= PROMOTE_FAVOR ? "promote" : st.favor < DEMOTE_FAVOR ? "demote" : null;
  if (dir === null) return null;

  const targetId = adjacentHaremRank(db, st.rank, dir);
  if (targetId === null) return null;

  const name = resolveDisplayName(pick, st, db.ranks[st.rank]);
  const targetName = db.ranks[targetId]!.name;
  const summary = dir === "promote" ? `皇后下旨晋我为${targetName}` : `皇后下旨贬我为${targetName}`;

  const effects: EventEffect[] = [
    { type: "set_rank", char: pick.id, rank: targetId, authority: { kind: "harem_administrator", actorId: activeEmpressId(state) ?? "shen_zhibai", office: "empress" as const } },
    {
      type: "memory",
      char: pick.id,
      entry: {
        kind: "episodic",
        summary,
        strength: dir === "demote" ? 70 : 55,
        retention: dir === "demote" ? "permanent" : "slow",
        subjectIds: [activeEmpressId(state) ?? "shen_zhibai", pick.id],
        perspective: "target",
        triggerTags: ["empress", dir],
        unresolved: dir === "demote",
        emotions: dir === "demote" ? { shame: 40 } : { relief: 20 },
      },
    },
  ];
  const verb = dir === "promote" ? "晋" : "贬";
  const reactions: ReactionBeat[] = [
    { speakerId: "wei_sui", lines: [`司礼官启奏：皇后殿下懿旨——${verb}${name}为${targetName}。`] },
    {
      speakerId: pick.id,
      lines: dir === "promote" ? [`${name}叩谢皇后殿下恩典。`] : [`${name}默然领旨，不敢有怨。`],
    },
  ];
  return { effects, reactions };
}

/** 含 3% 概率门：每行动点调用一次，命中且有合法懿旨才返回 plan。 */
export function buildEmpressDecree(db: ContentDB, state: GameState, seedKey: string): DecreePlan | null {
  if (gestationRoll(`empress:gate:${seedKey}`) % 100 >= DECREE_CHANCE) return null;
  return decideDecree(db, state, seedKey);
}
