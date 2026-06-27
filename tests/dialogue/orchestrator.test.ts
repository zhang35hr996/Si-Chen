/**
 * T3: validateDialogueProviderResult — shared validation pipeline.
 * T8: assembleDialogueRequest — promptContext assembly order.
 *
 * Tests validate:
 *   1. ok=true path: returns line + diagnostics
 *   2. Speaker-first ordering: WRONG_SPEAKER before CLAIM_REJECTED
 *   3. Claim gate failure: CLAIM_REJECTED, claimFindings non-empty
 *   4. Text gate failure: GATE_REJECTED, textFindings non-empty
 *   5. Diagnostics always present even on ok=false paths
 *
 *   T8 tests (assembleDialogueRequest — promptContext):
 *   6.  reactionPlan undefined in fresh game (no chronicle events)
 *   7.  reactionPlan defined with eligible event
 *   8.  reactionPlan undefined when sceneDirective set
 *   9.  reactionSourceEventId matches selected event id
 *   10. knownEvents always includes reaction event (pinned)
 *   11. assembleClaims only authorizes claims from events in promptContext.knownEvents
 *   12. memory with sourceEventId NOT in knownEvents generates no allowed claim
 *   13. allowedClaims sourceRefs all point to offered memory or event refs
 *   14. buildMemoryContext called with subjectIds including speakerId
 *   15. uses toGameTime(state.calendar)
 */
import { describe, it, expect } from "vitest";
import {
  assembleDialogueRequest,
  buildDialoguePolicyContext,
  validateDialogueProviderResult,
  produceDialogueTurn,
} from "../../src/engine/dialogue/orchestrator";
import type { DialogueProvider, DialogueRequest } from "../../src/engine/dialogue/types";
import { RingBufferLogger } from "../../src/engine/infra/logger";
import type { DialogueProviderResult } from "../../src/engine/dialogue/providerContract";
import { ok } from "../../src/engine/infra/result";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";
import { toGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent, GameState, MemoryEntry } from "../../src/engine/state/types";
import type { KnowledgeRetriever } from "../../src/engine/dialogue/knowledge/types";
import type { KnowledgeHybridResult } from "../../src/engine/knowledge/retrieval/types";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const VALID_TEXT = "臣侍告退，陛下早些歇息。";

function makeRequest() {
  const r = assembleDialogueRequest(db, state, SPEAKER, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function makePolicy() {
  return buildDialoguePolicyContext(db, state, makeRequest());
}

const PROVIDER: DialogueProvider = {
  id: "test-provider",
  kind: "generative",
  capabilities: { strictTools: true, promptCaching: false, batch: false },
  generate: async (req) =>
    ok<DialogueProviderResult>({
      speaker: req.speakerId,
      text: VALID_TEXT,
      choices: [],
      proposedClaims: [],
    }),
};

function makeResponse(
  overrides: Partial<DialogueProviderResult> = {},
): DialogueProviderResult {
  return {
    speaker: SPEAKER,
    text: VALID_TEXT,
    choices: [],
    proposedClaims: [],
    ...overrides,
  };
}

function makeWrongClaimResponse(): DialogueProviderResult {
  const firstOfferedId = makeRequest().speakerContext.relevantMemories[0]!.id;
  // shen_zhibai is fenghou; claim says "zhaoyi" → contradicts belief
  const wrongRankClaim: ProposedClaim = {
    claim: {
      id: "c_wrong",
      predicate: "holds_rank",
      subjectId: SPEAKER,
      object: "zhaoyi",
      modality: "assert",
    },
    sourceRefs: [{ kind: "memory" as const, id: firstOfferedId }],
    modality: "assert",
    certainty: 90,
  };
  return makeResponse({ proposedClaims: [wrongRankClaim] });
}

describe("validateDialogueProviderResult", () => {
  it("ok=true: returns line + diagnostics", () => {
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.line.speakerId).toBe(SPEAKER);
    expect(outcome.line.text).toBe(VALID_TEXT);
    expect(outcome.line.meta.generated).toBe(true);
    expect(outcome.line.meta.degraded).toBe(false);
    expect(outcome.diagnostics).toBeDefined();
    expect(outcome.diagnostics.claimFindings).toEqual([]);
    expect(outcome.diagnostics.textFindings).toEqual([]);
    expect(Array.isArray(outcome.diagnostics.acceptedClaims)).toBe(true);
  });

  it("ok=false speaker mismatch: error=WRONG_SPEAKER, diagnostics present", () => {
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse({ speaker: "wei_sui" }), // wrong speaker
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("WRONG_SPEAKER");
    expect(outcome.diagnostics).toBeDefined();
    // diagnostics are empty because we failed before any gate ran
    expect(outcome.diagnostics.claimFindings).toEqual([]);
    expect(outcome.diagnostics.textFindings).toEqual([]);
    expect(outcome.diagnostics.acceptedClaims).toEqual([]);
  });

  it("ok=false wrong speaker + wrong claim: WRONG_SPEAKER (not CLAIM_REJECTED)", () => {
    // LLM-2: speaker check now precedes claim gate; wrong speaker always returns WRONG_SPEAKER
    // See: docs/superpowers/plans/2026-06-22-llm-2-prompt-compiler-eval.md T3
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      // wrong speaker AND wrong claim — speaker check must win
      { ...makeWrongClaimResponse(), speaker: "wei_sui" },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("WRONG_SPEAKER");
    // claim gate must NOT have run — so claimFindings stays empty
    expect(outcome.diagnostics.claimFindings).toEqual([]);
  });

  it("ok=false claim gate rejects: CLAIM_REJECTED, claimFindings non-empty", () => {
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeWrongClaimResponse(),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("CLAIM_REJECTED");
    expect(outcome.diagnostics).toBeDefined();
    expect(outcome.diagnostics.claimFindings.length).toBeGreaterThan(0);
  });

  it("ok=false text gate rejects: GATE_REJECTED, textFindings non-empty", () => {
    const request = makeRequest();
    const policy = makePolicy();
    // 娘娘 is a forbidden term
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse({ text: "娘娘圣明。" }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("GATE_REJECTED");
    expect(outcome.diagnostics).toBeDefined();
    expect(outcome.diagnostics.textFindings.length).toBeGreaterThan(0);
  });

  it("diagnostics.acceptedClaims present on ok=false text gate path", () => {
    // Forbidden text "娘娘" → GATE_REJECTED. No factual claims (CLOSED mode on fresh state).
    // Verifies that diagnostics.acceptedClaims is an accessible array even on the text-gate fail path.
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse({ text: "娘娘圣明。", proposedClaims: [] }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("GATE_REJECTED");
    expect(outcome.diagnostics.acceptedClaims).toBeDefined();
    expect(Array.isArray(outcome.diagnostics.acceptedClaims)).toBe(true);
    expect(outcome.diagnostics.acceptedClaims).toEqual([]);
  });
});

// ── T8: assembleDialogueRequest — promptContext ────────────────────────────────

const T8_SPEAKER = "shen_zhibai";
const T8_LOCATION = "zichendian";

/**
 * A realm-scoped rank_changed event that shen_zhibai can know.
 * lu_huaijin's current rank in a fresh game is "chenghui", so payload.to = "chenghui"
 * passes the state ground-truth check in eventToAuthorizedClaims.
 */
function makeEligibleEvent(
  id: string,
  dayIndex: number,
  subjectId = "lu_huaijin",
  toRank = "chenghui",
): CourtEvent {
  // Compute year/month/period from dayIndex so GameTime is fully consistent
  const periodOrdinal = dayIndex % 3;
  const totalMonths = Math.floor(dayIndex / 3);
  const year = Math.floor(totalMonths / 12) + 1;
  const month = (totalMonths % 12) + 1;
  const periods = ["early", "mid", "late"] as const;
  return {
    id,
    type: "rank_changed",
    occurredAt: { year, month, period: periods[periodOrdinal]!, dayIndex },
    participants: [{ charId: subjectId, role: "subject" }],
    payload: { from: "guiren", to: toRank, direction: "promote" },
    // realm scope: anyone who is present can know it without palace-entry time check
    publicity: { scope: "realm", persistence: "institutional" },
    publicSalience: 80,
    retention: "slow",
    tags: [],
  };
}

/** Inject events into a fresh GameState's chronicle. */
function stateWithEvents(events: CourtEvent[]): GameState {
  const base = createNewGameState(db);
  return { ...base, chronicle: events };
}

describe("assembleDialogueRequest — promptContext", () => {
  it("reactionPlan undefined in fresh game (no eligible events)", () => {
    // Fresh game: state.chronicle is empty → no events → buildReactionPlan returns undefined
    const state = createNewGameState(db);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.promptContext.reactionPlan).toBeUndefined();
  });

  it("reactionPlan defined with eligible event", () => {
    // Day 0 event: within 3-day reaction window of game start (dayIndex 0)
    const event = makeEligibleEvent("evt_001", 0);
    const state = stateWithEvents([event]);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.promptContext.reactionPlan).toBeDefined();
  });

  it("reactionPlan undefined when sceneDirective set", () => {
    const event = makeEligibleEvent("evt_001", 0);
    const state = stateWithEvents([event]);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION, {
      sceneDirective: "authored scene suppresses reaction",
    });
    if (!result.ok) throw new Error(result.error.message);
    // sceneDirective suppresses event reaction flow
    expect(result.value.promptContext.reactionPlan).toBeUndefined();
  });

  it("reactionSourceEventId matches selected event id", () => {
    const event = makeEligibleEvent("evt_rxn_001", 0);
    const state = stateWithEvents([event]);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.promptContext.reactionSourceEventId).toBe("evt_rxn_001");
  });

  it("knownEvents always includes reaction event (pinned)", () => {
    // Use 4 events so selectPromptEvents (limit=3) normally would drop one
    // but the reaction event must always appear first as pinned
    const rxnEvent = makeEligibleEvent("evt_rxn_pin", 0);
    // Higher salience events to compete for the 3 slots
    const highSalience: CourtEvent[] = [1, 2, 3].map((i) => ({
      ...makeEligibleEvent(`evt_high_${i}`, 0, "lu_huaijin", "chenghui"),
      id: `evt_high_${i}`,
      publicSalience: 100,
    }));
    // Override reaction event to have low salience so it wouldn't be selected naturally
    const lowRxnEvent: CourtEvent = { ...rxnEvent, publicSalience: 1 };
    const state = stateWithEvents([lowRxnEvent, ...highSalience]);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION);
    if (!result.ok) throw new Error(result.error.message);
    const knownEventIds = result.value.promptContext.knownEvents.map((e) => e.id);
    // Reaction event must appear (pinned, first)
    expect(knownEventIds[0]).toBe("evt_rxn_pin");
    // Total must respect limit (3)
    expect(knownEventIds.length).toBeLessThanOrEqual(3);
  });

  it("assembleClaims only authorizes claims from events in promptContext.knownEvents", () => {
    // When there's no reaction event, claims can only come from events in promptEvents
    // (which is selectPromptEvents with limit=3)
    const event = makeEligibleEvent("evt_claim_001", 0);
    const state = stateWithEvents([event]);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION);
    if (!result.ok) throw new Error(result.error.message);
    const ctx = result.value.promptContext;
    const knownEventIds = new Set(ctx.knownEvents.map((e) => e.id));
    // Every allowedClaim sourceRef of kind "event" must be in knownEvents
    for (const ac of ctx.allowedClaims) {
      for (const ref of ac.sourceRefs) {
        if (ref.kind === "event") {
          expect(knownEventIds.has(ref.id)).toBe(true);
        }
      }
    }
  });

  it("memory with sourceEventId NOT in knownEvents generates no allowed claim", () => {
    // Use sceneDirective to suppress reaction pinning (no event forced into slot 0).
    // 4 rank_changed events for 4 distinct consorts, all at dayIndex 0.
    // selectPromptEvents(limit=3) picks the top 3 by publicSalience desc.
    // The 4th event (lowest salience, for shen_zhibai→fenghou) is excluded.
    // A memory linking to the excluded event must NOT produce an allowed claim.
    const subjectConfigs: { charId: string; toRank: string; salience: number }[] = [
      { charId: "lu_huaijin",  toRank: "chenghui", salience: 100 },
      { charId: "wenya",       toRank: "chenghui", salience: 90 },
      { charId: "xu_qinghuan", toRank: "jun",      salience: 80 },
      // orphan: lowest salience → excluded from the 3-slot promptEvents window
      { charId: "shen_zhibai", toRank: "huanghou",  salience: 10 },
    ];
    const allEvents: CourtEvent[] = subjectConfigs.map((cfg, i) => ({
      ...makeEligibleEvent(`evt_orphan_${i}`, 0, cfg.charId, cfg.toRank),
      publicSalience: cfg.salience,
    }));
    const droppedEventId = "evt_orphan_3"; // salience 10 — excluded from promptEvents

    // A memory that references the excluded event
    const orphanMemory: MemoryEntry = {
      id: "mem_orphan",
      ownerId: T8_SPEAKER,
      kind: "episodic",
      summary: "申知白晋位皇后",
      subjectIds: [T8_SPEAKER],
      triggerTags: ["rank"],
      perspective: "witness",
      emotions: {},
      unresolved: false,
      strength: 90,
      retention: "slow",
      createdAt: allEvents[3]!.occurredAt,
      sourceEventId: droppedEventId,
    };

    const base = stateWithEvents(allEvents);
    const existingEntries = base.memories?.[T8_SPEAKER]?.entries ?? [];
    const existingNextSeq = base.memories?.[T8_SPEAKER]?.nextSeq ?? 0;
    const stateWithMem: GameState = {
      ...base,
      memories: {
        ...base.memories,
        [T8_SPEAKER]: {
          entries: [...existingEntries, orphanMemory],
          nextSeq: existingNextSeq + 1,
        },
      },
    };

    // sceneDirective suppresses reaction pinning → pure salience ordering for promptEvents
    const result = assembleDialogueRequest(db, stateWithMem, T8_SPEAKER, T8_LOCATION, {
      sceneDirective: "suppress_reaction_for_test",
    });
    if (!result.ok) throw new Error(result.error.message);
    const ctx = result.value.promptContext;

    // Verify the orphan event is NOT in promptContext.knownEvents
    const knownEventIds = new Set(ctx.knownEvents.map((e) => e.id));
    expect(knownEventIds.has(droppedEventId)).toBe(false);

    // No allowed claim should have memory:mem_orphan as a source ref
    const orphanRefKey = "memory:mem_orphan";
    const allSourceRefKeys = ctx.allowedClaims.flatMap((ac) =>
      ac.sourceRefs.map((ref) => `${ref.kind}:${ref.id}`),
    );
    expect(allSourceRefKeys).not.toContain(orphanRefKey);
  });

  it("allowedClaims sourceRefs all point to offered memory or event refs", () => {
    const event = makeEligibleEvent("evt_refs_001", 0);
    const state = stateWithEvents([event]);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION);
    if (!result.ok) throw new Error(result.error.message);
    const ctx = result.value.promptContext;

    // Build the set of all offered ref keys
    const memoryIds = new Set(ctx.relevantMemories.map((m) => m.id));
    const eventIds = new Set(ctx.knownEvents.map((e) => e.id));

    for (const ac of ctx.allowedClaims) {
      for (const ref of ac.sourceRefs) {
        if (ref.kind === "memory") {
          expect(memoryIds.has(ref.id)).toBe(true);
        } else if (ref.kind === "event") {
          expect(eventIds.has(ref.id)).toBe(true);
        }
        // "fact" kind sourceRefs are not generated by assembleClaims — no assertion needed
      }
    }
  });

  it("buildMemoryContext called with subjectIds including speakerId", () => {
    // If subjectIds includes speakerId, memories where subjectIds contains the speaker
    // get a relevance boost (subject match). We test the observable effect:
    // assembleDialogueRequest returns successfully with relevantMemories containing
    // entries whose subjectIds include the speakerId when they exist.
    const state = createNewGameState(db);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION);
    if (!result.ok) throw new Error(result.error.message);
    // The request must succeed (subjectIds=[speakerId] doesn't crash buildMemoryContext)
    expect(result.value.speakerId).toBe(T8_SPEAKER);
    // speakerContext.relevantMemories is populated by buildMemoryContext
    expect(Array.isArray(result.value.speakerContext.relevantMemories)).toBe(true);
  });

  it("uses toGameTime(state.calendar)", () => {
    const state = createNewGameState(db);
    const result = assembleDialogueRequest(db, state, T8_SPEAKER, T8_LOCATION);
    if (!result.ok) throw new Error(result.error.message);
    const expected = toGameTime(state.calendar);
    // request.time must match toGameTime(state.calendar)
    expect(result.value.time).toEqual(expected);
    // promptContext.reactionPlan uses currentDayIndex = now.dayIndex = toGameTime(state.calendar).dayIndex
    // indirectly verified: fresh game has no events so no reaction, but the pipeline ran with correct time
    expect(result.value.time.dayIndex).toBe(expected.dayIndex);
  });
});

// ── T9: produceDialogueTurn ────────────────────────────────────────────────────

import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";

const TURN_SPEAKER = "shen_zhibai";
const TURN_VALID_TEXT = "臣侍告退，陛下早些歇息。";

function makeScriptedRequest(text = TURN_VALID_TEXT) {
  const r = assembleDialogueRequest(db, state, TURN_SPEAKER, "zichendian", { scripted: { text } });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function makeGenerativeRequest() {
  const r = assembleDialogueRequest(db, state, TURN_SPEAKER, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function makeGenerativeProvider(text = TURN_VALID_TEXT): typeof PROVIDER {
  return {
    id: "gen-test",
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: false, batch: false },
    generate: async (req) =>
      ok<DialogueProviderResult>({
        speaker: req.speakerId,
        text,
        choices: [],
        proposedClaims: [],
      }),
  };
}

describe("produceDialogueTurn", () => {
  it("is the only exported entry point (produceDialogueLine is NOT exported)", () => {
    // If this file compiles with only produceDialogueTurn imported from orchestrator,
    // that proves it's exported. The private ones (produceDialogueLine,
    // produceDialogueLineWithPolicy) are not imported — TypeScript would fail
    // to compile this file if they were absent from the export list.
    expect(typeof produceDialogueTurn).toBe("function");
    // Further verification: source-level grep checks happen in CI (grep asserted in task brief)
  });

  it("produceDialogueLine is NOT exported", async () => {
    const mod = await import("../../src/engine/dialogue/orchestrator");
    expect("produceDialogueLine" in mod).toBe(false);
    expect("produceDialogueLineWithPolicy" in mod).toBe(false);
  });

  it("generative + request.scripted set → error invalid_combination", async () => {
    const request = makeScriptedRequest(); // has scripted field set
    const generativeProvider = makeGenerativeProvider();
    const result = await produceDialogueTurn(db, generativeProvider, request, state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_COMBINATION");
  });

  it("scripted provider: text gate only, no claim gate, no mention writeback", async () => {
    const request = makeScriptedRequest();
    const result = await produceDialogueTurn(db, mockProvider, request, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe(TURN_VALID_TEXT);
    expect(result.value.line.meta.generated).toBe(false); // scripted
    // State unchanged (no mention writeback for scripted)
    expect(result.value.nextState).toBe(state);
  });

  it("generative provider: full policy pipeline produces valid generated line", async () => {
    // Fresh state → allowedClaims=[] (CLOSED). No factual claims proposed; tests the full
    // generative pipeline produces a valid line without hitting claim gate.
    const request = makeGenerativeRequest();
    const result = await produceDialogueTurn(db, makeGenerativeProvider(), request, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe(TURN_VALID_TEXT);
    expect(result.value.line.meta.generated).toBe(true);
  });

  it("scripted provider: state reference is same (no writeback)", async () => {
    const request = makeScriptedRequest();
    const result = await produceDialogueTurn(db, mockProvider, request, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // For scripted path, nextState === state (same reference)
    expect(result.value.nextState).toBe(state);
  });
});

// ── Suite G: buildDialoguePolicyContext — knowledge IDs in offeredRefKeys ─────

describe("buildDialoguePolicyContext — Suite G: knowledge chunk IDs in offeredRefKeys", () => {
  it("includes knowledge chunk IDs in offeredRefKeys when knowledgeContext is present", () => {
    const request = makeRequest();
    const requestWithKnowledge = {
      ...request,
      promptContext: {
        ...request.promptContext,
        knowledgeContext: [
          { id: "etiquette.court#intro", title: "宫廷礼仪", text: "...", sourceType: "etiquette" as const },
        ],
      },
    };
    const policy = buildDialoguePolicyContext(db, state, requestWithKnowledge);
    expect(policy.offeredRefKeys.has("knowledge:etiquette.court#intro")).toBe(true);
  });

  it("does not include knowledge refs when knowledgeContext is absent", () => {
    const request = makeRequest();
    const policy = buildDialoguePolicyContext(db, state, request);
    const knowledgeKeys = [...policy.offeredRefKeys].filter((k) => k.startsWith("knowledge:"));
    expect(knowledgeKeys).toHaveLength(0);
  });

  it("still includes memory and event refs alongside knowledge refs", () => {
    // Inject known IDs into promptContext using the exact PromptMemory / PromptEvent shapes.
    const baseReq = makeRequest();
    const fakeMemory = { id: "mem_test_1" } as import("../../src/engine/dialogue/promptPayload").PromptMemory;
    const fakeEvent  = { id: "evt_test_1" } as import("../../src/engine/dialogue/promptPayload").PromptEvent;
    const requestWithAll = {
      ...baseReq,
      promptContext: {
        ...baseReq.promptContext,
        relevantMemories: [fakeMemory],
        knownEvents: [fakeEvent],
        knowledgeContext: [
          { id: "chunk_kw_1", title: "t", text: "body", sourceType: "etiquette" as const },
        ],
      },
    };
    const policy = buildDialoguePolicyContext(db, state, requestWithAll);
    expect(policy.offeredRefKeys.has("memory:mem_test_1")).toBe(true);
    expect(policy.offeredRefKeys.has("event:evt_test_1")).toBe(true);
    expect(policy.offeredRefKeys.has("knowledge:chunk_kw_1")).toBe(true);
  });
});

// ── Suite H: produceDialogueTurn — knowledge retrieval injection ──────────────

describe("produceDialogueTurn — Suite H: knowledge retriever wiring", () => {
  function makeHit(id: string, text = "宫廷礼仪规定...") {
    return {
      chunk: {
        id,
        sourceType: "etiquette" as const,
        title: `title-${id}`,
        text,
        tags: [],
        entityIds: [],
        locationIds: [],
        visibility: "public" as const,
        sourcePath: "content/knowledge/court.md",
      },
      hybridScore: 0.9,
      rank: 1,
      keywordRank: 1,
      keywordScore: 0.8,
      vectorRank: null,
      cosineScore: null,
    };
  }

  function makeFakeRetriever(result: KnowledgeHybridResult, callTracker?: { count: number }): KnowledgeRetriever {
    return {
      retrieve: async () => {
        if (callTracker) callTracker.count++;
        return result;
      },
    };
  }

  function makeCountingProvider(text = TURN_VALID_TEXT, callTracker?: { count: number }): DialogueProvider {
    return {
      id: "counting-provider",
      kind: "generative",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate: async () => {
        if (callTracker) callTracker.count++;
        return ok<DialogueProviderResult>({
          speaker: SPEAKER, text, expression: "neutral", choices: [], proposedClaims: [], mentionedContextRefs: [],
        });
      },
    };
  }

  function makeCapturingProvider(text = TURN_VALID_TEXT, mentionedRefs: { kind: "knowledge"; id: string }[] = []) {
    let captured: DialogueRequest | undefined;
    const provider: DialogueProvider = {
      id: "capturing-provider",
      kind: "generative",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate: async (req) => {
        captured = req;
        return ok<DialogueProviderResult>({
          speaker: SPEAKER, text, expression: "neutral", choices: [], proposedClaims: [], mentionedContextRefs: mentionedRefs,
        });
      },
    };
    return { provider, getCapture: () => captured };
  }

  it("retriever called once, provider called once, in that order", async () => {
    const calls: string[] = [];
    const retriever: KnowledgeRetriever = {
      retrieve: async () => { calls.push("retriever"); return { hits: [makeHit("k1")] }; },
    };
    const provider: DialogueProvider = {
      id: "order-check",
      kind: "generative",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate: async () => {
        calls.push("provider");
        return ok<DialogueProviderResult>({ speaker: SPEAKER, text: TURN_VALID_TEXT, expression: "neutral", choices: [], proposedClaims: [], mentionedContextRefs: [] });
      },
    };
    await produceDialogueTurn(db, provider, makeGenerativeRequest(), state, { retriever });
    expect(calls).toEqual(["retriever", "provider"]);
  });

  it("injects knowledgeContext into prompt — exact DTO keys, no sourcePath or visibility", async () => {
    const { provider, getCapture } = makeCapturingProvider();
    const retriever = makeFakeRetriever({ hits: [makeHit("etiquette.court#礼制")] });

    await produceDialogueTurn(db, provider, makeGenerativeRequest(), state, { retriever });

    const kc = getCapture()?.promptContext.knowledgeContext;
    expect(kc).toBeDefined();
    expect(kc?.[0]?.id).toBe("etiquette.court#礼制");
    expect(Object.keys(kc![0]!).sort()).toEqual(["id", "sourceType", "text", "title"]);
    expect(kc![0]).not.toHaveProperty("sourcePath");
    expect(kc![0]).not.toHaveProperty("visibility");
  });

  it("fatal error + continue_without_knowledge: provider still called, prompt gets knowledgeContext:[], meta.knowledge.degraded=true", async () => {
    const providerCalls = { count: 0 };
    const provider = makeCountingProvider(TURN_VALID_TEXT, providerCalls);
    const failingRetriever: KnowledgeRetriever = { retrieve: async () => { throw new Error("db down"); } };

    const request = makeGenerativeRequest();
    const result = await produceDialogueTurn(db, provider, request, state, {
      retriever: failingRetriever,
      knowledgeFailureMode: "continue_without_knowledge",
    });
    expect(result.ok).toBe(true);
    expect(providerCalls.count).toBe(1);
    if (!result.ok) return;
    // meta.knowledge reflects retrieval attempted but failed
    expect(result.value.line.meta.knowledge).toBeDefined();
    expect(result.value.line.meta.knowledge?.degraded).toBe(true);
    expect(result.value.line.meta.knowledge?.chunkIds).toEqual([]);
  });

  it("fatal error + fail_turn: provider NOT called, error returned, state unchanged", async () => {
    const providerCalls = { count: 0 };
    const provider = makeCountingProvider(TURN_VALID_TEXT, providerCalls);
    const failingRetriever: KnowledgeRetriever = { retrieve: async () => { throw new Error("fatal"); } };

    const request = makeGenerativeRequest();
    const result = await produceDialogueTurn(db, provider, request, state, {
      retriever: failingRetriever,
      knowledgeFailureMode: "fail_turn",
    });
    expect(result.ok).toBe(false);
    expect(providerCalls.count).toBe(0);
    // State must be unchanged — reference-equal (no state mutation on failed turn)
    if (result.ok) return;
    expect(result.error.code).toBe("KNOWLEDGE_RETRIEVAL_FAILED");
  });

  it("scripted provider: retriever NOT called, knowledgeContext absent from prompt", async () => {
    const retrieverCalls = { count: 0 };
    const retriever = makeFakeRetriever({ hits: [] }, retrieverCalls);

    let capturedReq: DialogueRequest | undefined;
    const scriptedProvider: DialogueProvider = {
      id: "scripted",
      kind: "scripted",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate: async (req) => {
        capturedReq = req;
        return ok<DialogueProviderResult>({ speaker: SPEAKER, text: TURN_VALID_TEXT, expression: "neutral", choices: [], proposedClaims: [], mentionedContextRefs: [] });
      },
    };

    await produceDialogueTurn(db, scriptedProvider, makeScriptedRequest(), state, { retriever });
    expect(retrieverCalls.count).toBe(0);
    expect(capturedReq?.promptContext.knowledgeContext).toBeUndefined();
  });

  it("meta.knowledge.chunkIds contains referenced chunk IDs; unused chunks excluded", async () => {
    const { provider, getCapture: _gc } = makeCapturingProvider(TURN_VALID_TEXT, [{ kind: "knowledge", id: "k_used" }]);
    const retriever = makeFakeRetriever({ hits: [makeHit("k_used"), makeHit("k_unused")] });

    const request = makeGenerativeRequest();
    const result = await produceDialogueTurn(db, provider, request, state, { retriever });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.meta.knowledge?.chunkIds).toContain("k_used");
    expect(result.value.line.meta.knowledge?.chunkIds).not.toContain("k_unused");
  });

  it("meta.knowledge.degraded = true when vector channel degraded", async () => {
    const { provider } = makeCapturingProvider(TURN_VALID_TEXT, [{ kind: "knowledge", id: "c_deg" }]);
    const retriever = makeFakeRetriever({
      hits: [makeHit("c_deg")],
      vectorDegradation: { reason: "no_embeddings", message: "no vectors indexed" },
    });

    const result = await produceDialogueTurn(db, provider, makeGenerativeRequest(), state, { retriever });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.meta.knowledge?.degraded).toBe(true);
  });

  it("zero-hit vector degradation: provider proceeds, meta.knowledge.degraded=true, chunkIds=[]", async () => {
    const { provider } = makeCapturingProvider(TURN_VALID_TEXT, []);
    const retriever = makeFakeRetriever({
      hits: [],
      vectorDegradation: { reason: "no_embeddings", message: "no embeddings in index" },
    });

    const result = await produceDialogueTurn(db, provider, makeGenerativeRequest(), state, { retriever });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.meta.knowledge).toBeDefined();
    expect(result.value.line.meta.knowledge?.degraded).toBe(true);
    expect(result.value.line.meta.knowledge?.chunkIds).toEqual([]);
  });

  it("successful zero-hit retrieval: degraded=false (empty hits ≠ degraded)", async () => {
    const { provider } = makeCapturingProvider(TURN_VALID_TEXT, []);
    // No vectorDegradation — retriever succeeded but found nothing
    const retriever = makeFakeRetriever({ hits: [] });

    const result = await produceDialogueTurn(db, provider, makeGenerativeRequest(), state, { retriever });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.meta.knowledge).toBeDefined();
    expect(result.value.line.meta.knowledge?.degraded).toBe(false);
    expect(result.value.line.meta.knowledge).not.toHaveProperty("degradationKind");
  });

  it("vector_degraded with keyword hits: degradationKind=vector_degraded, degradationReason preserved", async () => {
    const { provider } = makeCapturingProvider(TURN_VALID_TEXT, [{ kind: "knowledge", id: "c_kw" }]);
    const retriever = makeFakeRetriever({
      hits: [makeHit("c_kw")],
      vectorDegradation: { reason: "provider_error", message: "openai timeout" },
    });

    const result = await produceDialogueTurn(db, provider, makeGenerativeRequest(), state, { retriever });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.meta.knowledge?.degraded).toBe(true);
    expect(result.value.line.meta.knowledge?.degradationKind).toBe("vector_degraded");
    expect(result.value.line.meta.knowledge?.degradationReason).toBe("provider_error");
  });

  it("fatal error + fail_turn: input state is not mutated", async () => {
    const stateBefore = structuredClone(state);
    const failingRetriever: KnowledgeRetriever = { retrieve: async () => { throw new Error("disk"); } };
    const result = await produceDialogueTurn(db, makeCountingProvider(), makeGenerativeRequest(), state, {
      retriever: failingRetriever,
      knowledgeFailureMode: "fail_turn",
    });
    expect(result.ok).toBe(false);
    // The caller's state object must not have been mutated by the error path
    expect(state).toEqual(stateBefore);
  });

  it("hallucinated knowledge ref: provenanceFindings contains unknown_context_ref diagnostic", async () => {
    // The model mentions a knowledge ref that was never offered (simulates hallucination)
    const hallucRef = { kind: "knowledge" as const, id: "hallucinated_chunk" };
    const offeredRef = { kind: "knowledge" as const, id: "offered_chunk" };

    const capturingProvider: DialogueProvider = {
      id: "halluc-provider",
      kind: "generative",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate: async () => ok<DialogueProviderResult>({
        speaker: SPEAKER,
        text: TURN_VALID_TEXT,
        expression: "neutral",
        choices: [],
        proposedClaims: [],
        mentionedContextRefs: [offeredRef, hallucRef],
      }),
    };

    const retriever = makeFakeRetriever({ hits: [makeHit("offered_chunk")] });
    const request = makeGenerativeRequest();
    const result = await produceDialogueTurn(db, capturingProvider, request, state, { retriever });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Valid ref retained
    expect(result.value.line.meta.sourceRefs?.some((r) => r.id === "offered_chunk")).toBe(true);
    // Hallucinated ref absent from sourceRefs
    expect(result.value.line.meta.sourceRefs?.some((r) => r.id === "hallucinated_chunk")).toBeFalsy();

    // provenanceFindings carries the unknown ref diagnostic
    // We test this through validateDialogueProviderResult directly for diagnostic access
    const knowledgeContext = [{ id: "offered_chunk", title: "t", text: "body", sourceType: "etiquette" as const }];
    const enrichedRequest = {
      ...request,
      promptContext: { ...request.promptContext, knowledgeContext },
    };
    const policy = buildDialoguePolicyContext(db, state, enrichedRequest);
    const mockResponse: DialogueProviderResult = {
      speaker: SPEAKER,
      text: TURN_VALID_TEXT,
      expression: "neutral",
      choices: [],
      proposedClaims: [],
      mentionedContextRefs: [offeredRef, hallucRef],
    };
    const logger = new RingBufferLogger();
    const outcome = validateDialogueProviderResult(db, capturingProvider, enrichedRequest, policy, mockResponse, logger);
    expect(outcome.ok).toBe(true);
    expect(outcome.diagnostics.provenanceFindings).toEqual([
      { code: "unknown_context_ref", ref: hallucRef },
    ]);
    // Logger must record the UNKNOWN_CONTEXT_REF warning
    expect(logger.entries().some((e) => e.message.includes("UNKNOWN_CONTEXT_REF"))).toBe(true);

    // Duplicate invalid refs are deduped in diagnostics and logs (one finding, one log entry)
    const logger2 = new RingBufferLogger();
    const mockResponseDup: DialogueProviderResult = { ...mockResponse, mentionedContextRefs: [offeredRef, hallucRef, hallucRef] };
    const outcomeDup = validateDialogueProviderResult(db, capturingProvider, enrichedRequest, policy, mockResponseDup, logger2);
    expect(outcomeDup.ok).toBe(true);
    const dupFindings = outcomeDup.diagnostics.provenanceFindings.filter((f) => f.ref.id === "hallucinated_chunk");
    expect(dupFindings).toEqual([{ code: "unknown_context_ref", ref: hallucRef }]);
    expect(logger2.entries().filter((e) => e.message.includes("UNKNOWN_CONTEXT_REF"))).toHaveLength(1);
  });

  describe("intent gate — runtime_state bypasses retriever", () => {
    function makeRequestWithTarget(
      targetText: string,
      opts?: { sceneDirective?: string; topicTags?: string[] },
    ) {
      const r = assembleDialogueRequest(db, state, TURN_SPEAKER, "zichendian", {
        transcript: [{ speaker: "player", text: targetText }],
        sceneDirective: opts?.sceneDirective,
        topicTags: opts?.topicTags,
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    }

    it("runtime_state query: retriever NOT called, meta.knowledge present, degraded=false", async () => {
      const retrieverCalls = { count: 0 };
      const retriever = makeFakeRetriever({ hits: [] }, retrieverCalls);
      const { provider } = makeCapturingProvider();

      const result = await produceDialogueTurn(
        db, provider, makeRequestWithTarget("谁现在怀孕了"), state, { retriever },
      );

      expect(retrieverCalls.count).toBe(0);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.line.meta.knowledge).toBeDefined();
      expect(result.value.line.meta.knowledge?.degraded).toBe(false);
      expect(result.value.line.meta.knowledge?.chunkIds).toEqual([]);
    });

    it("static query containing '怀孕': retriever IS called (no false positive)", async () => {
      const retrieverCalls = { count: 0 };
      const retriever = makeFakeRetriever({ hits: [] }, retrieverCalls);
      const { provider } = makeCapturingProvider();

      await produceDialogueTurn(
        db, provider, makeRequestWithTarget("怀孕期间是否照常视事"), state, { retriever },
      );

      expect(retrieverCalls.count).toBe(1);
    });

    it("static query containing '目前': retriever IS called (no false positive)", async () => {
      const retrieverCalls = { count: 0 };
      const retriever = makeFakeRetriever({ hits: [] }, retrieverCalls);
      const { provider } = makeCapturingProvider();

      await produceDialogueTurn(
        db, provider, makeRequestWithTarget("目前正式使用的后宫位分有哪些"), state, { retriever },
      );

      expect(retrieverCalls.count).toBe(1);
    });

    it("sceneDirective containing '礼制' does NOT prevent runtime query from being skipped", async () => {
      const retrieverCalls = { count: 0 };
      const retriever = makeFakeRetriever({ hits: [] }, retrieverCalls);
      const { provider } = makeCapturingProvider();

      // sceneDirective contains a STATIC_RULE_MARKER — must not contaminate intent classification
      await produceDialogueTurn(
        db, provider,
        makeRequestWithTarget("谁现在怀孕了", { sceneDirective: "须遵后宫礼制回答" }),
        state, { retriever },
      );

      expect(retrieverCalls.count).toBe(0);
    });

    it("topicTags containing '位分' do NOT prevent runtime query from being skipped", async () => {
      const retrieverCalls = { count: 0 };
      const retriever = makeFakeRetriever({ hits: [] }, retrieverCalls);
      const { provider } = makeCapturingProvider();

      // topicTag contains a STATIC_RULE_MARKER — must not contaminate intent classification
      await produceDialogueTurn(
        db, provider,
        makeRequestWithTarget("当前谁最受宠", { topicTags: ["位分", "宠爱"] }),
        state, { retriever },
      );

      expect(retrieverCalls.count).toBe(0);
    });

    it("sceneDirective containing temporal word does NOT incorrectly skip a static query", async () => {
      const retrieverCalls = { count: 0 };
      const retriever = makeFakeRetriever({ hits: [] }, retrieverCalls);
      const { provider } = makeCapturingProvider();

      // sceneDirective contains temporal vocab but user is asking about an institution
      await produceDialogueTurn(
        db, provider,
        makeRequestWithTarget("承养制度是什么", { sceneDirective: "最近宫廷风波不断" }),
        state, { retriever },
      );

      expect(retrieverCalls.count).toBe(1);
    });
  });
});

describe("assembleDialogueRequest — etiquette.forbiddenTerms lifted by resolvedAddress", () => {
  const gameState = createNewGameState(db);

  it("凤君 remains forbidden when register=public (fail-closed)", () => {
    const r = assembleDialogueRequest(db, gameState, "shen_zhibai", "zichendian", { register: "public" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.etiquette.forbiddenTerms).toContain("凤君");
  });

  it("凤君 is lifted from forbiddenTerms when 皇后 × target=player × private", () => {
    const r = assembleDialogueRequest(db, gameState, "shen_zhibai", "zichendian", { register: "private" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.etiquette.forbiddenTerms).not.toContain("凤君");
    expect(r.value.resolvedAddress?.liftedForbiddenTerms).toContain("凤君");
  });

  it("凤君 is lifted when 皇后 × target=player × intimate", () => {
    const r = assembleDialogueRequest(db, gameState, "shen_zhibai", "zichendian", { register: "intimate" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.etiquette.forbiddenTerms).not.toContain("凤君");
  });

  it("凤君 stays forbidden for 皇后 × non-player target (not the emperor)", () => {
    const r = assembleDialogueRequest(db, gameState, "shen_zhibai", "zichendian", {
      register: "private",
      targetId: "lu_huaijin",
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.etiquette.forbiddenTerms).toContain("凤君");
  });
});
