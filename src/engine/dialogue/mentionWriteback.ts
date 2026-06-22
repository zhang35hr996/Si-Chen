/**
 * 记忆冷却写回（spec §数据流末步）
 * 仅对 kind === "memory" 的 sourceRef 写回 MemoryMentionRecord。
 * kind === "event" 和 kind === "fact" 的引用不写入 mentionLog。
 */
import type { GameTime } from "../calendar/time";
import type { GameState } from "../state/types";
import { appendMention } from "./mention";
import type { ProposedClaim } from "./claims";
import { contextRefKey } from "./types";

export function recordMentionedContext(
  state: GameState,
  acceptedClaims: readonly ProposedClaim[],
  mention: { speakerId: string; audienceId: string; now: GameTime },
  offeredRefKeys: ReadonlySet<string>,
): GameState {
  const ids = new Set<string>();
  for (const pc of acceptedClaims) {
    for (const ref of pc.sourceRefs) {
      // Only memory-kind refs are written back to the mentionLog
      if (ref.kind === "memory" && offeredRefKeys.has(contextRefKey(ref))) {
        ids.add(ref.id);
      }
    }
  }
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
