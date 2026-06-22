import { describe, it, expect } from "vitest";
import { createDialogueProvider } from "../../src/engine/dialogue/providers/remoteProvider";
import { okTransport, makeRequest } from "./fixtures/anthropic";
import { ok } from "../../src/engine/infra/result";
import type { OpenAITransport } from "../../src/engine/dialogue/providers/openaiProvider";
import type { GeminiTransport } from "../../src/engine/dialogue/providers/geminiProvider";

describe("createDialogueProvider routing", () => {
  it("openai + injected transport → routed to the openai adapter", async () => {
    const transport: OpenAITransport = {
      send: async () =>
        ok({
          message: {
            finish_reason: "tool_calls",
            tool_calls: [{ function: { name: "emit_dialogue_line", arguments: JSON.stringify({ text: "臣妾遵旨。", proposedClaims: [] }) } }],
          },
        }),
    };
    const provider = createDialogueProvider({ model: { provider: "openai", model: "gpt-x" }, transport });
    expect(provider.id).toContain("openai");
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.providerMeta?.provider).toBe("openai");
  });

  it("google + injected transport → routed to the gemini adapter", async () => {
    const transport: GeminiTransport = {
      send: async () => ok({ functionCalls: [{ name: "emit_dialogue_line", args: { text: "臣妾遵旨。", proposedClaims: [] } }], finishReason: "STOP" }),
    };
    const provider = createDialogueProvider({ model: { provider: "google", model: "gemini-x" }, transport });
    expect(provider.id).toContain("google");
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.providerMeta?.provider).toBe("google");
  });

  it("openai WITHOUT transport → config/not_configured", async () => {
    const r = await createDialogueProvider({ model: { provider: "openai", model: "x" } }).generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "config", cause: "not_configured" });
  });

  it("anthropic + injected transport → routed to the adapter", async () => {
    const provider = createDialogueProvider({ model: { provider: "anthropic", model: "claude-sonnet-4-6" }, transport: okTransport({ text: "臣妾遵旨。", proposedClaims: [] }) });
    expect(provider.capabilities.strictTools).toBe(true);
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true); if (r.ok) expect(r.value.providerMeta?.provider).toBe("anthropic");
  });
  it("anthropic WITHOUT transport → config/not_configured (no SDK in engine)", async () => {
    const r = await createDialogueProvider({ model: { provider: "anthropic", model: "x" } }).generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "config", cause: "not_configured" });
  });
  it("unimplemented provider → config/not_configured", async () => {
    const r = await createDialogueProvider({ model: { provider: "deepseek", model: "x" } }).generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "config", cause: "not_configured" });
  });
});
