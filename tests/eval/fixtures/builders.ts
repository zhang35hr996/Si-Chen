/**
 * Eval fixture builders (T5 + T11, LLM-2 / LLM-3).
 *
 * Each fixture builds a minimal valid game world (db + state) and provides a
 * deterministic responseFor() used by runEvalScenario. All character IDs and
 * location IDs reference real content in content/.
 *
 * Fixture overview:
 *   base_palace              — Normal pass: compliant line for a ranked consort.
 *   consort_with_grievance   — Injected grievance memory; responseFor returns empty
 *                              proposedClaims (T11: tests gate passes with no claims).
 *   consort_with_known_event — Injected rank_changed court event; responseFor cites
 *                              the event ref in a holds_rank claim (tests event auth).
 *   coresidence_conflict     — Injected rank_changed event (produces allowedClaims);
 *                              responseFor proposes resides_at → claim_not_allowed (CLOSED).
 *   demoted_consort          — Low-favor scenario; responseFor returns compliant
 *                              submissive line (tests demoted speaker path).
 *   wrong_speaker_test       — responseFor returns speakerIdOverride → WRONG_SPEAKER.
 *   gate_reject_test         — responseFor returns text with "皇上" (in lexicon
 *                              forbiddenTerms) → text gate reject.
 */
import { loadRealContent } from "../../helpers/contentFixture";
import { createNewGameState } from "../../../src/engine/state/newGame";
import type { EvalFixtureDefinition } from "../../../src/engine/dialogue/eval/fixtureProvider";
import type { MemoryEntry, CourtEvent } from "../../../src/engine/state/types";
import { toGameTime } from "../../../src/engine/calendar/time";

// ── Shared real content (loaded once) ───────────────────────────────────────

function loadBase() {
  const db = loadRealContent();
  const state = createNewGameState(db);
  return { db, state };
}

// ── Grievance memory ID (used in scenario expectations) ─────────────────────

/**
 * Well-known ID for the injected grievance memory used in
 * consort_with_grievance fixture. Exported so scenarios.jsonl can reference it.
 */
export const GRIEVANCE_MEMORY_ID = "mem_eval_grievance_001";

/**
 * Well-known ID for the injected rank_changed court event used in
 * consort_with_known_event and coresidence_conflict fixtures.
 * The event authorizes a holds_rank claim for lu_huaijin.
 */
export const RANK_EVENT_ID = "evt_eval_rank_001";

// ── 1. base_palace ──────────────────────────────────────────────────────────

/**
 * Normal pass fixture: shen_zhibai (fenghou rank) in kunninggong.
 * responseFor returns a compliant line that passes all gates.
 * If sceneDirective is set, the response echoes it.
 */
const base_palace: EvalFixtureDefinition = {
  buildState() {
    return loadBase();
  },
  responseFor(scenario) {
    const text = scenario.sceneDirective
      ? `遵照${scenario.sceneDirective}，臣后谨记。`
      : "臣后见过陛下。";
    return { text };
  },
};

// ── 2. consort_with_grievance ────────────────────────────────────────────────

/**
 * Fixture with an injected grievance memory for lu_huaijin.
 * The memory ID is GRIEVANCE_MEMORY_ID so scenario expectations can cite it.
 * responseFor proposes a claim that cites that memory, satisfying
 * expectations.requiredSourceRefs.
 *
 * The injected memory has strength=90 so it always clears the recall threshold
 * (recallCandidates passes memories with strength>=70 unconditionally).
 */
const consort_with_grievance: EvalFixtureDefinition = {
  buildState() {
    const { db, state } = loadBase();

    // Deep-clone the memory store for lu_huaijin and inject the grievance entry.
    const existingStore = state.memories["lu_huaijin"]!;
    const injectedMemory: MemoryEntry = {
      id: GRIEVANCE_MEMORY_ID,
      ownerId: "lu_huaijin",
      kind: "grievance",
      subjectIds: ["player", "lu_huaijin"],
      perspective: "target",
      summary: "三旬未得召幸，独守空宫，心中积郁难言。",
      strength: 90,
      retention: "permanent",
      emotions: { grief: 60, anger: 20 },
      triggerTags: ["neglect", "grievance"],
      unresolved: true,
      createdAt: toGameTime(state.calendar),
    };

    // Return mutated state (deep clone the memories record for isolation)
    return {
      db,
      state: {
        ...state,
        memories: {
          ...state.memories,
          lu_huaijin: {
            entries: [injectedMemory, ...existingStore.entries],
            nextSeq: existingStore.nextSeq + 1,
          },
        },
      },
    };
  },
  responseFor() {
    // T11: proposedClaims: [] — tests that gate passes cleanly with no proposed claims.
    // The grievance memory is in context but the speaker makes no factual assertion.
    return {
      text: "侍身记得旧事，心中难免感怀，望陛下垂顾。",
      proposedClaims: [],
    };
  },
};

// ── 3. consort_with_known_event ──────────────────────────────────────────────

/**
 * Fixture where lu_huaijin has a rank_changed court event in the chronicle.
 * The event authorizes a holds_rank(lu_huaijin, chenghui) claim.
 * responseFor proposes that claim with the event as sourceRef.
 * This tests:
 *   - mustKnowEventIds: [RANK_EVENT_ID] passes when event is in knownEvents
 *   - belief bypass: event-authorized claim skips reveals_unknown_fact
 *   - claim authorized from event sourceRef
 */
function injectRankEvent(state: ReturnType<typeof loadBase>["state"]): typeof state {
  const now = toGameTime(state.calendar);
  const rankEvent: CourtEvent = {
    id: RANK_EVENT_ID,
    type: "rank_changed",
    occurredAt: { dayIndex: now.dayIndex - 1, year: now.year, month: now.month, period: now.period },
    participants: [{ charId: "lu_huaijin", role: "subject" }],
    payload: { from: "meiren", to: "chenghui" },
    publicity: { scope: "palace", persistence: "institutional" },
    publicSalience: 70,
    retention: "slow",
    tags: ["rank_change"],
  };
  return {
    ...state,
    chronicle: [rankEvent, ...state.chronicle],
  };
}

const consort_with_known_event: EvalFixtureDefinition = {
  buildState() {
    const { db, state } = loadBase();
    return { db, state: injectRankEvent(state) };
  },
  responseFor() {
    // Propose holds_rank claim citing the event — event is in offeredRefKeys
    return {
      text: "侍身已蒙陛下擢升，承徽之位铭记于心。",
      proposedClaims: [
        {
          claim: {
            id: "c_eval_rank_event",
            predicate: "holds_rank",
            subjectId: "lu_huaijin",
            object: "chenghui",
            modality: "assert",
          },
          sourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }],
          modality: "assert",
          certainty: 90,
        },
      ],
    };
  },
};

// ── 4. coresidence_conflict ──────────────────────────────────────────────────

/**
 * Fixture where lu_huaijin has a rank_changed event (producing allowedClaims).
 * responseFor proposes resides_at claim — which is NOT in the authorized set.
 * Since allowedClaims.length > 0, the gate runs in CLOSED mode.
 * Exercises: claim_not_allowed (CLOSED empty for the specific fact).
 */
const coresidence_conflict: EvalFixtureDefinition = {
  buildState() {
    const { db, state } = loadBase();
    return { db, state: injectRankEvent(state) };
  },
  responseFor() {
    // Propose resides_at claim — NOT in allowedClaims (which only has holds_rank)
    return {
      text: "侍身居于钟萃宫，与陛下相隔甚远。",
      proposedClaims: [
        {
          claim: {
            id: "c_eval_resides",
            predicate: "resides_at",
            subjectId: "lu_huaijin",
            object: "zhongcui_gong",
            modality: "assert",
          },
          sourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }],
          modality: "assert",
          certainty: 80,
        },
      ],
    };
  },
};

// ── 5. demoted_consort (was 3) ───────────────────────────────────────────────

/**
 * Low-favor / demoted-standing fixture: wenya (chenghui rank, favor=5)
 * in changmengong (冷宫). responseFor returns a compliant submissive line.
 */
const demoted_consort: EvalFixtureDefinition = {
  buildState() {
    return loadBase();
  },
  responseFor() {
    return { text: "侍身领命，不敢有怨。" };
  },
};

// ── 4. wrong_speaker_test ────────────────────────────────────────────────────

/**
 * responseFor returns speakerIdOverride="wrong_speaker_nonexistent_id".
 * The validation pipeline's speaker check will fire WRONG_SPEAKER, causing
 * gateStatus=fail.
 */
const wrong_speaker_test: EvalFixtureDefinition = {
  buildState() {
    return loadBase();
  },
  responseFor() {
    return {
      text: "此乃测试台词。",
      speakerIdOverride: "wrong_speaker_nonexistent_id",
    };
  },
};

// ── 5. gate_reject_test ──────────────────────────────────────────────────────

/**
 * responseFor returns text containing "娘娘", which is in lexicon.forbiddenTerms.
 * The text gate (forbidden_lexicon) will fire, causing gateStatus=fail.
 * The raw text is still preserved on result.text even after gate rejection.
 */
const gate_reject_test: EvalFixtureDefinition = {
  buildState() {
    return loadBase();
  },
  responseFor() {
    return { text: "娘娘圣明，臣侍领旨。" };
  },
};

// ── Export map ───────────────────────────────────────────────────────────────

// ── 6. consort_suspect_claim ─────────────────────────────────────────────────

/**
 * Fixture where lu_huaijin has a rank_changed event (produces allowedClaims).
 * responseFor proposes holds_rank with modality="suspect" (weaker than assert).
 * Since no certaintyCeiling is set on the authorized claim, suspect ≤ ceiling → accepted.
 * Exercises: modality coverage (suspect path) + event-auth belief bypass.
 */
const consort_suspect_claim: EvalFixtureDefinition = {
  buildState() {
    const { db, state } = loadBase();
    return { db, state: injectRankEvent(state) };
  },
  responseFor() {
    return {
      text: "侍身听闻陆承徽或已晋位，然尚未得到证实。",
      proposedClaims: [
        {
          claim: {
            id: "c_eval_rank_suspect",
            predicate: "holds_rank",
            subjectId: "lu_huaijin",
            object: "chenghui",
            modality: "suspect",
          },
          sourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }],
          modality: "suspect",
          certainty: 60,
        },
      ],
    };
  },
};

// ── 7. consort_deny_claim ─────────────────────────────────────────────────────

/**
 * Fixture where the speaker denies a rank assertion. Since deny modality
 * is a separate polarity (deny ≠ affirm), this claim is NOT covered by
 * the affirm-polarity authorized claim → claim_not_allowed (CLOSED mode).
 * Exercises: modality coverage (deny polarity → CLOSED blocks it).
 */
const consort_deny_claim: EvalFixtureDefinition = {
  buildState() {
    const { db, state } = loadBase();
    return { db, state: injectRankEvent(state) };
  },
  responseFor() {
    return {
      text: "侍身以为陆承徽不曾晋位。",
      proposedClaims: [
        {
          claim: {
            id: "c_eval_rank_deny",
            predicate: "holds_rank",
            subjectId: "lu_huaijin",
            object: "chenghui",
            modality: "deny",
          },
          sourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }],
          modality: "deny",
          certainty: 70,
        },
      ],
    };
  },
};

// ── 8. latest_mutation_test ──────────────────────────────────────────────────

/**
 * Fixture with TWO rank_changed events for lu_huaijin:
 *   - old event (dayIndex - 2): A→B (promoted to "chenghui") — NOT latest mutation
 *   - new event (dayIndex - 1): B→C (promoted to "guifei")  — latest mutation
 * Current state has rank "guifei".
 *
 * responseFor proposes holds_rank(lu_huaijin, "chenghui") citing the OLD event.
 * isLatestFactMutation returns false for the old event → not in allowedClaims.
 * → claim_not_allowed (old rank event does NOT authorize current-state claim).
 *
 * Exercises: latest-mutation check (superseded event blocked).
 */
export const LATEST_MUTATION_OLD_EVENT_ID = "evt_eval_rank_old";
export const LATEST_MUTATION_NEW_EVENT_ID = "evt_eval_rank_new";

const latest_mutation_test: EvalFixtureDefinition = {
  buildState() {
    const { db, state } = loadBase();
    const now = toGameTime(state.calendar);
    const oldEvent: CourtEvent = {
      id: LATEST_MUTATION_OLD_EVENT_ID,
      type: "rank_changed",
      occurredAt: { dayIndex: now.dayIndex - 2, year: now.year, month: now.month, period: now.period },
      participants: [{ charId: "lu_huaijin", role: "subject" }],
      payload: { from: "meiren", to: "chenghui" },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 60,
      retention: "slow",
      tags: ["rank_change"],
    };
    const newEvent: CourtEvent = {
      id: LATEST_MUTATION_NEW_EVENT_ID,
      type: "rank_changed",
      occurredAt: { dayIndex: now.dayIndex - 1, year: now.year, month: now.month, period: now.period },
      participants: [{ charId: "lu_huaijin", role: "subject" }],
      payload: { from: "chenghui", to: "guifu" },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 80,
      retention: "slow",
      tags: ["rank_change"],
    };
    // Update lu_huaijin's rank to "guifu" in state (latest promotion)
    return {
      db,
      state: {
        ...state,
        chronicle: [oldEvent, newEvent],
        standing: {
          ...state.standing,
          lu_huaijin: {
            ...state.standing["lu_huaijin"]!,
            rank: "guifu",
          },
        },
      },
    };
  },
  responseFor() {
    // Propose old rank "chenghui" citing the old event → isLatestFactMutation=false → not authorized
    return {
      text: "侍身以为陆氏仍为承徽。",
      proposedClaims: [
        {
          claim: {
            id: "c_eval_old_rank",
            predicate: "holds_rank",
            subjectId: "lu_huaijin",
            object: "chenghui",
            modality: "assert",
          },
          sourceRefs: [{ kind: "event" as const, id: LATEST_MUTATION_OLD_EVENT_ID }],
          modality: "assert",
          certainty: 80,
        },
      ],
    };
  },
};

// ── 9. forbidden_claim_test ───────────────────────────────────────────────────

/**
 * Fixture where wenya is forbidden from asserting she holds the rank of fenghou.
 * wenya.dialoguePolicy.forbiddenClaims includes holds_rank(wenya, fenghou, assert).
 * The gate fires claim_explicitly_forbidden regardless of the proposed sourceRef —
 * source-independence: the forbidden check is fact+polarity only, no source check.
 * fenghou (empress) is the unique consort apex role — wenya cannot hold it.
 *
 * Exercises: claim_explicitly_forbidden (source-independent).
 */
const forbidden_claim_test: EvalFixtureDefinition = {
  buildState() {
    return loadBase();
  },
  responseFor() {
    return {
      text: "侍身如今已居中宫，位列皇后。",
      proposedClaims: [
        {
          claim: {
            id: "c_eval_forbidden_wenya_rank",
            predicate: "holds_rank",
            subjectId: "wenya",
            object: "huanghou",
            modality: "assert",
          },
          sourceRefs: [{ kind: "fact" as const, id: "identity" }],
          modality: "assert",
          certainty: 90,
        },
      ],
    };
  },
};

// ── 10. source_mismatch_test ─────────────────────────────────────────────────

/**
 * Fixture where lu_huaijin has a rank_changed event AND a grievance memory.
 * responseFor proposes holds_rank citing the GRIEVANCE memory (not the event).
 * In CLOSED mode: fact+polarity matches but source intersection fails →
 * source_not_authorized.
 *
 * Exercises: source_not_authorized (CLOSED mode, wrong sourceRef).
 */
const source_mismatch_test: EvalFixtureDefinition = {
  buildState() {
    const { db, state } = loadBase();
    const stateWithEvent = injectRankEvent(state);
    // Also inject the grievance memory so GRIEVANCE_MEMORY_ID is in offeredRefKeys
    const existingStore = stateWithEvent.memories["lu_huaijin"]!;
    const grievanceMemory: MemoryEntry = {
      id: GRIEVANCE_MEMORY_ID,
      ownerId: "lu_huaijin",
      kind: "grievance",
      subjectIds: ["player", "lu_huaijin"],
      perspective: "target",
      summary: "三旬未得召幸，独守空宫，心中积郁难言。",
      strength: 90,
      retention: "permanent",
      emotions: { grief: 60, anger: 20 },
      triggerTags: ["neglect", "grievance"],
      unresolved: true,
      createdAt: toGameTime(stateWithEvent.calendar),
    };
    return {
      db,
      state: {
        ...stateWithEvent,
        memories: {
          ...stateWithEvent.memories,
          lu_huaijin: {
            entries: [grievanceMemory, ...existingStore.entries],
            nextSeq: existingStore.nextSeq + 1,
          },
        },
      },
    };
  },
  responseFor() {
    // Propose holds_rank citing GRIEVANCE_MEMORY_ID — not in authorized sourceRefs
    // (authorized claim has RANK_EVENT_ID as sourceRef)
    return {
      text: "侍身已蒙陛下擢升，承徽之位铭记于心。",
      proposedClaims: [
        {
          claim: {
            id: "c_eval_rank_wrong_src",
            predicate: "holds_rank",
            subjectId: "lu_huaijin",
            object: "chenghui",
            modality: "assert",
          },
          // Cites the grievance memory, NOT the rank event → source intersection fails
          sourceRefs: [{ kind: "memory" as const, id: GRIEVANCE_MEMORY_ID }],
          modality: "assert",
          certainty: 80,
        },
      ],
    };
  },
};

// ── Export map ───────────────────────────────────────────────────────────────

export const evalFixtures: Record<string, EvalFixtureDefinition> = {
  base_palace,
  consort_with_grievance,
  consort_with_known_event,
  consort_suspect_claim,
  consort_deny_claim,
  coresidence_conflict,
  latest_mutation_test,
  forbidden_claim_test,
  source_mismatch_test,
  demoted_consort,
  wrong_speaker_test,
  gate_reject_test,
};
