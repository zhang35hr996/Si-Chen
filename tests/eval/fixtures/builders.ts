/**
 * Eval fixture builders (T5, LLM-2).
 *
 * Each fixture builds a minimal valid game world (db + state) and provides a
 * deterministic responseFor() used by runEvalScenario. All character IDs and
 * location IDs reference real content in content/.
 *
 * Fixture overview:
 *   base_palace           — Normal pass: compliant line for a ranked consort.
 *   consort_with_grievance — Injected grievance memory; responseFor cites that
 *                            memory via proposedClaims (tests requiredSourceContextIds).
 *   demoted_consort        — Low-favor scenario; responseFor returns compliant
 *                            submissive line (tests demoted speaker path).
 *   wrong_speaker_test     — responseFor returns speakerIdOverride → WRONG_SPEAKER.
 *   gate_reject_test       — responseFor returns text with "皇上" (in lexicon
 *                            forbiddenTerms) → text gate reject.
 */
import { loadRealContent } from "../../helpers/contentFixture";
import { createNewGameState } from "../../../src/engine/state/newGame";
import type { EvalFixtureDefinition } from "../../../src/engine/dialogue/eval/fixtureProvider";
import type { MemoryEntry } from "../../../src/engine/state/types";
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
 * expectations.requiredSourceContextIds.
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
    return {
      text: "侍身记得旧事，心中难免感怀，望陛下垂顾。",
      proposedClaims: [
        {
          claim: {
            id: "c_eval_grievance",
            predicate: "holds_rank",
            subjectId: "lu_huaijin",
            object: "chenghui",
            modality: "assert",
          },
          sourceContextIds: [GRIEVANCE_MEMORY_ID],
          modality: "assert",
          certainty: 80,
        },
      ],
    };
  },
};

// ── 3. demoted_consort ───────────────────────────────────────────────────────

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
 * responseFor returns text containing "皇上", which is in lexicon.forbiddenTerms.
 * The text gate (forbidden_lexicon) will fire, causing gateStatus=fail.
 * The raw text is still preserved on result.text even after gate rejection.
 */
const gate_reject_test: EvalFixtureDefinition = {
  buildState() {
    return loadBase();
  },
  responseFor() {
    return { text: "皇上圣明，臣侍领旨。" };
  },
};

// ── Export map ───────────────────────────────────────────────────────────────

export const evalFixtures: Record<string, EvalFixtureDefinition> = {
  base_palace,
  consort_with_grievance,
  demoted_consort,
  wrong_speaker_test,
  gate_reject_test,
};
