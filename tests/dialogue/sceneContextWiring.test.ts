/**
 * PR-A items 1+2: real scene context (topic / subject / present / privacy)
 * must flow from DialogueAssemblyOptions into recall, activation, audience,
 * and the compiled prompt's currentScene.topicTags.
 *
 * Run: npx vitest run tests/dialogue/sceneContextWiring.test.ts
 */
import { describe, it, expect } from "vitest";
import { assembleDialogueRequest } from "../../src/engine/dialogue/orchestrator";
import { compilePromptPayload } from "../../src/engine/dialogue/promptPayload";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, MemoryEntry } from "../../src/engine/state/types";

const db = loadRealContent();
const baseState = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const LOC = "zichendian";
const SUBJECT = "heir_7"; // a character the memory is about, not the speaker

/** A grievance about SUBJECT, strength below the 70 wide-recall floor and below
 *  the activation threshold without a topic/subject bonus. */
const subjectMemory: MemoryEntry = {
  id: "mem_shen_1",
  ownerId: SPEAKER,
  kind: "grievance",
  subjectIds: [SUBJECT],
  perspective: "witness",
  summary: "曾因皇嗣受责，臣侍记忆犹新。",
  strength: 60,
  retention: "slow",
  emotions: { shame: 50 },
  triggerTags: ["punishment", "heir"],
  unresolved: true,
  createdAt: makeGameTime(1, 1, "early"),
};

function withMemory(state: GameState, mem: MemoryEntry): GameState {
  return {
    ...state,
    memories: { ...state.memories, [mem.ownerId]: { entries: [mem], nextSeq: 2 } },
  };
}

const memoryIds = (state: GameState, opts = {}) => {
  const r = assembleDialogueRequest(db, state, SPEAKER, LOC, opts);
  if (!r.ok) throw new Error("assemble failed");
  return r.value.promptContext.relevantMemories.map((m) => m.id);
};

describe("scene topic threading → recall + activation", () => {
  it("a sub-threshold memory about the subject stays UNrecalled without topic context", () => {
    const state = withMemory(baseState, subjectMemory);
    expect(memoryIds(state)).not.toContain(subjectMemory.id);
  });

  it("passing topicTags that match the memory's triggerTags activates it", () => {
    const state = withMemory(baseState, subjectMemory);
    expect(memoryIds(state, { topicTags: ["heir"] })).toContain(subjectMemory.id);
  });

  it("passing presentCharacterIds = the memory's subject activates it (present-bonus)", () => {
    const state = withMemory(baseState, subjectMemory);
    expect(memoryIds(state, { presentCharacterIds: [SUBJECT] })).toContain(subjectMemory.id);
  });
});

describe("scene audience threading (present + privacy)", () => {
  it("presentCharacterIds flows into promptContext.audience.presentCharacterIds", () => {
    const r = assembleDialogueRequest(db, baseState, SPEAKER, LOC, {
      presentCharacterIds: [SUBJECT],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.promptContext.audience.presentCharacterIds).toContain(SUBJECT);
  });

  it("privacy flows into promptContext.audience.privacy", () => {
    const r = assembleDialogueRequest(db, baseState, SPEAKER, LOC, { privacy: "private" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.promptContext.audience.privacy).toBe("private");
  });

  it("privacy defaults to semi_private when not provided", () => {
    const r = assembleDialogueRequest(db, baseState, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.promptContext.audience.privacy).toBe("semi_private");
  });
});

describe("scene topic threading → compiled prompt currentScene", () => {
  it("currentScene.topicTags reflects the assembly options (not a hardcoded [])", () => {
    const r = assembleDialogueRequest(db, baseState, SPEAKER, LOC, {
      topicTags: ["heir", "punishment"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const payload = compilePromptPayload(r.value);
    expect(payload.currentScene.topicTags).toEqual(["heir", "punishment"]);
  });

  it("currentScene.topicTags is [] when no topic context is provided", () => {
    const r = assembleDialogueRequest(db, baseState, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(compilePromptPayload(r.value).currentScene.topicTags).toEqual([]);
  });
});
