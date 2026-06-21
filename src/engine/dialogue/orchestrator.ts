/**
 * Dialogue orchestrator (thin in the skeleton): assembles the FULL request
 * context (even though the mock ignores most of it — the seam must carry
 * everything the real provider will need), calls the provider, validates and
 * normalizes the response into a DialogueLine.
 */
import { toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import { resolveDisplayName } from "../characters/standing";
import { GroundTruthBeliefProjection } from "../chronicle/belief";
import { aiError, type GameError } from "../infra/errors";
import type { RingBufferLogger } from "../infra/logger";
import { err, ok, type Result } from "../infra/result";
import type { GameState } from "../state/types";
import { buildAudienceContext } from "./audience";
import { validateDialogueClaims } from "./claimGate";
import { buildTextGateContext, scanDialogueText, type GateFinding } from "./gates";
import { buildMemoryContext } from "./memoryContext";
import { recordMentionedContext } from "./mentionWriteback";
import {
  rawDialogueResponseSchema,
  type DialogueLine,
  type DialogueProvider,
  type DialoguePolicyContext,
  type DialogueRequest,
  type RawDialogueResponse,
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
        // audienceId 与 targetId 字段须保持一致（此处 targetId 硬编码为 "player"，audienceId 同步）。
        // 若将来 assembleDialogueRequest 接收动态 targetId 参数，须同步更新此处。
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
 * Internal helper: speaker check + text gates + expression normalize + line build.
 * Called by both produceDialogueLine and produceDialogueLineWithPolicy after the
 * schema parse (and, in the WithPolicy path, after the claim gate).
 */
function finalizeLine(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  response: RawDialogueResponse,
  logger?: RingBufferLogger,
): Result<DialogueLine, GameError> {
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

  return finalizeLine(db, provider, request, parsed.data, logger);
}

/**
 * Build a DialoguePolicyContext from the ALREADY-ASSEMBLED DialogueRequest.
 *
 * Single-source invariant (plan §gate boundary): `offeredContextIds` is derived
 * directly from `request.speakerContext.relevantMemories` — the exact memories
 * handed to the provider — never from an independent buildMemoryContext call.
 * Re-computing would let the gate's notion of "what was offered" drift from what
 * the provider actually received (e.g. once targetId becomes dynamic), causing a
 * legitimate source to be flagged unknown_source_context, or — worse — a source
 * the provider never saw to be silently accepted. `now` likewise reuses
 * `request.time` so time has one source too.
 *
 * The speaker was already validated when the request was assembled, so this
 * cannot fail and returns the context directly (no Result wrapper).
 */
export function buildDialoguePolicyContext(
  db: ContentDB,
  state: GameState,
  request: DialogueRequest,
): DialoguePolicyContext {
  const { speakerId, targetId, time: now } = request;
  // knownEvents are intentionally NOT part of offeredContextIds: they are built
  // in memoryContext but never placed on DialogueRequest yet, so the provider
  // never receives them — the gate must not bless a source it wasn't sent.
  const offeredContextIds = new Set<string>(
    request.speakerContext.relevantMemories.map((m) => m.id),
  );
  const audience = buildAudienceContext(state, db, { speakerId, targetId });
  const beliefProjection = new GroundTruthBeliefProjection(state);

  return { audience, beliefProjection, offeredContextIds, now };
}

/**
 * Full policy-aware pipeline: schema parse → claim gate → finalizeLine → memory write-back.
 * Returns both the rendered line and the updated GameState (mentionLog updated).
 */
export async function produceDialogueLineWithPolicy(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  policy: DialoguePolicyContext,
  state: GameState,
  logger?: RingBufferLogger,
): Promise<Result<{ line: DialogueLine; nextState: GameState }, GameError>> {
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

  // ── claim gate ────────────────────────────────────────────────────
  const claimResult = validateDialogueClaims({
    speakerId: request.speakerId,
    audience: policy.audience,
    beliefs: policy.beliefProjection,
    offeredContextIds: policy.offeredContextIds,
    proposedClaims: response.proposedClaims,
  });
  for (const f of claimResult.findings) {
    logger?.logGameError(
      aiError("CLAIM_VIOLATION", f.message, {
        severity: "warn",
        context: { code: f.code, claimId: f.claimId, provider: provider.id },
      }),
    );
  }
  if (!claimResult.ok) {
    return err(
      aiError("CLAIM_REJECTED", `provider "${provider.id}" claim gate failed`, {
        context: { findings: claimResult.findings.map((f) => ({ code: f.code, claimId: f.claimId })) },
      }),
    );
  }

  // ── speaker check + text gates + line build ───────────────────────
  const lineResult = finalizeLine(db, provider, request, response, logger);
  if (!lineResult.ok) return lineResult;

  // ── memory write-back ─────────────────────────────────────────────
  const nextState = recordMentionedContext(
    state,
    claimResult.acceptedClaims,
    { speakerId: request.speakerId, audienceId: request.targetId, now: policy.now },
    policy.offeredContextIds,
  );

  return ok({ line: lineResult.value, nextState });
}
