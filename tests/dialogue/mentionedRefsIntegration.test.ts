/**
 * PR-A item 6 (end-to-end): a generative turn where the model references a
 * memory via mentionedContextRefs — with NO factual claim — must still update
 * the mention cooldown log. This is the "trauma repeated every turn" fix.
 *
 * Run: npx vitest run tests/dialogue/mentionedRefsIntegration.test.ts
 */
import { describe, it, expect } from "vitest";
import { ok } from "../../src/engine/infra/result";
import { assembleDialogueRequest, produceDialogueTurn } from "../../src/engine/dialogue/orchestrator";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { DialogueProvider } from "../../src/engine/dialogue/types";
import type { DialogueProviderResult } from "../../src/engine/dialogue/providerContract";
import type { GameState, MemoryEntry } from "../../src/engine/state/types";

const db = loadRealContent();
const SPEAKER = "shen_zhibai";
const LOC = "zichendian";
const MEM_ID = "mem_shen_trauma";

const traumaMemory: MemoryEntry = {
  id: MEM_ID,
  ownerId: SPEAKER,
  kind: "trauma",
  subjectIds: [SPEAKER],
  perspective: "target",
  summary: "那日受辱，臣侍至今难忘。",
  strength: 90,
  retention: "permanent",
  emotions: { shame: 80 },
  triggerTags: ["humiliation"],
  unresolved: true,
  createdAt: makeGameTime(1, 1, "early"),
};

function withMemory(state: GameState, mem: MemoryEntry): GameState {
  return { ...state, memories: { ...state.memories, [mem.ownerId]: { entries: [mem], nextSeq: 2 } } };
}

/** A generative provider that references the memory but proposes NO claims. */
function refOnlyProvider(): DialogueProvider {
  return {
    id: "ref-only",
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: false, batch: false },
    generate: async (req) =>
      ok<DialogueProviderResult>({
        speaker: req.speakerId,
        text: "臣侍告退，陛下早些歇息。",
        choices: [],
        proposedClaims: [],
        mentionedContextRefs: [{ kind: "memory", id: MEM_ID }],
      }),
  };
}

describe("generative mention writeback via mentionedContextRefs", () => {
  it("logs the mention even though no factual claim was proposed", async () => {
    const state = withMemory(createNewGameState(db), traumaMemory);
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC, { topicTags: ["humiliation"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // sanity: the memory is actually offered to the model this turn
    expect(r.value.promptContext.relevantMemories.map((m) => m.id)).toContain(MEM_ID);

    const turn = await produceDialogueTurn(db, refOnlyProvider(), r.value, state);
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.value.nextState.mentionLog.length).toBe(state.mentionLog.length + 1);
    expect(turn.value.nextState.mentionLog.some((m) => m.memoryId === MEM_ID)).toBe(true);
  });
});
