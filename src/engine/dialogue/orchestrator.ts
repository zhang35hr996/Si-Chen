/**
 * Dialogue orchestrator (thin in the skeleton): assembles the FULL request
 * context (even though the mock ignores most of it — the seam must carry
 * everything the real provider will need), calls the provider, validates and
 * normalizes the response into a DialogueLine.
 */
import { toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { CharacterRank } from "../content/schemas";
import { resolveDisplayName } from "../characters/standing";
import { GroundTruthBeliefProjection } from "../chronicle/belief";
import { aiError, type GameError } from "../infra/errors";
import type { RingBufferLogger } from "../infra/logger";
import { err, ok, type Result } from "../infra/result";
import type { CharacterStanding, GameState } from "../state/types";
import { buildAudienceContext } from "./audience";
import { validateDialogueClaims } from "./claimGate";
import { buildTextGateContext, scanDialogueText, type GateFinding } from "./gates";
import { buildMemoryContext } from "./memoryContext";
import { recordMentionedContext } from "./mentionWriteback";
import type { DialogueProviderResult } from "./providerContract";
import { mapProviderErrorToGameError } from "./providerError";
import {
  toPromptMemory,
  type DialogueSpeakerStanding,
  type DialoguePromptContext,
} from "./promptPayload";
import {
  type DialogueAssemblyOptions,
  type DialogueLine,
  type DialogueProvider,
  type DialoguePolicyContext,
  type DialogueRequest,
  type DialogueValidationDiagnostics,
  type DialogueValidationOutcome,
} from "./types";

/** 尊长（elder）合成 standing 的占位位分 id；故意不入 db.ranks，下游按无位分降级。 */
const ELDER_STANDING_RANK = "__elder__";
/** content 未给 elder.selfRefs 时的兜底自称（尊长原型即太后，自称『哀家』）。 */
const DEFAULT_ELDER_SELF_REFS: CharacterRank["selfRefs"] = { toPlayer: ["哀家"], formal: ["哀家"] };

export function assembleDialogueRequest(
  db: ContentDB,
  state: GameState,
  speakerId: string,
  locationId: string,
  options: DialogueAssemblyOptions = {},
): Result<DialogueRequest, GameError> {
  const targetId = options.targetId ?? "player";
  const character = db.characters[speakerId];
  if (!character) {
    return err(aiError("BAD_SPEAKER", `unknown speaker "${speakerId}"`));
  }
  const standing = state.standing[speakerId] ?? character.initialStanding;
  // 位分角色用 rank.selfRefs；尊长（elder）走「尊长对话路径」：无位分，
  // 自称取 character.selfRefs，并合成占位 standing 使其台词可经统一 orchestrator 渲染。
  let contextStanding: CharacterStanding & { selfRefs: CharacterRank["selfRefs"] };
  let rankDisplay: DialogueSpeakerStanding;
  let rank: CharacterRank | undefined;
  if (standing) {
    rank = db.ranks[standing.rank];
    if (!rank) {
      return err(aiError("BAD_SPEAKER", `speaker "${speakerId}" holds unknown rank "${standing.rank}"`));
    }
    contextStanding = { ...standing, selfRefs: rank.selfRefs };
    rankDisplay = { kind: "ranked", id: standing.rank, name: rank.name, grade: rank.grade, selfRefs: rank.selfRefs };
  } else if (character.kind === "elder") {
    contextStanding = {
      rank: ELDER_STANDING_RANK,
      favor: 0,
      selfRefs: character.selfRefs ?? DEFAULT_ELDER_SELF_REFS,
    };
    rankDisplay = { kind: "unranked", role: character.profile.role, selfRefs: contextStanding.selfRefs };
  } else {
    return err(aiError("BAD_SPEAKER", `speaker "${speakerId}" has no standing`));
  }
  const memCtx = buildMemoryContext(
    state,
    { speakerId },
    // audienceId, targetId, speakerId all use the resolved targetId — single source.
    { now: toGameTime(state.calendar), topicTags: [], presentCharacterIds: [], audienceId: targetId, speakerId, locationId },
  );
  const audience = buildAudienceContext(state, db, { speakerId, targetId });
  const promptContext: DialoguePromptContext = {
    speakerDisplayName: resolveDisplayName(character, contextStanding, rank),
    rankDisplay,
    audience,
    relevantMemories: memCtx.activatedMemories.map(toPromptMemory),
    reactionPlan: undefined,
    knownEvents: [],
    allowedClaims: [],
    forbiddenClaims: [],
    choiceCandidates: [],
  };
  const { scripted, sceneDirective, transcript } = options;
  return ok({
    speakerId,
    targetId,
    locationId,
    time: toGameTime(state.calendar),
    speakerContext: {
      profile: character.profile,
      voice: character.voice,
      standing: contextStanding,
      relevantMemories: memCtx.activatedMemories,
      stances: character.stances ?? [],
    },
    etiquette: {
      allowedTerms: db.lexicon.approvedTerms,
      forbiddenTerms: db.lexicon.forbiddenTerms,
      addressRules: db.lexicon.rankAddressRules,
    },
    sceneDirective,
    transcript: transcript ?? [],
    ...(scripted !== undefined ? { scripted } : {}),
    promptContext,
  });
}

/**
 * Internal helper: speaker check + text gates + expression normalize + line build.
 * Called by both produceDialogueLine and produceDialogueLineWithPolicy after the
 * provider call (and, in the WithPolicy path, after the claim gate).
 */
function finalizeLine(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  response: DialogueProviderResult,
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
 * future LLM output: provider returns an already-parsed DialogueProviderResult →
 * speaker identity matches → TEXT gates (forbidden lexicon, self-ref correctness,
 * rank/title terms, template leaks — engine/dialogue/gates) → expression
 * normalized to neutral fallback.
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
  if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));

  return finalizeLine(db, provider, request, raw.value, logger);
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
  void db; // intentionally unused: callers keep passing db; internally not needed
  const { time: now } = request;
  // knownEvents are intentionally NOT part of offeredContextIds: they are built
  // in memoryContext but never placed on DialogueRequest yet, so the provider
  // never receives them — the gate must not bless a source it wasn't sent.
  const offeredContextIds = new Set<string>(
    request.speakerContext.relevantMemories.map((m) => m.id),
  );
  // Single-source invariant: audience comes from request.promptContext.audience,
  // not from an independent buildAudienceContext call. This guarantees the gate
  // sees exactly the same audience context the LLM was given.
  const audience = request.promptContext.audience;
  const beliefProjection = new GroundTruthBeliefProjection(state);

  return { audience, beliefProjection, offeredContextIds, now };
}

/**
 * Shared validation pipeline (T3, LLM-2).
 *
 * Validation order (intentional):
 *   1. Speaker check   → WRONG_SPEAKER  (identity must match before anything else)
 *   2. Claim gate      → CLAIM_REJECTED (semantic / belief / etiquette)
 *   3. Text gate       → GATE_REJECTED  (forbidden lexicon, self-ref, template leaks)
 *
 * Always returns `diagnostics` — even on ok=false the caller (eval runner, T4)
 * gets whatever was gathered before the first failure.
 *
 * Exported so the T4 eval runner can call it directly without re-invoking a
 * provider (it receives an already-parsed DialogueProviderResult from fixtures).
 */
export function validateDialogueProviderResult(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  policy: DialoguePolicyContext,
  response: DialogueProviderResult,
  logger?: RingBufferLogger,
): DialogueValidationOutcome {
  const diagnostics: DialogueValidationDiagnostics = {
    claimFindings: [],
    textFindings: [],
    acceptedClaims: [],
  };

  // ── 1. Speaker check ──────────────────────────────────────────────
  if (response.speaker !== request.speakerId) {
    return {
      ok: false,
      error: aiError("WRONG_SPEAKER", `asked for "${request.speakerId}", got "${response.speaker}"`),
      diagnostics,
    };
  }

  // ── 2. Claim gate ─────────────────────────────────────────────────
  const claimResult = validateDialogueClaims({
    speakerId: request.speakerId,
    audience: policy.audience,
    beliefs: policy.beliefProjection,
    offeredContextIds: policy.offeredContextIds,
    proposedClaims: response.proposedClaims,
  });
  diagnostics.claimFindings = claimResult.findings;
  diagnostics.acceptedClaims = claimResult.acceptedClaims;
  for (const f of claimResult.findings) {
    logger?.logGameError(
      aiError("CLAIM_VIOLATION", f.message, {
        severity: "warn",
        context: { code: f.code, claimId: f.claimId, provider: provider.id },
      }),
    );
  }
  if (!claimResult.ok) {
    return {
      ok: false,
      error: aiError("CLAIM_REJECTED", `provider "${provider.id}" claim gate failed`, {
        context: { findings: claimResult.findings.map((f) => ({ code: f.code, claimId: f.claimId })) },
      }),
      diagnostics,
    };
  }

  // ── 3. Text gate + expression normalize + line build ─────────────
  const gateCtx = buildTextGateContext(db, request.speakerContext.standing.rank);
  const findings: GateFinding[] = [
    ...scanDialogueText(response.text, gateCtx),
    ...response.choices.flatMap((c) => scanDialogueText(c.text, gateCtx, { skipIdentityGates: true })),
  ];
  diagnostics.textFindings = findings;
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
    return {
      ok: false,
      error: aiError("GATE_REJECTED", `provider "${provider.id}" output failed ${rejects.length} text gate(s)`, {
        context: { findings: rejects.map((f) => ({ gate: f.gate, matched: f.matched })) },
      }),
      diagnostics,
    };
  }
  const degraded = findings.length > 0;

  const character = db.characters[request.speakerId]!;
  const expression =
    response.expression !== undefined && character.expressions.includes(response.expression)
      ? response.expression
      : "neutral";

  const line: DialogueLine = {
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
  };

  return { ok: true, line, diagnostics };
}

/**
 * Full policy-aware pipeline: provider call → validateDialogueProviderResult → memory write-back.
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
  if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));

  const outcome = validateDialogueProviderResult(db, provider, request, policy, raw.value, logger);
  if (!outcome.ok) return err(outcome.error);

  // ── memory write-back ─────────────────────────────────────────────
  const nextState = recordMentionedContext(
    state,
    outcome.diagnostics.acceptedClaims,
    { speakerId: request.speakerId, audienceId: request.targetId, now: policy.now },
    policy.offeredContextIds,
  );

  return ok({ line: outcome.line, nextState });
}
