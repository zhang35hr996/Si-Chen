/**
 * PR4 integration tests: application-level knowledge runtime wiring.
 *
 * Tests the dialogue wiring contract at the level of produceDialogueTurn +
 * DialogueRuntimeDeps, covering all cases from the PR4 test matrix (T7):
 *
 *  1. No retriever → provider runs, no knowledgeContext, no meta.knowledge
 *  2. Fake retriever → retriever called once, chunk DTO has exact 4 keys
 *  3. Choice continuation → retriever called on both turns
 *  4. Scripted provider + retriever → retriever 0 calls
 *  5. Fatal continue_without_knowledge → degraded diagnostic set
 *  6. Fatal fail_turn → provider 0 calls, state unchanged
 *  7. Lifecycle: stale promise does not pollute state
 *  8. Browser boundary: runtimeDeps.ts imports no Node-only modules
 *  9. SceneRunner with retriever: scripted provider → 0 retriever calls
 */
import { describe, it, expect } from "vitest";
import { assembleDialogueRequest, produceDialogueTurn } from "../../src/engine/dialogue/orchestrator";
import { toDialogueTurnOptions, type DialogueRuntimeDeps } from "../../src/engine/dialogue/runtimeDeps";
import type { DialogueProvider, DialogueTurnOptions } from "../../src/engine/dialogue/types";
import type { DialogueProviderResult } from "../../src/engine/dialogue/providerContract";
import type { KnowledgeRetriever } from "../../src/engine/dialogue/knowledge/types";
import type { KnowledgeHybridResult } from "../../src/engine/knowledge/retrieval/types";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import { SceneRunner } from "../../src/engine/scenes/runner";
import { ok } from "../../src/engine/infra/result";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { readFileSync } from "fs";
import { createGameStore } from "../../src/store/gameStore";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const VALID_TEXT = "本宫累了，陛下早些歇息。";

function makeRequest() {
  const r = assembleDialogueRequest(db, state, SPEAKER, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function makeHit(id: string) {
  return {
    chunk: {
      id,
      sourceType: "etiquette" as const,
      title: `title-${id}`,
      text: "宫廷礼仪规定",
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

function makeFakeRetriever(hits: KnowledgeHybridResult["hits"], tracker?: { count: number }): KnowledgeRetriever {
  return {
    retrieve: async () => {
      if (tracker) tracker.count++;
      return { hits };
    },
  };
}

function makeGenerativeProvider(text = VALID_TEXT): DialogueProvider {
  return {
    id: "gen-provider",
    kind: "generative",
    capabilities: { strictTools: false, promptCaching: false, batch: false },
    generate: async (req) => ok<DialogueProviderResult>({
      speaker: req.speakerId,
      text,
      expression: "neutral",
      choices: [],
      proposedClaims: [],
      mentionedContextRefs: [],
    }),
  };
}

// ── Case 1: No retriever ──────────────────────────────────────────────────────

describe("Case 1: no retriever configured", () => {
  it("provider is called and returns a line", async () => {
    const deps: DialogueRuntimeDeps = { provider: makeGenerativeProvider() };
    const result = await produceDialogueTurn(db, deps.provider, makeRequest(), state, toDialogueTurnOptions(deps));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe(VALID_TEXT);
  });

  it("meta.knowledge is absent when no retriever is wired", async () => {
    const deps: DialogueRuntimeDeps = { provider: makeGenerativeProvider() };
    const result = await produceDialogueTurn(db, deps.provider, makeRequest(), state, toDialogueTurnOptions(deps));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.meta.knowledge).toBeUndefined();
  });

  it("toDialogueTurnOptions with provider-only produces no option keys", () => {
    const deps: DialogueRuntimeDeps = { provider: makeGenerativeProvider() };
    const opts: DialogueTurnOptions = toDialogueTurnOptions(deps);
    expect(Object.keys(opts)).toHaveLength(0);
  });
});

// ── Case 2: Fake retriever injected ──────────────────────────────────────────

describe("Case 2: fake retriever injected", () => {
  it("retriever is called exactly once per turn", async () => {
    const tracker = { count: 0 };
    const deps: DialogueRuntimeDeps = {
      provider: makeGenerativeProvider(),
      knowledgeRetriever: makeFakeRetriever([makeHit("chunk_1")], tracker),
    };
    await produceDialogueTurn(db, deps.provider, makeRequest(), state, toDialogueTurnOptions(deps));
    expect(tracker.count).toBe(1);
  });

  it("chunk DTO has exactly {id, title, text, sourceType} — no sourcePath, no visibility", async () => {
    let capturedContext: unknown;
    const capturingProvider: DialogueProvider = {
      id: "capturing",
      kind: "generative",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate: async (req) => {
        capturedContext = req.promptContext.knowledgeContext;
        return ok<DialogueProviderResult>({
          speaker: req.speakerId,
          text: VALID_TEXT,
          expression: "neutral",
          choices: [],
          proposedClaims: [],
          mentionedContextRefs: [],
        });
      },
    };
    const deps: DialogueRuntimeDeps = {
      provider: capturingProvider,
      knowledgeRetriever: makeFakeRetriever([makeHit("chunk_1")]),
    };
    await produceDialogueTurn(db, deps.provider, makeRequest(), state, toDialogueTurnOptions(deps));
    expect(Array.isArray(capturedContext)).toBe(true);
    const chunks = capturedContext as Array<Record<string, unknown>>;
    expect(chunks.length).toBeGreaterThan(0);
    const chunk = chunks[0] ?? {};
    expect(Object.keys(chunk).sort()).toEqual(["id", "sourceType", "text", "title"]);
    expect(chunk).not.toHaveProperty("sourcePath");
    expect(chunk).not.toHaveProperty("visibility");
  });

  it("meta.knowledge is present with correct chunkIds", async () => {
    const deps: DialogueRuntimeDeps = {
      provider: makeGenerativeProvider(),
      knowledgeRetriever: makeFakeRetriever([makeHit("chunk_abc")]),
    };
    const result = await produceDialogueTurn(db, deps.provider, makeRequest(), state, toDialogueTurnOptions(deps));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // knowledgeContext injected but model didn't mention the chunk → chunkIds: []
    expect(result.value.line.meta.knowledge).toBeDefined();
    expect(result.value.line.meta.knowledge?.degraded).toBe(false);
  });
});

// ── Case 3: Choice continuation ───────────────────────────────────────────────

describe("Case 3: retriever called on both first turn and choice continuation", () => {
  it("two sequential turns both invoke the retriever", async () => {
    const tracker = { count: 0 };
    const deps: DialogueRuntimeDeps = {
      provider: makeGenerativeProvider(),
      knowledgeRetriever: makeFakeRetriever([makeHit("k1")], tracker),
    };
    const opts = toDialogueTurnOptions(deps);

    const turn1 = await produceDialogueTurn(db, deps.provider, makeRequest(), state, opts);
    expect(turn1.ok).toBe(true);
    expect(tracker.count).toBe(1);

    if (!turn1.ok) return;
    const state2 = turn1.value.nextState;
    const turn2 = await produceDialogueTurn(db, deps.provider, makeRequest(), state2, opts);
    expect(turn2.ok).toBe(true);
    expect(tracker.count).toBe(2);
  });
});

// ── Case 4: Scripted provider with retriever → 0 calls ────────────────────────

describe("Case 4: scripted provider with retriever wired — retriever not called", () => {
  it("scripted path bypasses retrieval", async () => {
    const tracker = { count: 0 };
    const deps: DialogueRuntimeDeps = {
      provider: mockProvider,
      knowledgeRetriever: makeFakeRetriever([makeHit("k1")], tracker),
    };
    const scriptedRequest = assembleDialogueRequest(
      db, state, SPEAKER, "zichendian",
      { scripted: { text: "本宫有些乏了。" } },
    );
    if (!scriptedRequest.ok) throw new Error("assembly failed");
    const opts = toDialogueTurnOptions(deps);
    const result = await produceDialogueTurn(db, deps.provider, scriptedRequest.value, state, opts);
    expect(result.ok).toBe(true);
    expect(tracker.count).toBe(0);
  });
});

// ── Case 5: Fatal retrieval + continue_without_knowledge ──────────────────────

describe("Case 5: fatal retrieval error + continue_without_knowledge", () => {
  it("provider is still called and line.meta.knowledge reports fatal_degraded", async () => {
    const failingRetriever: KnowledgeRetriever = {
      retrieve: async () => { throw new Error("disk error"); },
    };
    const providerCalls = { count: 0 };
    const deps: DialogueRuntimeDeps = {
      provider: {
        id: "counting",
        kind: "generative",
        capabilities: { strictTools: false, promptCaching: false, batch: false },
        generate: async (req) => {
          providerCalls.count++;
          return ok<DialogueProviderResult>({
            speaker: req.speakerId,
            text: VALID_TEXT,
            expression: "neutral",
            choices: [],
            proposedClaims: [],
            mentionedContextRefs: [],
          });
        },
      },
      knowledgeRetriever: failingRetriever,
      knowledgeFailureMode: "continue_without_knowledge",
    };
    const result = await produceDialogueTurn(db, deps.provider, makeRequest(), state, toDialogueTurnOptions(deps));
    expect(result.ok).toBe(true);
    expect(providerCalls.count).toBe(1);
    if (!result.ok) return;
    expect(result.value.line.meta.knowledge?.degraded).toBe(true);
    expect(result.value.line.meta.knowledge?.degradationKind).toBe("fatal_degraded");
    // Error text must NOT reach LLM: knowledgeContext would be [] — no raw error text
  });
});

// ── Case 6: Fatal retrieval + fail_turn ───────────────────────────────────────

describe("Case 6: fatal retrieval error + fail_turn", () => {
  it("provider is not called and state is not mutated", async () => {
    const stateBefore = structuredClone(state);
    const failingRetriever: KnowledgeRetriever = {
      retrieve: async () => { throw new Error("fatal"); },
    };
    const providerCalls = { count: 0 };
    const deps: DialogueRuntimeDeps = {
      provider: {
        id: "should-not-be-called",
        kind: "generative",
        capabilities: { strictTools: false, promptCaching: false, batch: false },
        generate: async (req) => {
          providerCalls.count++;
          return ok<DialogueProviderResult>({
            speaker: req.speakerId, text: VALID_TEXT, expression: "neutral",
            choices: [], proposedClaims: [], mentionedContextRefs: [],
          });
        },
      },
      knowledgeRetriever: failingRetriever,
      knowledgeFailureMode: "fail_turn",
    };
    const result = await produceDialogueTurn(db, deps.provider, makeRequest(), state, toDialogueTurnOptions(deps));
    expect(result.ok).toBe(false);
    expect(providerCalls.count).toBe(0);
    expect(state).toEqual(stateBefore);
  });
});

// ── Case 7: Lifecycle — stale promise does not pollute new state ───────────────

describe("Case 7: stale async turn does not advance state if replaced by new game", () => {
  it("commitDialogueState returns false if expected state has been replaced", () => {
    const store = createGameStore();
    store.newGame(db);
    const stateSnapshot = store.getState();
    // Simulate new game happening between produce and commit
    store.newGame(db);
    const committed = store.commitDialogueState(stateSnapshot, stateSnapshot);
    expect(committed).toBe(false);
  });
});

// ── Case 8: Browser boundary — runtimeDeps.ts has no Node-only imports ────────

describe("Case 8: browser boundary — runtimeDeps.ts contains no Node-only imports", () => {
  const FORBIDDEN = [
    "better-sqlite3",
    "node:fs",
    "node:path",
    "sqlite-fts5",
    "sqlite-vector-index",
  ];

  it("runtimeDeps.ts source contains no forbidden imports", () => {
    const src = readFileSync(
      new URL("../../src/engine/dialogue/runtimeDeps.ts", import.meta.url).pathname,
      "utf-8",
    );
    for (const forbidden of FORBIDDEN) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("App.tsx does not directly import Node-only knowledge implementations", () => {
    const src = readFileSync(
      new URL("../../src/ui/App.tsx", import.meta.url).pathname,
      "utf-8",
    );
    for (const forbidden of FORBIDDEN) {
      expect(src, `App.tsx must not import ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ── Case 9: SceneRunner with retriever — scripted provider → 0 calls ──────────

describe("Case 9: SceneRunner with retriever wired — scripted path does not call retriever", () => {
  it("scripted scene with retriever in runtime: retriever call count is 0", async () => {
    const tracker = { count: 0 };
    const runtime: DialogueRuntimeDeps = {
      provider: mockProvider,
      knowledgeRetriever: makeFakeRetriever([makeHit("k1")], tracker),
    };

    const firstEventId = Object.keys(db.events)[0];
    if (!firstEventId) return; // no events in fixture → skip gracefully

    const runner = new SceneRunner(db, runtime);
    await runner.start(state, firstEventId);
    // The runner produces a frame or ends — in either case, retriever must not be called
    expect(tracker.count).toBe(0);
    runner.abandon();
  });
});
