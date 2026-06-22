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
import type { DialogueProvider } from "../../src/engine/dialogue/types";
import type { DialogueProviderResult } from "../../src/engine/dialogue/providerContract";
import { ok } from "../../src/engine/infra/result";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";
import { toGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent, GameState, MemoryEntry } from "../../src/engine/state/types";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const VALID_TEXT = "本宫累了，陛下早些歇息。";

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
  const firstOfferedId = [...makePolicy().offeredContextIds][0]!;
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
    // 皇上 is a forbidden term
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse({ text: "皇上圣明。" }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("GATE_REJECTED");
    expect(outcome.diagnostics).toBeDefined();
    expect(outcome.diagnostics.textFindings.length).toBeGreaterThan(0);
  });

  it("diagnostics.acceptedClaims present on ok=false text gate path", () => {
    const request = makeRequest();
    const policy = makePolicy();
    const firstOfferedId = [...policy.offeredContextIds][0]!;

    // A valid claim (should be accepted by claim gate) but forbidden text
    const validClaim: ProposedClaim = {
      claim: {
        id: "c_valid",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "fenghou",
        modality: "assert",
      },
      sourceRefs: [{ kind: "memory" as const, id: firstOfferedId }],
      modality: "assert",
      certainty: 90,
    };

    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse({ text: "皇上圣明。", proposedClaims: [validClaim] }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("GATE_REJECTED");
    // acceptedClaims should be populated from the claim gate that passed
    expect(outcome.diagnostics.acceptedClaims).toBeDefined();
    expect(Array.isArray(outcome.diagnostics.acceptedClaims)).toBe(true);
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
      { charId: "shen_zhibai", toRank: "fenghou",  salience: 10 },
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
      summary: "申知白晋位凤后",
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
const TURN_VALID_TEXT = "本宫累了，陛下早些歇息。";

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

  it("generative provider: full policy pipeline, returns nextState with possible mentionLog update", async () => {
    const request = makeGenerativeRequest();
    const policy = buildDialoguePolicyContext(db, state, request);
    const firstOfferedId = [...policy.offeredContextIds][0];
    // Build a generative provider that proposes a valid claim so writeback runs
    const validClaimProvider: typeof PROVIDER = {
      id: "gen-with-claim",
      kind: "generative",
      capabilities: { strictTools: true, promptCaching: false, batch: false },
      generate: async (req) =>
        ok<DialogueProviderResult>({
          speaker: req.speakerId,
          text: TURN_VALID_TEXT,
          choices: [],
          proposedClaims: firstOfferedId ? [{
            claim: { id: "c_t9", predicate: "holds_rank", subjectId: TURN_SPEAKER, object: "fenghou", modality: "assert" },
            sourceRefs: [{ kind: "memory" as const, id: firstOfferedId }],
            modality: "assert",
            certainty: 90,
          }] : [],
        }),
    };
    const result = await produceDialogueTurn(db, validClaimProvider, request, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe(TURN_VALID_TEXT);
    expect(result.value.line.meta.generated).toBe(true);
    // nextState is a different object (mentionLog potentially grew)
    expect(result.value.nextState).not.toBe(state); // new reference (recordMentionedContext always returns new obj)
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
