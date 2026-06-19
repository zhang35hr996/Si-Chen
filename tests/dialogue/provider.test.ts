import { describe, expect, it } from "vitest";
import { assembleDialogueRequest, produceDialogueLine } from "../../src/engine/dialogue/orchestrator";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import type { DialogueProvider, DialogueRequest } from "../../src/engine/dialogue/types";
import { RingBufferLogger } from "../../src/engine/infra/logger";
import { ok } from "../../src/engine/infra/result";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const state = createNewGameState(db);

const requestFor = (speakerId: string, text = "台词。"): DialogueRequest => {
  const r = assembleDialogueRequest(db, state, speakerId, "zichendian", { text });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe("assembleDialogueRequest carries the full future-AI context", () => {
  it("profile, voice, relationship, standing+selfRefs, empty memories, stances, etiquette, GameTime", () => {
    const request = requestFor("shen_zhibai");
    expect(request.speakerContext.profile.name).toBe("沈知白");
    expect(request.speakerContext.relationship).toEqual({ trust: 35, affinity: 20, flags: [] });
    expect(request.speakerContext.standing).toMatchObject({ rank: "fenghou", favor: 25 });
    expect(request.speakerContext.standing.selfRefs.toPlayer).toEqual(["臣后"]);
    expect(request.speakerContext.relevantMemories).toEqual([]); // field rides along, v0 empty
    expect(request.speakerContext.stances?.[0]?.charId).toBe("lu_huaijin");
    expect(request.etiquette.forbiddenTerms).toContain("父皇");
    expect(request.etiquette.addressRules).toHaveLength(21);
    expect(request.time).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect("ap" in request.time).toBe(false); // a speaker doesn't know the player's AP
    expect(assembleDialogueRequest(db, state, "char_ghost", "zichendian").ok).toBe(false);
  });
});

describe("produceDialogueLine validation gates (v0 subset)", () => {
  it("mock provider echoes authored text; meta.generated false", async () => {
    const result = await produceDialogueLine(db, mockProvider, requestFor("wei_sui", "依典制行事。"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe("依典制行事。");
    expect(result.value.speakerName).toBe("卫绥");
    expect(result.value.meta).toEqual({ generated: false, degraded: false });
  });

  it("mock provider refuses non-scripted requests", async () => {
    const request = { ...requestFor("shen_zhibai") };
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
    const rejected = await produceDialogueLine(db, wrongSpeaker, requestFor("shen_zhibai"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("WRONG_SPEAKER");

    const weirdFace: DialogueProvider = {
      id: "fake",
      kind: "generative",
      generate: (req) =>
        Promise.resolve(ok({ speaker: req.speakerId, text: "……", expression: "ecstatic", choices: [] })),
    };
    const normalized = await produceDialogueLine(db, weirdFace, requestFor("shen_zhibai"));
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
        Promise.resolve(ok({ speaker: "shen_zhibai", text: "", choices: [] } as never)),
    };
    const result = await produceDialogueLine(db, garbage, requestFor("shen_zhibai"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MALFORMED");
  });
});

describe("produceDialogueLine text gates (PR 11)", () => {
  const speaking = (text: string, choices: { id: string; text: string }[] = []): DialogueProvider => ({
    id: "fake",
    kind: "generative",
    generate: (req) => Promise.resolve(ok({ speaker: req.speakerId, text, choices })),
  });

  it("rejects output containing a forbidden lexicon term", async () => {
    const result = await produceDialogueLine(db, speaking("皇上圣明。"), requestFor("shen_zhibai"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GATE_REJECTED");
  });

  it("rejects a speaker borrowing another rank's selfRef", async () => {
    // 承徽 borrowing 凤后's 臣后 (本宫 is now a shared to-lower ref, no longer foreign).
    const result = await produceDialogueLine(db, speaking("臣后自有主张。"), requestFor("lu_huaijin"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GATE_REJECTED");
      expect(result.error.context?.findings).toContainEqual({ gate: "self_ref", matched: "臣后" });
    }
  });

  it("rejects leaked template tokens", async () => {
    const result = await produceDialogueLine(db, speaking("{{speakerName}}启奏。"), requestFor("shen_zhibai"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GATE_REJECTED");
  });

  it("rejects forbidden terms in a player choice (content gates apply to choices)", async () => {
    const result = await produceDialogueLine(
      db,
      speaking("本宫有一事启奏。", [{ id: "c", text: "传旨给那娘娘。" }]),
      requestFor("shen_zhibai"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GATE_REJECTED");
  });

  it("logs gate findings so they surface in debug diagnostics", async () => {
    const logger = new RingBufferLogger();
    await produceDialogueLine(db, speaking("圣上万安。"), requestFor("shen_zhibai"), logger);
    const entries = logger.entries();
    expect(entries.some((e) => e.message.includes("AiError:GATE_RANK_TITLE"))).toBe(true);
  });

  it("clean generated output passes every gate", async () => {
    const result = await produceDialogueLine(db, speaking("本宫累了，陛下早些歇息。"), requestFor("shen_zhibai"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta).toEqual({ generated: true, degraded: false });
  });

  it("speakerName recomposes from surname + 位分", async () => {
    const result = await produceDialogueLine(db, speaking("……侍身知罪。"), requestFor("lu_huaijin"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.speakerName).toBe("陆承徽");
  });
});
