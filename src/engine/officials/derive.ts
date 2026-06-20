import type { ContentDB } from "../content/loader";
import type { CharacterContent } from "../content/schemas";
import type { GameState, Official } from "../state/types";
import { powerOf } from "./power";

const ORDINAL = ["长", "次", "三", "四", "五", "六", "七", "八", "九", "十"];
function ordinalChar(n: number): string {
  return ORDINAL[n - 1] ?? `第${n}`;
}

export function maternalHead(state: GameState, consort: CharacterContent): Official | undefined {
  const surname = consort.profile.surname;
  if (!surname) return undefined;
  return Object.values(state.officials).find((o) => o.surname === surname);
}

export function familyText(db: ContentDB, state: GameState, consort: CharacterContent): string {
  const mc = consort.maternalClan;
  const head = maternalHead(state, consort);
  if (!mc || !head) return "平民之子";
  const post = db.officialPosts[head.postId];
  if (!post || post.gradeOrder === 0) return "平民之子";
  const xi = mc.legitimate ? "嫡" : "庶";
  return `${post.grade}${post.name}${xi}${ordinalChar(mc.birthOrder)}子`;
}

export function maternalPower(db: ContentDB, state: GameState, consort: CharacterContent): number {
  const head = maternalHead(state, consort);
  if (!head) return 0;
  const post = db.officialPosts[head.postId];
  return post ? powerOf(post, head.id) : 0;
}

export function maternalLoyalty(state: GameState, consort: CharacterContent): number {
  return maternalHead(state, consort)?.loyalty ?? 0;
}
