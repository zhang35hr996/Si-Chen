/**
 * Scene context for the free-chat (generative) converse() flow.
 *
 * Derived ONCE per conversation and passed unchanged into every
 * assembleDialogueRequest() call of that conversation (the opening turn and each
 * choice-driven continuation), so presence/privacy stay stable across the turn
 * sequence.
 *
 * Deliberately conservative (PR-A runtime wiring):
 *   - presentCharacterIds contains ONLY the active speaker — the one character the
 *     UI can reliably establish as physically present. It does NOT enumerate every
 *     resident of the broader location (co-residents are not guaranteed present).
 *   - privacy is the contract's non-private value "semi_private". converse() is
 *     reachable from shared-location visits as well as private summons, so the flow
 *     does not guarantee a one-on-one scene; we do not infer privacy from the
 *     location name.
 *   - topicTags are intentionally omitted — authored / free-chat topic derivation
 *     is a PR-B follow-up.
 */

/** Present/privacy context for one converse() session. */
export interface ConverseSceneContext {
  presentCharacterIds: string[];
  privacy: "public" | "semi_private" | "private";
}

/**
 * Build the scene context for a conversation with `speakerId`.
 * Pure and state-free: presence is limited to the speaker by design, and privacy
 * is fixed to the conservative non-private value.
 */
export function deriveConverseSceneContext(speakerId: string): ConverseSceneContext {
  return { presentCharacterIds: [speakerId], privacy: "semi_private" };
}
