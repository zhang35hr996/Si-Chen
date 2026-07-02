import { describe, expect, it } from "vitest";
import { assembleDialogueRequest, produceDialogueTurn } from "../../src/engine/dialogue/orchestrator";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import type { DialogueProvider, DialogueRequest } from "../../src/engine/dialogue/types";
import type { DialogueProviderResult } from "../../src/engine/dialogue/providerContract";
import { RingBufferLogger } from "../../src/engine/infra/logger";
import { ok } from "../../src/engine/infra/result";
import { createNewGameState } from "../../src/engine/state/newGame";
import { withConsort } from "../helpers/consortFixture";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const state = ["shen_zhibai","lu_huaijin"].reduce((st, id) => withConsort(st, db, id), createNewGameState(db));

// Scripted request — for use with scripted (mockProvider-kind) providers
const requestFor = (speakerId: string, text = "台词。"): DialogueRequest => {
  const r = assembleDialogueRequest(db, state, speakerId, "zichendian", { scripted: { text } });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

// Generative request (no scripted field) — for use with generative providers
const requestForGen = (speakerId: string): DialogueRequest => {
  const r = assembleDialogueRequest(db, state, speakerId, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

// Helper: produces a line via the unified entry point
const produceLine = (provider: typeof mockProvider | DialogueProvider, request: DialogueRequest) =>
  produceDialogueTurn(db, provider, request, state);

describe("assembleDialogueRequest carries the full future-AI context", () => {
  it("profile, voice, standing+selfRefs, memories(激活), stances, etiquette, GameTime", () => {
    const request = requestFor("shen_zhibai");
    expect(request.speakerContext.profile.name).toBe("沈知白");
    expect(request.speakerContext.standing).toMatchObject({ rank: "huanghou", favor: 25 });
    expect(request.speakerContext.standing.selfRefs.toPlayer).toEqual(["臣侍"]);
    // shen_zhibai has a permanent-retention authored memory that survives the retrieval threshold
    expect(request.speakerContext.relevantMemories.length).toBeGreaterThan(0);
    expect(request.speakerContext.relevantMemories[0]!.ownerId).toBe("shen_zhibai");
    expect(request.speakerContext.stances?.[0]?.charId).toBe("lu_huaijin");
    expect(request.etiquette.forbiddenTerms).toContain("父皇");
    expect(request.etiquette.addressRules).toHaveLength(28);
    expect(request.time).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect("ap" in request.time).toBe(false); // a speaker doesn't know the player's AP
    expect(assembleDialogueRequest(db, state, "char_ghost", "zichendian").ok).toBe(false);
  });
});

describe("produceDialogueTurn validation gates (v0 subset)", () => {
  it("mock provider echoes authored text; meta.generated false", async () => {
    const result = await produceLine(mockProvider, requestFor("wei_sui", "依典制行事。"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe("依典制行事。");
    expect(result.value.line.speakerName).toBe("卫绥");
    expect(result.value.line.meta).toEqual({ generated: false, degraded: false });
  });

  it("mock provider refuses non-scripted requests → ProviderError surfaces as mapped GameError", async () => {
    const request = { ...requestFor("shen_zhibai") };
    delete request.scripted;
    // Direct generate call returns ProviderError
    const providerResult = await mockProvider.generate(request);
    expect(providerResult.ok).toBe(false);
    if (!providerResult.ok) {
      const e = providerResult.error;
      expect(e.kind).toBe("config");
      if (e.kind === "config") expect(e.cause).toBe("not_configured");
    }
    // Through orchestrator: scripted provider without scripted text → PROVIDER_CONFIG
    const lineResult = await produceLine(mockProvider, request);
    expect(lineResult.ok).toBe(false);
    if (!lineResult.ok) expect(lineResult.error.code).toBe("PROVIDER_CONFIG");
  });

  it("wrong-speaker responses are rejected; unknown expressions normalize to neutral", async () => {
    const wrongSpeaker: DialogueProvider = {
      id: "fake",
      kind: "generative",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate: () => Promise.resolve(ok<DialogueProviderResult>({ speaker: "chu_he", text: "我是谁？", choices: [], proposedClaims: [] })),
    };
    const rejected = await produceLine(wrongSpeaker, requestForGen("shen_zhibai"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("WRONG_SPEAKER");

    const weirdFace: DialogueProvider = {
      id: "fake",
      kind: "generative",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate: (req) =>
        Promise.resolve(ok<DialogueProviderResult>({ speaker: req.speakerId, text: "……", expression: "ecstatic", choices: [], proposedClaims: [] })),
    };
    const normalized = await produceLine(weirdFace, requestForGen("shen_zhibai"));
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.line.expression).toBe("neutral");
      expect(normalized.value.line.meta.generated).toBe(true); // generative provider flagged
    }
  });

  // → anthropicProvider.test.ts (Task 5): malformed-response/schema parse is now adapter-side
  it.skip("malformed responses fail the schema gate", async () => {
    // This case moves to the Anthropic adapter test (Task 5), where the adapter
    // is responsible for parsing the raw wire response. The orchestrator now
    // receives an already-parsed DialogueProviderResult from the provider.
  });
});

describe("produceDialogueTurn text gates (PR 11)", () => {
  const speaking = (text: string, choices: { id: string; text: string }[] = []): DialogueProvider => ({
    id: "fake",
    kind: "generative",
    capabilities: { strictTools: false, promptCaching: false, batch: false },
    generate: (req) => Promise.resolve(ok<DialogueProviderResult>({ speaker: req.speakerId, text, choices, proposedClaims: [] })),
  });

  it("rejects output containing a forbidden lexicon term", async () => {
    const result = await produceLine(speaking("娘娘圣明。"), requestForGen("shen_zhibai"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GATE_REJECTED");
  });

  it("rejects a speaker borrowing another rank's selfRef", async () => {
    // 承徽 (臣侍 tier) borrowing 少使/贵人 tier's 侍身 (侍身 is foreign to chenghui who uses 臣侍).
    const result = await produceLine(speaking("侍身自有主张。"), requestForGen("lu_huaijin"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GATE_REJECTED");
      expect(result.error.context?.findings).toContainEqual({ gate: "self_ref", matched: "侍身" });
    }
  });

  it("rejects leaked template tokens", async () => {
    const result = await produceLine(speaking("{{speakerName}}启奏。"), requestForGen("shen_zhibai"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GATE_REJECTED");
  });

  it("rejects forbidden terms in a player choice (content gates apply to choices)", async () => {
    const result = await produceLine(
      speaking("本宫有一事启奏。", [{ id: "c", text: "传旨给那嫔妃。" }]),
      requestForGen("shen_zhibai"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GATE_REJECTED");
  });

  it("logs gate findings so they surface in debug diagnostics", async () => {
    const logger = new RingBufferLogger();
    await produceDialogueTurn(db, speaking("万岁爷圣明。"), requestForGen("shen_zhibai"), state, { logger });
    const entries = logger.entries();
    expect(entries.some((e) => e.message.includes("AiError:GATE_FORBIDDEN_LEXICON"))).toBe(true);
  });

  it("clean generated output passes every gate", async () => {
    // shen_zhibai (皇后) speaks to the emperor — selfRef is 臣侍, not 本宫
    const result = await produceLine(speaking("臣侍告退，陛下早些歇息。"), requestForGen("shen_zhibai"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.line.meta).toEqual({ generated: true, degraded: false });
  });

  it("speakerName recomposes from surname + 位分", async () => {
    const result = await produceLine(speaking("……臣侍知罪。"), requestForGen("lu_huaijin"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.line.speakerName).toBe("陆承徽");
  });
});
