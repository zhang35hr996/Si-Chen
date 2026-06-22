/**
 * Tests for createEvalFixtureProvider (T4, LLM-2).
 */
import { describe, it, expect } from "vitest";
import { createEvalFixtureProvider } from "../../../src/engine/dialogue/eval/fixtureProvider";
import type { EvalFixtureResponse } from "../../../src/engine/dialogue/eval/fixtureProvider";
import type { DialogueRequest } from "../../../src/engine/dialogue/types";
import type { ProposedClaim } from "../../../src/engine/dialogue/claims";

// Minimal stub — fixtureProvider.generate() doesn't inspect the request
const STUB_REQUEST = {} as unknown as DialogueRequest;

const SPEAKER_ID = "shen_zhibai";
const SAMPLE_TEXT = "本宫累了，陛下早些歇息。";

function makeResponse(overrides: Partial<EvalFixtureResponse> = {}): EvalFixtureResponse {
  return { text: SAMPLE_TEXT, ...overrides };
}

const SAMPLE_CLAIM: ProposedClaim = {
  claim: {
    id: "c1",
    predicate: "holds_rank",
    subjectId: SPEAKER_ID,
    object: "fenghou",
    modality: "assert",
  },
  sourceRefs: [{ kind: "memory" as const, id: "mem_001" }],
  modality: "assert",
  certainty: 90,
};

describe("createEvalFixtureProvider", () => {
  it("returns ok with text = response.text", async () => {
    const provider = createEvalFixtureProvider(makeResponse(), SPEAKER_ID);
    const result = await provider.generate(STUB_REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe(SAMPLE_TEXT);
  });

  it("returns ok with speaker = speakerId when no speakerIdOverride", async () => {
    const provider = createEvalFixtureProvider(makeResponse(), SPEAKER_ID);
    const result = await provider.generate(STUB_REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.speaker).toBe(SPEAKER_ID);
  });

  it("returns ok with speaker = speakerIdOverride when set", async () => {
    const provider = createEvalFixtureProvider(
      makeResponse({ speakerIdOverride: "wei_sui" }),
      SPEAKER_ID,
    );
    const result = await provider.generate(STUB_REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.speaker).toBe("wei_sui");
  });

  it("returns ok with proposedClaims when set", async () => {
    const provider = createEvalFixtureProvider(
      makeResponse({ proposedClaims: [SAMPLE_CLAIM] }),
      SPEAKER_ID,
    );
    const result = await provider.generate(STUB_REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.proposedClaims).toEqual([SAMPLE_CLAIM]);
  });

  it("returns ok with empty proposedClaims when not set", async () => {
    const provider = createEvalFixtureProvider(makeResponse(), SPEAKER_ID);
    const result = await provider.generate(STUB_REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.proposedClaims).toEqual([]);
  });

  it("capabilities.strictTools = true, kind = generative", () => {
    const provider = createEvalFixtureProvider(makeResponse(), SPEAKER_ID);
    expect(provider.kind).toBe("generative");
    expect(provider.capabilities.strictTools).toBe(true);
  });
});
