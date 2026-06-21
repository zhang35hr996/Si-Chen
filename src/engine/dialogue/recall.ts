/** 第一阶段候选召回（宽召回，不排序——精排在 PR4）。确定性、稳定排序。 */
import { listMemories } from "../memory/inspect";
import { canKnowEvent } from "../chronicle/awareness";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

export interface RecallQuery {
  speakerId: string;
  topicTags?: string[];
  presentCharacterIds?: string[];
  subjectIds?: string[];
}

function hits(tags: readonly string[], subjects: readonly string[], q: RecallQuery): boolean {
  const topic = q.topicTags?.length ? q.topicTags.some((t) => tags.includes(t)) : false;
  const subj = q.subjectIds?.length ? q.subjectIds.some((s) => subjects.includes(s)) : false;
  // presentCharacterIds → 命中「记忆/事件中以这些人为 subject」的条目（非「这些人在听」）
  const present = q.presentCharacterIds?.length ? q.presentCharacterIds.some((s) => subjects.includes(s)) : false;
  return topic || subj || present;
}

export function recallCandidates(
  state: GameState,
  query: RecallQuery,
  limit = 20,
): { memories: MemoryEntry[]; events: CourtEvent[] } {
  const anyFilter = !!(query.topicTags?.length || query.subjectIds?.length || query.presentCharacterIds?.length);

  const memories = [...listMemories(state, query.speakerId)]
    .filter((m) => !anyFilter || m.strength >= 70 || hits(m.triggerTags, m.subjectIds, query))
    .sort((x, y) => (y.strength - x.strength) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, limit);

  const events = state.chronicle
    .filter((e) => canKnowEvent(state, query.speakerId, e))
    .filter((e) => !anyFilter || hits(e.tags, e.participants.map((p) => p.charId), query))
    .sort((x, y) => (y.publicSalience - x.publicSalience) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, limit);

  return { memories, events };
}
