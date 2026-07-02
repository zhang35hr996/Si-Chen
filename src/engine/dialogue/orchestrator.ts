/**
 * Dialogue orchestrator (thin in the skeleton): assembles the FULL request
 * context (even though the mock ignores most of it — the seam must carry
 * everything the real provider will need), calls the provider, validates and
 * normalizes the response into a DialogueLine.
 */
import { toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { CharacterContent, CharacterRank } from "../content/schemas";
import { resolveDisplayName } from "../characters/standing";
import { resolveConsortRuntimeAttrs } from "../characters/consortAttrs";
import { GroundTruthBeliefProjection } from "../chronicle/belief";
import { aiError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { CharacterStanding, EventReactionRecord, GameState } from "../state/types";
import { buildAudienceContext } from "./audience";
import { assembleClaims } from "./claimAssembler";
import { validateDialogueClaims } from "./claimGate";
import { buildTextGateContext, scanDialogueText, type GateFinding } from "./gates";
import {
  buildDialogueKnowledgeQuery,
  extractProvenance,
  getLatestTargetUtterance,
  packPromptKnowledge,
  resolveVisibilityCeiling,
} from "./knowledge/index";
import { classifyQueryIntent } from "../knowledge/intent";
import { buildMemoryContext, selectPromptEventsByActivation } from "./memoryContext";
import { recordMentionedContext } from "./mentionWriteback";
import type { DialogueProviderResult } from "./providerContract";
import { mapProviderErrorToGameError } from "./providerError";
import {
  toPromptEvent,
  toPromptMemory,
  type DialogueSpeakerStanding,
  type DialoguePromptContext,
} from "./promptPayload";
import { buildReactionPlan } from "./reactionAssembler";
import { resolveAddress } from "./addressResolver";
import {
  contextRefKey,
  type DialogueAssemblyOptions,
  type DialogueLine,
  type DialogueProvider,
  type DialoguePolicyContext,
  type DialogueRequest,
  type DialogueTurnOptions,
  type DialogueValidationDiagnostics,
  type DialogueValidationOutcome,
  type KnowledgeRetrievalStatus,
  type ProvenanceFinding,
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
  // 动态生成的侍君（殿选）存在于 state.generatedConsorts，而非 db.characters
  const character = db.characters[speakerId] ?? state.generatedConsorts?.[speakerId];
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
      peakFavor: 0,
      selfRefs: character.selfRefs ?? DEFAULT_ELDER_SELF_REFS,
    };
    rankDisplay = { kind: "unranked", role: character.profile.role, selfRefs: contextStanding.selfRefs };
  } else {
    return err(aiError("BAD_SPEAKER", `speaker "${speakerId}" has no standing`));
  }
  const now = toGameTime(state.calendar);
  // Real scene context (PR-A items 1+2): topic / subject / present / privacy flow
  // from the caller into recall, activation, audience, and the compiled prompt.
  const topicTags = options.topicTags ?? [];
  // The conversation target is always physically present, so memories/events ABOUT
  // the target surface in recall/activation even when the caller supplies no extra
  // cast. `options.presentCharacterIds` are additional confirmed-present bystanders.
  // The speaker is filtered out defensively (even if a caller passes it): they are
  // trivially always present, so a "present-bystander" bonus on events/memories about
  // themselves would be meaningless, and audience already drops them.
  const scenePresentIds = [...new Set([targetId, ...(options.presentCharacterIds ?? [])])].filter((id) => id !== speakerId);
  // Beat subjects = who the beat is explicitly ABOUT. They drive BOTH recall and
  // activation (a memory/event about them surfaces even if that person is absent).
  // The speaker is NOT a beat subject (self-memories stay recallable via recallSubjectIds
  // but must not get an automatic activation bonus).
  const beatSubjectIds = options.subjectIds ?? [];
  // Recall net also includes the speaker so self-memories remain reachable.
  const recallSubjectIds = [...new Set([speakerId, ...beatSubjectIds])];
  const memCtx = buildMemoryContext(
    state,
    { speakerId, subjectIds: recallSubjectIds, topicTags, presentCharacterIds: scenePresentIds },
    { now, topicTags, subjectIds: beatSubjectIds, presentCharacterIds: scenePresentIds, audienceId: targetId, speakerId, locationId },
  );
  const audience = buildAudienceContext(state, db, {
    speakerId,
    targetId,
    ...(options.presentCharacterIds !== undefined ? { presentCharacterIds: options.presentCharacterIds } : {}),
    ...(options.privacy !== undefined ? { privacy: options.privacy } : {}),
  });

  // §5 assembly order: reaction → promptEvents → claims → promptContext

  // 1. Build reaction plan (suppressed by sceneDirective inside buildReactionPlan)
  const builtReaction = buildReactionPlan({
    speakerId,
    audienceId: targetId,
    knownEventsAll: memCtx.knownEventsAll,
    chronicle: state.chronicle,
    state,
    currentDayIndex: now.dayIndex,
    sceneDirective: options.sceneDirective,
    // Real disposition / relation / audience (PR-A items 3+4+5) — canonical machine fields
    reactionTraits: character.profile.reactionTraits,
    stances: character.stances ?? [],
    presentCharacterIds: scenePresentIds,
    privacy: options.privacy ?? "semi_private",
  });

  // 2. Select prompt events BEFORE assembleClaims, ranked by unified activation
  // (decayed salience × relevance + present − recent reaction); the reaction
  // source event is always pinned first (PR-A item 9).
  const promptEvents = selectPromptEventsByActivation({
    state,
    events: memCtx.knownEventsAll,
    ctx: { now, topicTags, subjectIds: beatSubjectIds, presentCharacterIds: scenePresentIds, audienceId: targetId, speakerId, locationId },
    pinnedEventId: builtReaction?.sourceEventId,
    limit: 3,
  });

  // 3. assembleClaims receives offeredEvents = promptEvents (NOT knownEventsAll)
  const assembled = assembleClaims({
    speakerId,
    builtReaction,
    offeredMemories: memCtx.activatedMemories,
    offeredEvents: promptEvents,
    beliefs: new GroundTruthBeliefProjection(state),
    state,
    audience,
    // Resolve from the same character source as everything else (db.characters OR
    // state.generatedConsorts) so forbidden claims apply to generated consorts too.
    forbiddenClaims: character.dialoguePolicy?.forbiddenClaims,
  });

  const behavioralState = character.kind === "consort"
    ? resolveConsortRuntimeAttrs(db, state, speakerId)
    : undefined;

  const promptContext: DialoguePromptContext = {
    speakerDisplayName: resolveDisplayName(character, contextStanding, rank),
    rankDisplay,
    audience,
    relevantMemories: memCtx.activatedMemories.map(toPromptMemory),
    reactionPlan: builtReaction?.plan,
    reactionSourceEventId: builtReaction?.sourceEventId,
    knownEvents: promptEvents.map((e) => toPromptEvent(e, db, state)),
    allowedClaims: assembled.allowed,
    forbiddenClaims: assembled.forbidden,
    choiceCandidates: [],
    ...(behavioralState !== undefined ? { behavioralState } : {}),
  };
  const { scripted, sceneDirective, transcript } = options;
  const resolvedAddress = resolveAddress(db, state, speakerId, targetId, {
    register: options.register ?? "public",
    addressPermissions: character.dialoguePolicy?.addressPermissions ?? [],
  });
  const liftedSet = new Set(resolvedAddress.liftedForbiddenTerms);
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
      forbiddenTerms: liftedSet.size > 0
        ? db.lexicon.forbiddenTerms.filter((t) => !liftedSet.has(t))
        : db.lexicon.forbiddenTerms,
      addressRules: db.lexicon.rankAddressRules,
    },
    resolvedAddress,
    register: options.register ?? "public",
    sceneDirective,
    transcript: transcript ?? [],
    topicTags,
    ...(scripted !== undefined ? { scripted } : {}),
    promptContext,
  });
}

/**
 * 统一角色解析：先查静态 db.characters，再回退到 state.generatedConsorts（殿选侍君）。
 * 两处都查不到时返回 undefined；assembleDialogueRequest 已在 request 构建时验证过，
 * 所以 finalizeLine / validateDialogueProviderResult 中可安全断言非空。
 */
function resolveDialogueChar(
  db: ContentDB,
  speakerId: string,
  generatedConsorts?: Record<string, CharacterContent>,
): CharacterContent | undefined {
  return db.characters[speakerId] ?? generatedConsorts?.[speakerId];
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
  logger?: import("../infra/logger").RingBufferLogger,
  generatedConsorts?: Record<string, CharacterContent>,
): Result<DialogueLine, GameError> {
  if (response.speaker !== request.speakerId) {
    return err(
      aiError("WRONG_SPEAKER", `asked for "${request.speakerId}", got "${response.speaker}"`),
    );
  }

  // ── text gates (plan §8) ────────────────────────────────────────────
  const speakerRankId = request.speakerContext.standing.rank;
  // NPC gate: lifted terms from resolver (speaker × target × register).
  const npcGateCtx = buildTextGateContext(db, speakerRankId, request.register);
  npcGateCtx.privateAllowedTerms = request.resolvedAddress?.liftedForbiddenTerms ?? [];
  npcGateCtx.contextForbiddenRefs = request.resolvedAddress?.forbiddenInContext ?? [];
  // Choice gate: no privateAllowedTerms — NPC address permissions must NOT
  // bleed into player-authored choice text.
  const choiceGateCtx = buildTextGateContext(db, speakerRankId, request.register);
  choiceGateCtx.contextForbiddenRefs = request.resolvedAddress?.forbiddenInContext ?? [];
  const findings: GateFinding[] = [
    ...scanDialogueText(response.text, npcGateCtx),
    // Choices are the player's words, not the speaker's — content gates only.
    ...response.choices.flatMap((c) => scanDialogueText(c.text, choiceGateCtx, { skipIdentityGates: true })),
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

  // assembleDialogueRequest 已验证 speakerId 存在（静态或动态侍君），此处可安全断言非空。
  const character = resolveDialogueChar(db, request.speakerId, generatedConsorts)!;
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
 * lives in engine/effects. A "reject" gate finding fails the line; a
 * "flag" finding serves it with meta.degraded set. All findings are logged so
 * they surface in the debug panel's diagnostics.
 *
 * @internal Use `produceDialogueTurn` instead.
 */
async function produceDialogueLine(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  logger?: import("../infra/logger").RingBufferLogger,
  generatedConsorts?: Record<string, CharacterContent>,
): Promise<Result<DialogueLine, GameError>> {
  const raw = await provider.generate(request);
  if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));

  return finalizeLine(db, provider, request, raw.value, logger, generatedConsorts);
}

/**
 * Build a DialoguePolicyContext from the ALREADY-ASSEMBLED DialogueRequest.
 *
 * Single-source invariant (plan §gate boundary): `offeredRefKeys` is derived
 * from `request.promptContext.relevantMemories` — the exact memories that appear
 * in the LLM prompt payload — never from `speakerContext.relevantMemories` (which
 * may diverge if prompt assembly adds filtering, truncation, or redaction). Using
 * the prompt-side array ensures the gate and the model agree on what was actually
 * offered. `now` likewise reuses `request.time` so time has one source too.
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
  const { allowedClaims, forbiddenClaims } = request.promptContext;

  // offeredRefKeys: contextRefKey-format keys for every context item actually sent to the LLM.
  // Only memories, events, and knowledge chunks in the prompt window are considered "offered".
  // allowedClaims.sourceRefs are NOT added (they are authorization constraints, not offered content).
  // Single-source invariant: derived solely from what was placed on the request.
  const offeredRefKeys = new Set<string>([
    ...request.promptContext.relevantMemories.map((m) => contextRefKey({ kind: "memory", id: m.id })),
    ...request.promptContext.knownEvents.map((e) => contextRefKey({ kind: "event", id: e.id })),
    ...(request.promptContext.knowledgeContext ?? []).map((c) => contextRefKey({ kind: "knowledge", id: c.id })),
  ]);

  // Single-source invariant: audience comes from request.promptContext.audience,
  // not from an independent buildAudienceContext call.
  const audience = request.promptContext.audience;
  const beliefProjection = new GroundTruthBeliefProjection(state);

  return { audience, beliefProjection, offeredRefKeys, now, allowedClaims, forbiddenClaims };
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
  logger?: import("../infra/logger").RingBufferLogger,
  generatedConsorts?: Record<string, CharacterContent>,
): DialogueValidationOutcome {
  const diagnostics: DialogueValidationDiagnostics = {
    claimFindings: [],
    textFindings: [],
    acceptedClaims: [],
    provenanceFindings: [],
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
  // Always pass allowedClaims — even [] means CLOSED (no factual claims permitted).
  // Only a missing/undefined allowedClaims falls back to open mode (legacy callers).
  const claimResult = validateDialogueClaims({
    speakerId: request.speakerId,
    audience: policy.audience,
    beliefs: policy.beliefProjection,
    offeredRefKeys: policy.offeredRefKeys,
    proposedClaims: response.proposedClaims,
    allowedClaims: policy.allowedClaims,
    ...(policy.forbiddenClaims.length > 0
      ? { forbiddenClaims: policy.forbiddenClaims }
      : {}),
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
  const speakerRankIdPolicy = request.speakerContext.standing.rank;
  const npcGateCtxPolicy = buildTextGateContext(db, speakerRankIdPolicy, request.register);
  npcGateCtxPolicy.privateAllowedTerms = request.resolvedAddress?.liftedForbiddenTerms ?? [];
  npcGateCtxPolicy.contextForbiddenRefs = request.resolvedAddress?.forbiddenInContext ?? [];
  const choiceGateCtxPolicy = buildTextGateContext(db, speakerRankIdPolicy, request.register);
  choiceGateCtxPolicy.contextForbiddenRefs = request.resolvedAddress?.forbiddenInContext ?? [];
  const findings: GateFinding[] = [
    ...scanDialogueText(response.text, npcGateCtxPolicy),
    ...response.choices.flatMap((c) => scanDialogueText(c.text, choiceGateCtxPolicy, { skipIdentityGates: true })),
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

  const character = resolveDialogueChar(db, request.speakerId, generatedConsorts)!;
  const expression =
    response.expression !== undefined && character.expressions.includes(response.expression)
      ? response.expression
      : "neutral";

  const retrievalStatus = policy.knowledgeRetrievalStatus ?? { kind: "not_configured" } as const;
  const provenance = extractProvenance(
    claimResult.acceptedClaims,
    response.mentionedContextRefs ?? [],
    policy.offeredRefKeys,
    request.promptContext.knowledgeContext,
    retrievalStatus,
  );

  // Emit provenance findings for any refs the model mentioned that were not offered.
  const provenanceFindings: ProvenanceFinding[] = provenance.unknownRefs.map((ref) => ({
    code: "unknown_context_ref" as const,
    ref,
  }));
  diagnostics.provenanceFindings = provenanceFindings;
  for (const finding of provenanceFindings) {
    logger?.logGameError(
      aiError("UNKNOWN_CONTEXT_REF", `model mentioned un-offered ref ${finding.ref.kind}:${finding.ref.id}`, {
        severity: "warn",
        context: { speakerId: request.speakerId, refKind: finding.ref.kind, refId: finding.ref.id },
      }),
    );
  }

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
    meta: {
      generated: provider.kind === "generative",
      degraded,
      ...(provenance.sourceRefs.length > 0 ? { sourceRefs: provenance.sourceRefs } : {}),
      ...(provenance.knowledge !== undefined ? { knowledge: provenance.knowledge } : {}),
    },
  };

  return { ok: true, line, diagnostics };
}

/**
 * Full policy-aware pipeline: provider call → validateDialogueProviderResult → memory write-back.
 * Returns both the rendered line and the updated GameState (mentionLog updated).
 *
 * @internal Use `produceDialogueTurn` instead.
 */
async function produceDialogueLineWithPolicy(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  policy: DialoguePolicyContext,
  state: GameState,
  logger?: import("../infra/logger").RingBufferLogger,
): Promise<Result<{ line: DialogueLine; nextState: GameState }, GameError>> {
  const raw = await provider.generate(request);
  if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));

  const outcome = validateDialogueProviderResult(db, provider, request, policy, raw.value, logger, state.generatedConsorts);
  if (!outcome.ok) return err(outcome.error);

  // ── memory write-back ─────────────────────────────────────────────
  // Mention cooldown is driven by BOTH accepted-claim sources AND the model's
  // mentionedContextRefs, so a trauma referenced without a factual claim still
  // cools down (PR-A item 6).
  let nextState = recordMentionedContext(
    state,
    outcome.diagnostics.acceptedClaims,
    { speakerId: request.speakerId, audienceId: request.targetId, now: policy.now },
    policy.offeredRefKeys,
    raw.value.mentionedContextRefs ?? [],
  );

  // ── event reaction write-back (T10) ───────────────────────────────
  // Atomic with mention writeback: both apply to the same nextState accumulation.
  // Guards: generative provider only; reactionSourceEventId must be present;
  // idempotent — skip if (speakerId, audienceId, eventId) triple already present.
  const reactionEventId = request.promptContext.reactionSourceEventId;
  if (reactionEventId !== undefined) {
    const speakerId = request.speakerId;
    const audienceId = request.targetId;
    const alreadyReacted = nextState.eventReactionLog.some(
      (r) =>
        r.speakerId === speakerId &&
        r.audienceId === audienceId &&
        r.eventId === reactionEventId,
    );
    if (!alreadyReacted) {
      const reactionRecord: EventReactionRecord = {
        speakerId,
        audienceId,
        eventId: reactionEventId,
        reactedAt: toGameTime(state.calendar),
      };
      nextState = {
        ...nextState,
        eventReactionLog: [...nextState.eventReactionLog, reactionRecord],
      };
    }
  }

  return ok({ line: outcome.line, nextState });
}

// ── T9: produceDialogueTurn — THE public entry point ─────────────────────────

/**
 * The ONLY exported dialogue entry point.
 *
 * Routes by provider kind:
 *   - `scripted`: text gate only (no claim gate, no mention/reaction writeback).
 *     Returns `{ line, nextState: state }` (state unchanged).
 *   - `generative`: full policy pipeline (claim gate + mention writeback + reaction writeback).
 *     Returns `{ line, nextState }` with mentionLog and eventReactionLog updated atomically.
 *
 * When `options.retriever` is provided (PR3+), knowledge retrieval runs before the
 * provider call, injects advisory context into the prompt, and populates
 * `line.meta.knowledge` on the result.
 *
 * Fatal retrieval errors behave according to `options.knowledgeFailureMode`:
 *   - `"continue_without_knowledge"` (default): turn proceeds with `knowledgeContext: []`;
 *     `meta.knowledge.degraded = true`, `degradationKind = "fatal_degraded"`.
 *   - `"fail_turn"`: turn returns an error before provider is called; state unchanged.
 *
 * Error cases:
 *   - `generative` provider + `request.scripted` set → `invalid_combination`.
 */
export async function produceDialogueTurn(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  state: GameState,
  options?: DialogueTurnOptions,
): Promise<Result<{ line: DialogueLine; nextState: GameState }, GameError>> {
  const logger = options?.logger;

  // Guard: generative provider must not receive a scripted request
  if (provider.kind === "generative" && request.scripted !== undefined) {
    return err(
      aiError("INVALID_COMBINATION", "generative provider cannot process a scripted request", {
        context: { providerId: provider.id, speakerId: request.speakerId },
      }),
    );
  }

  // ── Knowledge retrieval (PR3) ─────────────────────────────────────────────────
  // Only runs on the generative path — scripted lines are authored and do not
  // need advisory context.
  let finalRequest = request;
  let retrievalStatus: KnowledgeRetrievalStatus = { kind: "not_configured" };
  if (options?.retriever && provider.kind === "generative") {
    const ceiling = resolveVisibilityCeiling(request.speakerId, db, state);
    const query = buildDialogueKnowledgeQuery(request, ceiling);

    // Intent gate: classify only the user's latest utterance, not the full
    // composite query (which includes sceneDirective and topicTags that may
    // contain static-rule vocabulary and would corrupt the signal).
    const utterance = getLatestTargetUtterance(request);
    const intent = utterance ? classifyQueryIntent(utterance) : "static_lore";
    if (intent === "runtime_state") {
      finalRequest = {
        ...request,
        promptContext: { ...request.promptContext, knowledgeContext: [] },
      };
      retrievalStatus = { kind: "skipped_runtime_state" };
    } else {
      try {
        const result = await options.retriever.retrieve(query);
        retrievalStatus = result.vectorDegradation !== undefined
          ? { kind: "vector_degraded", reason: result.vectorDegradation.reason }
          : { kind: "ok" };
        const chunks = packPromptKnowledge(result.hits, ceiling);
        finalRequest = {
          ...request,
          promptContext: { ...request.promptContext, knowledgeContext: chunks },
        };
      } catch (e: unknown) {
        const errMsg = String(e);
        logger?.logGameError(
          aiError("KNOWLEDGE_RETRIEVAL_FAILED", errMsg, {
            severity: "warn",
            context: { speakerId: request.speakerId },
          }),
        );
        const failureMode = options.knowledgeFailureMode ?? "continue_without_knowledge";
        if (failureMode === "fail_turn") {
          return err(aiError("KNOWLEDGE_RETRIEVAL_FAILED", errMsg, { context: { speakerId: request.speakerId } }));
        }
        // continue_without_knowledge: inject empty array so provenance sees retrieval ran
        finalRequest = {
          ...request,
          promptContext: { ...request.promptContext, knowledgeContext: [] },
        };
        retrievalStatus = { kind: "fatal_degraded" };
      }
    }
  }

  if (provider.kind === "scripted") {
    // Scripted path: text gates only, no claim gate, no state mutation
    const lineResult = await produceDialogueLine(db, provider, finalRequest, logger, state.generatedConsorts);
    if (!lineResult.ok) return err(lineResult.error);
    return ok({ line: lineResult.value, nextState: state });
  }

  // Generative path: full policy pipeline
  const policy = buildDialoguePolicyContext(db, state, finalRequest);
  const policyWithStatus: DialoguePolicyContext = retrievalStatus.kind !== "not_configured"
    ? { ...policy, knowledgeRetrievalStatus: retrievalStatus }
    : policy;
  return produceDialogueLineWithPolicy(db, provider, finalRequest, policyWithStatus, state, logger);
}
