/**
 * 侍君「家世」派生（侍君卡用）。改由正式母族关联（standing.birthFamilyId）解析，
 * 不再靠姓名匹配官员（spec §5：禁止按姓名临时推断亲缘）。嫡庶/排行仍取 authored
 * maternalClan（叙事元数据），官职/品级取母族当家官员。
 */
import type { ContentDB } from "../content/loader";
import type { CharacterContent } from "../content/schemas";
import type { GameState, Official } from "../state/types";
import { getOfficialsByFamilyId } from "./selectors";
import { powerOf } from "./power";

const ORDINAL = ["长", "次", "三", "四", "五", "六", "七", "八", "九", "十"];
function ordinalChar(n: number): string {
  return ORDINAL[n - 1] ?? `第${n}`;
}

/** 侍君母族的当家官员（family 头官 official_<famId>，回退该族首位官员）。无母族则 undefined。 */
export function maternalHead(state: GameState, consort: CharacterContent): Official | undefined {
  const familyId = state.standing[consort.id]?.birthFamilyId;
  if (!familyId) return undefined;
  return state.officials[`official_${familyId}`] ?? getOfficialsByFamilyId(state, familyId)[0];
}

export function familyText(db: ContentDB, state: GameState, consort: CharacterContent): string {
  const mc = consort.maternalClan;
  const head = maternalHead(state, consort);
  if (!mc || !head || head.postId == null) return "平民之子";
  const post = db.officialPosts[head.postId];
  if (!post || post.gradeOrder === 0) return "平民之子";
  const xi = mc.legitimate ? "嫡" : "庶";
  return `${post.grade}${post.name}${xi}${ordinalChar(mc.birthOrder)}子`;
}

export function maternalPower(db: ContentDB, state: GameState, consort: CharacterContent): number {
  const head = maternalHead(state, consort);
  if (!head || head.postId == null) return 0;
  const post = db.officialPosts[head.postId];
  return post ? powerOf(post, head.id) : 0;
}

export function maternalLoyalty(state: GameState, consort: CharacterContent): number {
  return maternalHead(state, consort)?.loyalty ?? 0;
}
