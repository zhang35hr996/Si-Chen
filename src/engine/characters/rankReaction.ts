/**
 * Render a consort's reaction to a 位分/封号 op from the content templates
 * (world.json.rankChangeReactions). Substitutes {self} (the post-op rank's
 * primary selfRef), {rank} (post-op rank name), {title} (granted 封号).
 */
import type { ContentDB } from "../content/loader";
import type { CharacterRank } from "../content/schemas";

export type RankOpKind = "promote" | "demote" | "grant_title" | "strip_title";

const FALLBACK: Record<RankOpKind, { lines: string[]; memory: string }> = {
  promote: { lines: ["谢陛下隆恩。"], memory: "陛下晋我为{rank}。" },
  demote: { lines: ["……{self}知罪。"], memory: "陛下贬我为{rank}。" },
  grant_title: { lines: ["谢陛下赐号。"], memory: "陛下赐我封号「{title}」。" },
  strip_title: { lines: ["{self}惶恐请罪。"], memory: "陛下褫夺我封号。" },
};

export function renderRankReaction(
  db: ContentDB,
  kind: RankOpKind,
  newRank: CharacterRank,
  title: string | undefined,
): { lines: string[]; memory: string } {
  const tmpl = db.world.rankChangeReactions?.[kind] ?? FALLBACK[kind];
  const self = newRank.selfRefs.toPlayer[0]!;
  const subst = (s: string) =>
    s.replaceAll("{self}", self).replaceAll("{rank}", newRank.name).replaceAll("{title}", title ?? "");
  return { lines: tmpl.lines.map(subst), memory: subst(tmpl.memory) };
}
