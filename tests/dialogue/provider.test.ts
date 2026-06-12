import { describe, expect, it } from "vitest";
import { assembleDialogueRequest, produceDialogueLine } from "../../src/engine/dialogue/orchestrator";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import type { DialogueProvider, DialogueRequest } from "../../src/engine/dialogue/types";
import { ok } from "../../src/engine/infra/result";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const state = createNewGameState(db);

const requestFor = (speakerId: string, text = "台词。"): DialogueRequest => {
  const r = assembleDialogueRequest(db, state, speakerId, "yushufang", { text });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe("assembleDialogueRequest carries the full future-AI context", () => {
  it("profile, voice, relationship, standing+selfRefs, empty memories, stances, etiquette, GameTime", () => {
    const request = requestFor("feng_hou");
    expect(request.speakerContext.profile.name).toBe("凤后");
    expect(request.speakerContext.relationship).toEqual({ trust: 35, affinity: 20, flags: [] });
    expect(request.speakerContext.standing).toMatchObject({ rank: "fenghou", favor: 25 });
    expect(request.speakerContext.standing.selfRefs.toPlayer).toEqual(["臣后"]);
    expect(request.speakerContext.relevantMemories).toEqual([]); // field rides along, v0 empty
    expect(request.speakerContext.stances?.[0]?.charId).toBe("shen_chenghui");
    expect(request.etiquette.forbiddenTerms).toContain("父皇");
    expect(request.etiquette.addressRules).toHaveLength(3);
    expect(request.time).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect("ap" in request.time).toBe(false); // a speaker doesn't know the player's AP
    expect(assembleDialogueRequest(db, state, "char_ghost", "yushufang").ok).toBe(false);
  });
});

describe("produceDialogueLine validation gates (v0 subset)", () => {
  it("mock provider echoes authored text; meta.generated false", async () => {
    const result = await produceDialogueLine(db, mockProvider, requestFor("sili_nvguan", "依典制行事。"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe("依典制行事。");
    expect(result.value.speakerName).toBe("司礼女官");
    expect(result.value.meta).toEqual({ generated: false, degraded: false });
  });

  it("mock provider refuses non-scripted requests", async () => {
    const request = { ...requestFor("feng_hou") };
    delete request.scripted;
    const result = await mockProvider.generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_SCRIPT");
  });

  it("wrong-speaker responses are rejected; unknown expressions normalize to neutral", async () => {
    const wrongSpeaker: DialogueProvider = {
      id: "fake",
      kind: "generative",
      generate: () => Promise.resolve(ok({ speaker: "chu_he", text: "我是谁？", choices: [] })),
    };
    const rejected = await produceDialogueLine(db, wrongSpeaker, requestFor("feng_hou"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("WRONG_SPEAKER");

    const weirdFace: DialogueProvider = {
      id: "fake",
      kind: "generative",
      generate: (req) =>
        Promise.resolve(ok({ speaker: req.speakerId, text: "……", expression: "ecstatic", choices: [] })),
    };
    const normalized = await produceDialogueLine(db, weirdFace, requestFor("feng_hou"));
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.expression).toBe("neutral");
      expect(normalized.value.meta.generated).toBe(true); // generative provider flagged
    }
  });

  it("malformed responses fail the schema gate", async () => {
    const garbage: DialogueProvider = {
      id: "fake",
      kind: "generative",
      generate: () =>
        Promise.resolve(ok({ speaker: "feng_hou", text: "", choices: [] } as never)),
    };
    const result = await produceDialogueLine(db, garbage, requestFor("feng_hou"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MALFORMED");
  });
});
