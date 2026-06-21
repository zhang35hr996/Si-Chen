/**
 * Dialogue orchestrator (thin in the skeleton): assembles the FULL request
 * context (even though the mock ignores most of it — the seam must carry
 * everything the real provider will need), calls the provider, validates and
 * normalizes the response into a DialogueLine.
 */
import { toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import { resolveDisplayName } from "../characters/standing";
import { aiError, type GameError } from "../infra/errors";
import type { RingBufferLogger } from "../infra/logger";
import { err, ok, type Result } from "../infra/result";
import type { GameState } from "../state/types";
import { buildTextGateContext, scanDialogueText, type GateFinding } from "./gates";
import { buildMemoryContext } from "./memoryContext";
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
  const standing = state.standing[speakerId] ?? character.initialStanding;
  if (!standing) {
    return err(aiError("BAD_SPEAKER", `speaker "${speakerId}" has no standing (elder — use elder dialogue path)`));
  }
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
      standing: { ...standing, selfRefs: rank.selfRefs },
      relevantMemories: buildMemoryContext(
        state,
        { speakerId },
        { now: toGameTime(state.calendar), topicTags: [], presentCharacterIds: [], audienceId: "player", speakerId, locationId },
      ).activatedMemories,
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
 * Provider call + validation gates. The seam runs identically for mock and
 * future LLM output (PR 11): schema-valid → speaker identity matches → TEXT
 * gates (forbidden lexicon, self-ref correctness, rank/title terms, template
 * leaks — engine/dialogue/gates) → expression normalized to neutral fallback.
 *
 * Gate boundary (plan §8): these are TEXT-only checks. Numeric/state validation
 * lives in engine/effects (PR 6). A "reject" gate finding fails the line; a
 * "flag" finding serves it with meta.degraded set. All findings are logged so
 * they surface in the debug panel's diagnostics.
 */
export async function produceDialogueLine(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  logger?: RingBufferLogger,
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

  // ── text gates (plan §8) ────────────────────────────────────────────
  const gateCtx = buildTextGateContext(db, request.speakerContext.standing.rank);
  const findings: GateFinding[] = [
    ...scanDialogueText(response.text, gateCtx),
    // Choices are the player's words, not the speaker's — content gates only.
    ...response.choices.flatMap((c) => scanDialogueText(c.text, gateCtx, { skipIdentityGates: true })),
  ];
  for (const finding of findings) {
    logger?.logGameError(
      aiError(`GATE_${finding.gate.toUpperCase()}`, finding.message, {
        severity: finding.severity === "reject" ? "error" : "warn",
        context: { provider: provider.id, speaker: request.speakerId, matched: finding.matched },
      }),
    );
  }
  const rejects = findings.filter((f) => f.severity === "reject");
  if (rejects.length > 0) {
    return err(
      aiError("GATE_REJECTED", `provider "${provider.id}" output failed ${rejects.length} text gate(s)`, {
        context: { findings: rejects.map((f) => ({ gate: f.gate, matched: f.matched })) },
      }),
    );
  }
  const degraded = findings.length > 0; // flag-only findings still serve, marked degraded

  const character = db.characters[request.speakerId]!;
  const expression =
    response.expression !== undefined && character.expressions.includes(response.expression)
      ? response.expression
      : "neutral"; // loader guarantees neutral exists

  return ok({
    speakerId: request.speakerId,
    speakerName: resolveDisplayName(
      character,
      request.speakerContext.standing,
      db.ranks[request.speakerContext.standing.rank],
    ),
    text: response.text,
    expression,
    choices: response.choices.map((choice) => ({
      id: choice.id,
      text: choice.text,
      ...(choice.tone !== undefined ? { tone: choice.tone } : {}),
    })),
    meta: { generated: provider.kind === "generative", degraded },
  });
}
