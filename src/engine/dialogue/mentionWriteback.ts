/**
 * 记忆冷却写回（spec §数据流末步）
 * 仅对 kind === "memory" 的引用写回 MemoryMentionRecord。
 * kind === "event" 和 kind === "fact" 的引用不写入 mentionLog。
 *
 * 提及来源有两路（PR-A item 6）：
 *   1. acceptedClaims.sourceRefs —— 作为事实 claim 证据被引用的记忆；
 *   2. mentionedContextRefs      —— 模型本轮实际提及但未必产生事实 claim 的记忆
 *      （创伤/恩怨/承诺等情绪叙事），冷却不再绑定 claim。
 * 两路取并集去重；均需在 offeredRefKeys 内（防御越权引用）。
 */
import type { GameTime } from "../calendar/time";
import type { GameState } from "../state/types";
import { appendMention } from "./mention";
import type { ProposedClaim, ContextRef } from "./claims";
import { contextRefKey } from "./types";

export function recordMentionedContext(
  state: GameState,
  acceptedClaims: readonly ProposedClaim[],
  mention: { speakerId: string; audienceId: string; now: GameTime },
  offeredRefKeys: ReadonlySet<string>,
  mentionedContextRefs: readonly ContextRef[] = [],
): GameState {
  const ids = new Set<string>();
  const addRef = (ref: ContextRef): void => {
    // Only memory-kind refs that were actually offered cool down.
    if (ref.kind === "memory" && offeredRefKeys.has(contextRefKey(ref))) {
      ids.add(ref.id);
    }
  };
  for (const pc of acceptedClaims) {
    for (const ref of pc.sourceRefs) addRef(ref);
  }
  for (const ref of mentionedContextRefs) addRef(ref);
  let next = state;
  for (const memoryId of [...ids].sort()) {
    next = appendMention(next, {
      speakerId: mention.speakerId,
      audienceId: mention.audienceId,
      memoryId,
      mentionedAt: mention.now,
    });
  }
  return next;
}
