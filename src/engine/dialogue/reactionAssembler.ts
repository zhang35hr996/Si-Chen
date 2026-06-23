/**
 * reactionAssembler — Task 5: orchestrates the event→plan pipeline.
 *
 * buildReactionPlan:
 *   1. selectReactionEvent → pick the most eligible CourtEvent (or bail)
 *   2. eventToReactionContext → derive who the event is about
 *   3. deriveSubjectRelation  → speaker's relation to the event subject
 *      (uses state.standing[subjectId].affection as dynamic signal;
 *       authored stances are not available at this layer — use neutral baseline)
 *   4. DEFAULT_DISPOSITION — personality axes not available without ContentDB;
 *      callers that have personality traits should call planReaction directly
 *   5. planReaction → build the final ReactionPlan
 *   6. Return BuiltReaction { plan, sourceEventId }
 */
import type { CourtEvent, GameState } from "../state/types";
import type { CanonicalReactionTrait, RelationStance } from "../content/schemas";
import type { ReactionPlan } from "./reactionTypes";
import { eventToReactionContext } from "./eventReaction";
import { selectReactionEvent } from "./eventReaction";
import { deriveSubjectRelation } from "./subjectRelation";
import { DEFAULT_DISPOSITION, deriveDisposition } from "./disposition";
import { planReaction } from "./planReaction";
import type { AudienceContext, AudienceRole } from "./reactionTypes";

// ── BuiltReaction ─────────────────────────────────────────────────────────────

export interface BuiltReaction {
  plan: ReactionPlan;
  /** The id of the CourtEvent that triggered this reaction plan. */
  sourceEventId: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Classify the audience's role from GameState without requiring ContentDB.
 * Mirrors buildAudienceContext's classifyRole but uses only state data.
 */
function classifyAudienceRole(state: GameState, audienceId: string): AudienceRole {
  if (audienceId === "player") return "sovereign";
  if (state.standing[audienceId]) return "consort";
  if (state.resources.bloodline.heirs.some((h) => h.id === audienceId)) return "heir";
  return "servant";
}

// ── buildReactionPlan ─────────────────────────────────────────────────────────

/**
 * Assemble a BuiltReaction for the given speaker/audience pair.
 *
 * Returns undefined when:
 *   - sceneDirective is set (authored scenes suppress reaction flow)
 *   - no eligible event found in knownEventsAll
 *   - the selected event yields no EventReactionContext (should not happen in
 *     practice — selectReactionEvent already filters these out)
 *
 * Disposition: derived from the speaker's authored personalityTraits when
 * supplied (deriveDisposition); falls back to DEFAULT_DISPOSITION otherwise.
 *
 * SubjectRelation: derived from the speaker's authored stance toward the event
 * subject (PR-A item 5). The previous code read state.standing[subjectId].affection
 * — that is the subject's OWN affection toward the sovereign, NOT the speaker's
 * relation to the subject, so it is intentionally no longer consulted here.
 *
 * Audience: privacy and present-cast flow from the caller (PR-A item 3) rather
 * than being hardcoded to semi_private / [audienceId].
 */
export function buildReactionPlan(args: {
  speakerId: string;
  audienceId: string;
  knownEventsAll: readonly CourtEvent[];
  chronicle: readonly CourtEvent[];
  state: GameState;
  currentDayIndex: number;
  sceneDirective?: string;
  /** Speaker's canonical reaction traits → social disposition. */
  reactionTraits?: readonly CanonicalReactionTrait[];
  /** Speaker's authored stances (structured `stance`) → relation to the event subject. */
  stances?: readonly { charId: string; stance: RelationStance; attitude: string }[];
  /** Real scene cast; defaults to [audienceId]. */
  presentCharacterIds?: readonly string[];
  /** Real scene privacy; defaults to "semi_private". */
  privacy?: "public" | "semi_private" | "private";
}): BuiltReaction | undefined {
  const { speakerId, audienceId, knownEventsAll, chronicle, state, currentDayIndex, sceneDirective } = args;

  // 1. Find the most eligible CourtEvent (sceneDirective guard is inside selectReactionEvent)
  const event = selectReactionEvent({
    speakerId,
    audienceId,
    events: knownEventsAll,
    chronicle,
    state,
    currentDayIndex,
    sceneDirective,
  });

  if (event === undefined) return undefined;

  // 2. Derive who the event is about
  const reactionCtx = eventToReactionContext(event);
  if (reactionCtx === undefined) return undefined; // guard — should not happen after selectReactionEvent

  // 3. Derive SubjectRelation from the speaker's authored structured stance toward the subject.
  const subjectId = reactionCtx.subjectId;
  const authoredStance = args.stances?.find((s) => s.charId === subjectId)?.stance;
  const { relation } = deriveSubjectRelation({
    charId: subjectId,
    ...(authoredStance !== undefined ? { authoredStance } : {}),
  });

  // 4. Derive disposition from the speaker's canonical reaction traits (fallback to default).
  const disposition = args.reactionTraits && args.reactionTraits.length > 0
    ? deriveDisposition(args.reactionTraits)
    : DEFAULT_DISPOSITION;

  // 5. Build AudienceContext from the real scene (planReaction uses AudienceContext).
  const audience: AudienceContext = {
    targetRole: classifyAudienceRole(state, audienceId),
    privacy: args.privacy ?? "semi_private",
    presentCharacterIds: args.presentCharacterIds ? [...args.presentCharacterIds] : [audienceId],
  };

  // 6. Build the ReactionPlan
  const plan = planReaction({ relation, disposition, audience, event: reactionCtx });

  return { plan, sourceEventId: event.id };
}
