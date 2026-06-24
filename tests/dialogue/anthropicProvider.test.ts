import { describe, it, expect } from "vitest";
import { createAnthropicProvider, buildAnthropicToolRequest, WORLD_RULES_TEXT, renderEtiquetteBlock } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okTransport, makeRequest, hangingTransport, msg, msgTransport, failTransport } from "./fixtures/anthropic";
import type { AnthropicTransport } from "../../src/engine/dialogue/providers/anthropicProvider";
import { assembleDialogueRequest } from "../../src/engine/dialogue/orchestrator";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";

describe("anthropicProvider — success", () => {
  it("forces a single tool, parses input, derives speaker, fills meta from envelope", async () => {
    let toolChoice: unknown;
    const transport: AnthropicTransport = { send: (p) => okTransport({ text: "本宫安好。", proposedClaims: [] }, "req_x").send(p).then((r) => { toolChoice = p.tool_choice; return r; }) };
    const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport });
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.speaker).toBe("shen_zhibai");
    expect(r.value.text).toBe("本宫安好。");
    expect(r.value.choices).toEqual([]);
    expect(r.value.providerMeta).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6", requestId: "req_x" });
    expect(provider.capabilities).toEqual({ strictTools: true, promptCaching: true, batch: false });
    expect(toolChoice).toEqual({ type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true });
  });
});

describe("anthropicProvider — usage normalization", () => {
  it("treats input_tokens as UNCACHED and folds cache read+creation into total", async () => {
    const transport = msgTransport(
      msg({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "安", proposedClaims: [] } }],
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 },
      }),
    );
    const provider = createAnthropicProvider({ model: "claude-x", transport });
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.usage).toEqual({
        uncachedInputTokens: 100,
        totalInputTokens: 150, // 100 uncached + 30 cache read + 20 cache creation
        outputTokens: 10,
        cacheReadTokens: 30,
        cacheCreationTokens: 20,
      });
    }
  });

  it("omits usage when input_tokens is missing (no faked zero)", async () => {
    const t = msgTransport(
      msg({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "安", proposedClaims: [] } }],
        usage: { output_tokens: 10 }, // input_tokens missing
      }),
    );
    const r = await createAnthropicProvider({ model: "claude-x", transport: t }).generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.usage).toBeUndefined();
  });

  it("preserves usage + requestId on a billed protocol failure (wrong stop_reason → no_tool_call)", async () => {
    const transport = msgTransport(
      msg({ stop_reason: "end_turn", content: [], usage: { input_tokens: 40, output_tokens: 0 } }),
    );
    const provider = createAnthropicProvider({ model: "claude-x", transport });
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ kind: "protocol", cause: "no_tool_call" });
      expect(r.error.meta?.usage).toMatchObject({ uncachedInputTokens: 40, totalInputTokens: 40, outputTokens: 0 });
      expect(r.error.meta?.requestId).toBe("req_f");
    }
  });
});

// ── WORLD_RULES_TEXT snapshot ─────────────────────────────────────────────────

describe("WORLD_RULES_TEXT", () => {
  it("contains all 15 rule markers", () => {
    for (let i = 1; i <= 15; i++) {
      expect(WORLD_RULES_TEXT).toContain(`${i}.`);
    }
  });

  it("does not contain rule 16", () => {
    expect(WORLD_RULES_TEXT).not.toContain("16.");
  });

  it("instructs the model to fill mentionedContextRefs for used context", () => {
    expect(WORLD_RULES_TEXT).toContain("mentionedContextRefs");
  });

  it("contains key phrase 严禁替玩家发言", () => {
    expect(WORLD_RULES_TEXT).toContain("严禁替玩家发言");
  });

  it("contains key phrase 不得凭空引入", () => {
    expect(WORLD_RULES_TEXT).toContain("不得凭空引入");
  });

  it("contains sourceRefs", () => {
    expect(WORLD_RULES_TEXT).toContain("sourceRefs");
  });

  it("contains forbiddenClaims", () => {
    expect(WORLD_RULES_TEXT).toContain("forbiddenClaims");
  });

  it("contains audience.privacy (not currentScene.audience.privacy)", () => {
    expect(WORLD_RULES_TEXT).toContain("audience.privacy");
    expect(WORLD_RULES_TEXT).not.toContain("currentScene.audience.privacy");
  });
});

describe("anthropic tool contract carries mentionedContextRefs", () => {
  const db = loadRealContent();
  const state = createNewGameState(db);
  function toolOf() {
    const req = assembleDialogueRequest(db, state, "shen_zhibai", "zichendian");
    if (!req.ok) throw new Error(req.error.message);
    return buildAnthropicToolRequest(req.value, "claude-sonnet-4-6").tools[0]!;
  }

  it("tool description mentions referenced context (not only 台词+事实)", () => {
    expect(toolOf().description).toContain("引用");
  });

  it("tool input_schema includes mentionedContextRefs", () => {
    const schema = toolOf().input_schema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("mentionedContextRefs");
  });
});

// ── renderEtiquetteBlock ──────────────────────────────────────────────────────

describe("renderEtiquetteBlock", () => {
  const etiquette: import("../../src/engine/dialogue/types").DialogueRequest["etiquette"] = {
    allowedTerms: ["陛下", "圣上"],
    forbiddenTerms: ["皇上", "老爷"],
    addressRules: [
      { rank: "fenghou", selfRefs: { toPlayer: ["本宫"], formal: ["臣妾"] }, addressedAs: "陛下" },
    ],
  };
  const speakerSelfRefs: import("../../src/engine/content/schemas").CharacterRank["selfRefs"] = {
    toPlayer: ["本宫"],
    formal: ["臣妾"],
  };
  const audienceRole: import("../../src/engine/dialogue/reactionTypes").AudienceRole = "sovereign";

  it("includes allowedTerms", () => {
    const block = renderEtiquetteBlock(etiquette, speakerSelfRefs, audienceRole);
    expect(block).toContain("陛下");
    expect(block).toContain("圣上");
  });

  it("includes forbiddenTerms", () => {
    const block = renderEtiquetteBlock(etiquette, speakerSelfRefs, audienceRole);
    expect(block).toContain("皇上");
    expect(block).toContain("老爷");
  });

  it("includes addressRules content", () => {
    const block = renderEtiquetteBlock(etiquette, speakerSelfRefs, audienceRole);
    expect(block).toContain("fenghou");
  });

  it("includes speaker selfRefs.toPlayer", () => {
    const block = renderEtiquetteBlock(etiquette, speakerSelfRefs, audienceRole);
    expect(block).toContain("本宫");
  });

  it("includes audienceRole", () => {
    const block = renderEtiquetteBlock(etiquette, speakerSelfRefs, audienceRole);
    expect(block).toContain("sovereign");
  });
});

// ── buildAnthropicToolRequest — caching structure ─────────────────────────────

describe("buildAnthropicToolRequest — caching structure", () => {
  const req = makeRequest("shen_zhibai");

  it("system has exactly 2 blocks", () => {
    const payload = buildAnthropicToolRequest(req, "claude-sonnet-4-6");
    expect(payload.system).toHaveLength(2);
  });

  it("all system blocks have cache_control.type === ephemeral", () => {
    const payload = buildAnthropicToolRequest(req, "claude-sonnet-4-6");
    for (const block of payload.system) {
      expect(block.cache_control).toEqual({ type: "ephemeral" });
    }
  });

  it("system.length stays 2 regardless of request content", () => {
    const reqWithDirective = makeRequest("shen_zhibai");
    // Inject sceneDirective to test it doesn't add a 3rd block
    (reqWithDirective as unknown as Record<string, unknown>).sceneDirective = "今日风雪。";
    const payload = buildAnthropicToolRequest(reqWithDirective, "claude-sonnet-4-6");
    expect(payload.system).toHaveLength(2);
  });

  it("messages[0].content includes speaker.standing.kind", () => {
    const payload = buildAnthropicToolRequest(req, "claude-sonnet-4-6");
    const content = payload.messages[0]!.content;
    expect(content).toContain("kind");
  });

  it("messages[0].content includes currentScene.directive when sceneDirective set", () => {
    const db2 = loadRealContent();
    const state2 = createNewGameState(db2);
    const r2 = assembleDialogueRequest(db2, state2, "shen_zhibai", "zichendian", { sceneDirective: "今日风雪，气氛压抑。" });
    if (!r2.ok) return;
    const payload = buildAnthropicToolRequest(r2.value, "claude-sonnet-4-6");
    const content = payload.messages[0]!.content;
    expect(content).toContain("今日风雪，气氛压抑。");
  });

  it("messages[0].content has no ownerId", () => {
    const payload = buildAnthropicToolRequest(req, "claude-sonnet-4-6");
    const content = payload.messages[0]!.content;
    expect(content).not.toContain("ownerId");
  });

  it("capabilities.promptCaching === true", () => {
    const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport: { send: async () => ({ ok: false, error: { kind: "offline" } } as never) } });
    expect(provider.capabilities.promptCaching).toBe(true);
  });
});

describe("anthropicProvider — deadline & cancel", () => {
  it("pre-aborted caller signal → cancelled, transport never called", async () => {
    let called = false;
    const t: AnthropicTransport = { send: () => { called = true; return Promise.resolve({ ok: true } as never); } };
    const ac = new AbortController(); ac.abort();
    const r = await createAnthropicProvider({ model: "claude-sonnet-4-6", transport: t }).generate(makeRequest("shen_zhibai"), { signal: ac.signal });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "cancelled" });
    expect(called).toBe(false);
  });
  it("timeout fires (even if transport ignores signal) → transport/timeout retryable", async () => {
    const r = await createAnthropicProvider({ model: "claude-sonnet-4-6", transport: hangingTransport() }).generate(makeRequest("shen_zhibai"), { timeoutMs: 5 });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "transport", cause: "timeout", retryable: true });
  });
  it("caller aborts mid-flight → cancelled (not retryable)", async () => {
    const ac = new AbortController();
    const p = createAnthropicProvider({ model: "claude-sonnet-4-6", transport: hangingTransport() }).generate(makeRequest("shen_zhibai"), { signal: ac.signal, timeoutMs: 10000 });
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "cancelled", retryable: false });
  });
});

const run = (t: ReturnType<typeof msgTransport>) => createAnthropicProvider({ model: "claude-sonnet-4-6", transport: t }).generate(makeRequest("shen_zhibai"));
const expectErr = async (p: Promise<{ ok: boolean }>, m: object) => { const x = await p as { ok: boolean; error?: object }; expect(x.ok).toBe(false); if (!x.ok) expect(x.error).toMatchObject(m); };

describe("anthropicProvider — protocol classification", () => {
  it("wrong tool", () => expectErr(run(msgTransport(msg({ content: [{ type: "tool_use", name: "other", input: {} }] }))), { kind: "protocol", cause: "wrong_tool", retryable: true }));
  it("multiple tool calls", () => expectErr(run(msgTransport(msg({ content: [
    { type: "tool_use", name: "emit_dialogue_line", input: { text: "a", proposedClaims: [] } },
    { type: "tool_use", name: "emit_dialogue_line", input: { text: "b", proposedClaims: [] } }] }))), { kind: "protocol", cause: "multiple_tool_calls", retryable: true }));
  it("max_tokens → truncated", () => expectErr(run(msgTransport(msg({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "半", proposedClaims: [] } }] }))), { kind: "protocol", cause: "truncated", retryable: true }));
  it("refusal → refused", () => expectErr(run(msgTransport(msg({ stop_reason: "refusal" }))), { kind: "refused" }));
  it("pause_turn → protocol NOT retryable", () => expectErr(run(msgTransport(msg({ stop_reason: "pause_turn" }))), { kind: "protocol", cause: "pause_turn", retryable: false }));
  it("context exceeded → config/request_too_large", () => expectErr(run(msgTransport(msg({ stop_reason: "model_context_window_exceeded" }))), { kind: "config", cause: "request_too_large" }));
  it("end_turn no tool → no_tool_call", () => expectErr(run(msgTransport(msg({ stop_reason: "end_turn", content: [{ type: "text" }] }))), { kind: "protocol", cause: "no_tool_call", retryable: true }));
  it("invalid tool input → schema_invalid", () => expectErr(run(msgTransport(msg({ content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "", proposedClaims: [] } }] }))), { kind: "protocol", cause: "schema_invalid", retryable: true }));
});

describe("anthropicProvider — transport-failure classification", () => {
  const fail = (f: Parameters<typeof failTransport>[0]) => createAnthropicProvider({ model: "claude-sonnet-4-6", transport: failTransport(f) }).generate(makeRequest("shen_zhibai"));
  it("offline → offline (not retryable)", () => expectErr(fail({ kind: "offline" }), { kind: "offline", retryable: false }));
  it("network → transport/network", () => expectErr(fail({ kind: "network" }), { kind: "transport", cause: "network" }));
  it("http 400 → config/invalid_request", () => expectErr(fail({ kind: "http", status: 400 }), { kind: "config", cause: "invalid_request", retryable: false }));
  it("http 401 → config/auth", () => expectErr(fail({ kind: "http", status: 401 }), { kind: "config", cause: "auth" }));
  it("http 402 → config/billing", () => expectErr(fail({ kind: "http", status: 402 }), { kind: "config", cause: "billing" }));
  it("http 404 → config/model_not_found", () => expectErr(fail({ kind: "http", status: 404 }), { kind: "config", cause: "model_not_found" }));
  it("http 408 → transport/timeout (retryable)", () => expectErr(fail({ kind: "http", status: 408 }), { kind: "transport", cause: "timeout", retryable: true }));
  it("http 413 → config/request_too_large", () => expectErr(fail({ kind: "http", status: 413 }), { kind: "config", cause: "request_too_large" }));
  it("http 422 (other 4xx) → config/invalid_request (not retryable)", () => expectErr(fail({ kind: "http", status: 422 }), { kind: "config", cause: "invalid_request", retryable: false }));
  it("http 429 → transport/rate_limit + retryAfterMs", () => expectErr(fail({ kind: "http", status: 429, retryAfterMs: 2000, requestId: "req_429" }), { kind: "transport", cause: "rate_limit", meta: { retryAfterMs: 2000, requestId: "req_429" } }));
  it("http 503 → transport/5xx", () => expectErr(fail({ kind: "http", status: 503 }), { kind: "transport", cause: "5xx" }));
});
