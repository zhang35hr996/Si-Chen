/**
 * 记忆冷却写回（spec §数据流末步）
 */
import type { GameTime } from "../calendar/time";
import type { GameState } from "../state/types";
import { appendMention } from "./mention";
import type { ProposedClaim } from "./claims";

export function recordMentionedContext(
  state: GameState,
  acceptedClaims: readonly ProposedClaim[],
  mention: { speakerId: string; audienceId: string; now: GameTime },
  offeredContextIds: ReadonlySet<string>,
): GameState {
  const ids = new Set<string>();
  for (const pc of acceptedClaims) {
    for (const sid of pc.sourceContextIds) {
      if (offeredContextIds.has(sid)) ids.add(sid);
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
