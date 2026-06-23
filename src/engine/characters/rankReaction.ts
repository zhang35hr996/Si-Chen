/**
 * Render a consort's reaction to a 位分/封号 op from the content templates
 * (world.json.rankChangeReactions). Substitutes {self} (the post-op rank's
 * primary selfRef), {rank} (post-op rank name), {title} (granted 封号).
 *
 * 当 authority 为 harem_administrator 时，使用 administratorRankChangeReactions
 * 对应 office 的模板，避免台词误归因于皇帝。
 */
import type { ContentDB } from "../content/loader";
import type { CharacterRank } from "../content/schemas";

export type RankOpKind = "promote" | "demote" | "grant_title" | "strip_title";

export type RankReactionAuthority =
  | { kind: "sovereign" }
  | { kind: "harem_administrator"; office: "empress" | "acting_consort" };

const SOVEREIGN_FALLBACK: Record<RankOpKind, { lines: string[]; memory: string }> = {
  promote: { lines: ["谢陛下隆恩。"], memory: "陛下晋我为{rank}。" },
  demote: { lines: ["……{self}知罪。"], memory: "陛下贬我为{rank}。" },
  grant_title: { lines: ["谢陛下赐号。"], memory: "陛下赐我封号「{title}」。" },
  strip_title: { lines: ["{self}惶恐请罪。"], memory: "陛下褫夺我封号。" },
};

const ADMIN_FALLBACK: Record<"empress" | "acting_consort", Record<RankOpKind, { lines: string[]; memory: string }>> = {
  empress: {
    promote: { lines: ["臣侍谨领凤后懿旨。"], memory: "凤后下旨晋我为{rank}。" },
    demote: { lines: ["……{self}领旨。"], memory: "凤后下旨贬我为{rank}，{self}不敢有违。" },
    grant_title: { lines: ["谢凤后赐号，{self}惶恐领旨。"], memory: "凤后赐我封号「{title}」。" },
    strip_title: { lines: ["{self}领旨，不敢有违。"], memory: "凤后下令褫夺我封号。" },
  },
  acting_consort: {
    promote: { lines: ["侍身谨领协理六宫之令。"], memory: "协理六宫者晋我为{rank}。" },
    demote: { lines: ["……侍身领令。"], memory: "协理六宫者贬我为{rank}，侍身不敢违命。" },
    grant_title: { lines: ["侍身谨领，不敢轻慢。"], memory: "协理六宫者赐我封号「{title}」。" },
    strip_title: { lines: ["侍身领令，不敢有违。"], memory: "协理六宫者褫夺我封号。" },
  },
};

export function renderRankReaction(
  db: ContentDB,
  kind: RankOpKind,
  newRank: CharacterRank,
  title: string | undefined,
  authority?: RankReactionAuthority,
): { lines: string[]; memory: string } {
  let tmpl: { lines: string[]; memory: string };
  if (authority?.kind === "harem_administrator") {
    const office = authority.office;
    tmpl = db.world.administratorRankChangeReactions?.[office]?.[kind] ?? ADMIN_FALLBACK[office][kind];
  } else {
    tmpl = db.world.rankChangeReactions?.[kind] ?? SOVEREIGN_FALLBACK[kind];
  }
  const self = newRank.selfRefs.toPlayer[0]!;
  const subst = (s: string) =>
    s.replaceAll("{self}", self).replaceAll("{rank}", newRank.name).replaceAll("{title}", title ?? "");
  return { lines: tmpl.lines.map(subst), memory: subst(tmpl.memory) };
}
