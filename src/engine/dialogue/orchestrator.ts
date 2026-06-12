/**
 * Dialogue orchestrator (thin in the skeleton): assembles the FULL request
 * context (even though the mock ignores most of it — the seam must carry
 * everything the real provider will need), calls the provider, validates and
 * normalizes the response into a DialogueLine.
 */
import { toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import { aiError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameState } from "../state/types";
import {
  rawDialogueResponseSchema,
  type DialogueLine,
  type DialogueProvider,
  type DialogueRequest,
} from "./types";

export function assembleDialogueRequest(
  db: ContentDB,
  state: GameState,
  speakerId: string,
  locationId: string,
  scripted?: { text: string; expression?: string },
): Result<DialogueRequest, GameError> {
  const character = db.characters[speakerId];
  if (!character) {
    return err(aiError("BAD_SPEAKER", `unknown speaker "${speakerId}"`));
  }
  const relationship = state.relationships[speakerId] ?? character.initialRelationship;
  const standing = state.standing[speakerId] ?? character.initialStanding;
  const rank = db.ranks[standing.rank];
  if (!rank) {
    return err(aiError("BAD_SPEAKER", `speaker "${speakerId}" holds unknown rank "${standing.rank}"`));
  }
  return ok({
    speakerId,
    targetId: "player",
    locationId,
    time: toGameTime(state.calendar),
    speakerContext: {
      profile: character.profile,
      voice: character.voice,
      relationship,
      standing: { ...standing, selfRefs: rank.selfRefs },
      relevantMemories: [], // retrieval is post-skeleton; the field rides along
      stances: character.stances ?? [],
    },
    etiquette: {
      allowedTerms: db.lexicon.approvedTerms,
      forbiddenTerms: db.lexicon.forbiddenTerms,
      addressRules: db.lexicon.rankAddressRules,
    },
    transcript: [], // transcripts are excluded from memory v0 (plan §7)
    ...(scripted !== undefined ? { scripted } : {}),
  });
}

/**
 * Provider call + validation gates (v0 subset; the text gates grow in PR 11):
 * schema-valid, speaker identity matches, expression normalized to the
 * character's list with neutral fallback.
 */
export async function produceDialogueLine(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
): Promise<Result<DialogueLine, GameError>> {
  const raw = await provider.generate(request);
  if (!raw.ok) return raw;

  const parsed = rawDialogueResponseSchema.safeParse(raw.value);
  if (!parsed.success) {
    return err(
      aiError("MALFORMED", `provider "${provider.id}" returned an invalid response`, {
        context: { issues: parsed.error.issues.slice(0, 3).map((i) => i.message) },
      }),
    );
  }
  const response = parsed.data;
  if (response.speaker !== request.speakerId) {
    return err(
      aiError("WRONG_SPEAKER", `asked for "${request.speakerId}", got "${response.speaker}"`),
    );
  }

  const character = db.characters[request.speakerId]!;
  const expression =
    response.expression !== undefined && character.expressions.includes(response.expression)
      ? response.expression
      : "neutral"; // loader guarantees neutral exists

  return ok({
    speakerId: request.speakerId,
    speakerName: character.profile.name,
    text: response.text,
    expression,
    choices: response.choices.map((choice) => ({
      id: choice.id,
      text: choice.text,
      ...(choice.tone !== undefined ? { tone: choice.tone } : {}),
    })),
    meta: { generated: provider.kind === "generative", degraded: false },
  });
}
