/**
 * PR-A runtime wiring: the generative converse() path derives a presence/privacy
 * scene context once per conversation and passes it into both the opening request
 * and every choice-driven continuation. topicTags stay unset (PR-B follow-up).
 *
 * Run: npx vitest run tests/dialogue/converseSceneContext.test.ts
 */
import { describe, it, expect } from "vitest";
import { deriveConverseSceneContext } from "../../src/ui/converseScene";
import { assembleDialogueRequest, produceDialogueTurn } from "../../src/engine/dialogue/orchestrator";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const OTHER = "wei_sui"; // an unrelated consort who might co-reside in the broad location
const LOC = "zichendian";

describe("deriveConverseSceneContext", () => {
  it("carries no extra bystanders (orchestrator adds speaker+target) and is conservatively non-private", () => {
    const ctx = deriveConverseSceneContext(SPEAKER);
    expect(ctx.presentCharacterIds).toEqual([]);
    expect(ctx.privacy).toBe("semi_private");
  });

  it("does not set topicTags (left for PR-B)", () => {
    expect("topicTags" in deriveConverseSceneContext(SPEAKER)).toBe(false);
  });
});

describe("converse() initial request receives the derived context", () => {
  it("threads presence + privacy into the opening request's audience", () => {
    const ctx = deriveConverseSceneContext(SPEAKER);
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.promptContext.audience.privacy).toBe("semi_private");
    // Speaker is removed from their own audience; the conservative set is exactly {player}.
    expect(r.value.promptContext.audience.presentCharacterIds).toEqual(["player"]);
  });
});

describe("choice-driven continuation preserves the same context", () => {
  it("a continuation turn (with transcript) yields the same audience as the opening turn", () => {
    const ctx = deriveConverseSceneContext(SPEAKER);
    const first = assembleDialogueRequest(db, state, SPEAKER, LOC, ctx);
    const transcript = [
      { speaker: SPEAKER, text: "陛下安好。" },
      { speaker: "player", text: "朕来看看你。" },
    ];
    const cont = assembleDialogueRequest(db, state, SPEAKER, LOC, { ...ctx, transcript });
    expect(first.ok && cont.ok).toBe(true);
    if (!first.ok || !cont.ok) return;
    expect(cont.value.promptContext.audience).toEqual(first.value.promptContext.audience);
  });
});

describe("co-residents are not marked present", () => {
  it("an unrelated character in the same broad location is absent from audience.presentCharacterIds", () => {
    const ctx = deriveConverseSceneContext(SPEAKER);
    const derived = assembleDialogueRequest(db, state, SPEAKER, LOC, ctx);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.promptContext.audience.presentCharacterIds).not.toContain(OTHER);

    // Contrast: an "all residents present" context WOULD surface OTHER — proving the
    // assertion above is a real guard, not vacuously true.
    const naive = assembleDialogueRequest(db, state, SPEAKER, LOC, { presentCharacterIds: [SPEAKER, OTHER] });
    expect(naive.ok).toBe(true);
    if (!naive.ok) return;
    expect(naive.value.promptContext.audience.presentCharacterIds).toContain(OTHER);
  });
});

describe("scripted / fallback path is unchanged", () => {
  it("a scripted request (no scene context) still produces a scripted line", async () => {
    const text = "本宫累了，陛下早些歇息。";
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC, { scripted: { text } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Scripted path keeps the default conservative privacy and unchanged behavior.
    expect(r.value.promptContext.audience.privacy).toBe("semi_private");
    const turn = await produceDialogueTurn(db, mockProvider, r.value, state);
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.value.line.text).toBe(text);
    expect(turn.value.line.meta.generated).toBe(false);
    expect(turn.value.nextState).toBe(state);
  });
});
