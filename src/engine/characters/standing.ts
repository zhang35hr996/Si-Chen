/**
 * Display 称呼 + precedence for consorts (rank/title system). 称呼 recomposes
 * from the CURRENT rank, so a promotion/封号 changes it everywhere automatically.
 */
import type { CharacterContent, CharacterRank } from "../content/schemas";
import type { CharacterStanding } from "../state/types";

/** A 封号 nudges a consort just above untitled same-rank peers (< adjacent-rank gap). */
export const TITLE_BOOST = 1;

export function resolveDisplayName(
  character: CharacterContent,
  standing: CharacterStanding | undefined,
  rank: CharacterRank | undefined,
): string {
  if (character.kind === "consort" && character.profile.surname && rank) {
    return (standing?.title ?? character.profile.surname) + rank.name;
  }
  return character.profile.name;
}

/**
 * 界面标识用「本名·位分」并列（如「徐清欢·君」「陆怀瑾·承徽」）。仅供 UI 卡片/列表/
 * 标题等标识场景；对话台词与旁白仍走 resolveDisplayName（守礼制的姓+位分/封号+位分）。
 */
export function resolveIdentityLabel(
  character: CharacterContent,
  standing: CharacterStanding | undefined,
  rank: CharacterRank | undefined,
): string {
  if (character.kind === "consort" && rank) {
    const tier = standing?.title ? standing.title + rank.name : rank.name;
    return `${character.profile.name}·${tier}`;
  }
  return character.profile.name;
}

export function effectiveOrder(rank: CharacterRank, hasTitle: boolean): number {
  return rank.order + (hasTitle ? TITLE_BOOST : 0);
}

/** 侍君对帝王的主自称（封号/姓氏无关），无位分时退化为「臣」。 */
export function renderSelfRef(rank: CharacterRank | undefined): string {
  return rank?.selfRefs.toPlayer[0] ?? "臣";
}
