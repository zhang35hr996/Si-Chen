/**
 * Scene context for the free-chat (generative) converse() flow.
 *
 * Derived ONCE per conversation and passed unchanged into every
 * assembleDialogueRequest() call of that conversation (the opening turn and each
 * choice-driven continuation), so presence/privacy stay stable across the turn
 * sequence.
 *
 * Deliberately conservative (PR-A runtime wiring):
 *   - presentCharacterIds lists only ADDITIONAL confirmed-present bystanders. The
 *     speaker and the conversation target are always supplied by the orchestrator,
 *     so this returns [] — the UI cannot reliably establish anyone else as present,
 *     and does NOT enumerate every resident of the broader location.
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
 * Pure and state-free: presence carries no extra bystanders (the orchestrator adds
 * speaker + target itself), and privacy is fixed to the conservative non-private value.
 */
export function deriveConverseSceneContext(speakerId: string): ConverseSceneContext {
  void speakerId; // speaker presence is supplied by the orchestrator, not the caller
  return { presentCharacterIds: [], privacy: "semi_private" };
}
