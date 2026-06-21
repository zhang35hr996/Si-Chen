/**
 * Compose a 位分/封号 op into (effects batch + reaction lines) for the UI.
 * Returns null when nothing changes (e.g. selecting the current rank). The
 * effects go through the normal funnel; lines replay through the dialogue seam.
 */
import { effectiveOrder } from "../engine/characters/standing";
import { renderRankReaction, type RankOpKind } from "../engine/characters/rankReaction";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export type RankOpRequest =
  | { kind: "set_rank"; rank: string }
  | { kind: "set_title"; title: string }
  | { kind: "remove_title" };

export interface RankOp {
  kind: RankOpKind;
  effects: EventEffect[];
  lines: string[];
  charId: string;
}

export function buildRankOp(
  db: ContentDB,
  state: GameState,
  charId: string,
  req: RankOpRequest,
): RankOp | null {
  const standing = state.standing[charId];
  if (!standing) return null;
  const curRank = db.ranks[standing.rank];
  if (!curRank) return null;

  let kind: RankOpKind;
  let postRank = curRank;
  let postTitle = standing.title;
  const effects: EventEffect[] = [];

  if (req.kind === "set_rank") {
    const target = db.ranks[req.rank];
    if (!target || req.rank === standing.rank) return null; // unknown or no-op
    kind = effectiveOrder(target, standing.title !== undefined) > effectiveOrder(curRank, standing.title !== undefined)
      ? "promote"
      : "demote";
    postRank = target;
    effects.push({ type: "set_rank", char: charId, rank: req.rank });
  } else if (req.kind === "set_title") {
    if (!req.title || req.title === standing.title) return null;
    kind = "grant_title";
    postTitle = req.title;
    effects.push({ type: "set_title", char: charId, title: req.title });
  } else {
    if (standing.title === undefined) return null; // nothing to strip
    kind = "strip_title";
    postTitle = undefined;
    effects.push({ type: "remove_title", char: charId });
  }

  const reaction = renderRankReaction(db, kind, postRank, postTitle);
  effects.push({
    type: "memory",
    char: charId,
    entry: {
      kind: "episodic",
      summary: reaction.memory,
      strength: kind === "strip_title" || kind === "demote" ? 70 : 55,
      retention: kind === "strip_title" || kind === "demote" ? "permanent" : "slow",
      subjectIds: ["player", charId],
      perspective: "target",
      triggerTags: ["player", kind],
      unresolved: kind === "strip_title" || kind === "demote",
      emotions: kind === "strip_title" || kind === "demote" ? { shame: 30 } : { joy: 30 },
    },
  });
  return { kind, effects, lines: reaction.lines, charId };
}
