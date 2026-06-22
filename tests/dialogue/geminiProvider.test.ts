import { describe, it, expect } from "vitest";
import {
  createGeminiProvider,
  sanitizeJsonSchemaForGemini,
  type GeminiTransport,
} from "../../src/engine/dialogue/providers/geminiProvider";
import { ok, err } from "../../src/engine/infra/result";
import { makeDialogueRequest } from "../../tools/fixtures/dialogueRequest";

describe("sanitizeJsonSchemaForGemini", () => {
  it("strips additionalProperties, $schema, default deeply", () => {
    const out = sanitizeJsonSchemaForGemini({
      type: "object",
      additionalProperties: false,
      $schema: "x",
      properties: {
        proposedClaims: {
          type: "array",
          default: [],
          items: { type: "object", additionalProperties: false },
        },
      },
    }) as any;
    expect(out.additionalProperties).toBeUndefined();
    expect(out.$schema).toBeUndefined();
    expect(out.properties.proposedClaims.default).toBeUndefined();
    expect(out.properties.proposedClaims.items.additionalProperties).toBeUndefined();
    expect(out.properties.proposedClaims.type).toBe("array");
  });
});

describe("geminiProvider", () => {
  it("parses functionCalls[0].args into DialogueProviderResult", async () => {
    const transport: GeminiTransport = {
      send: async () =>
        ok({
          functionCalls: [{ name: "emit_dialogue_line", args: { text: "臣妾告退。", proposedClaims: [] } }],
          finishReason: "STOP",
          usage: { promptTokenCount: 80, candidatesTokenCount: 12, cachedContentTokenCount: 10 },
          requestId: "g_1",
        }),
    };
    const provider = createGeminiProvider({ model: "gemini-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.text).toBe("臣妾告退。");
      // promptTokenCount=80 (TOTAL incl. 10 cached) → uncached 70, total 80
      expect(res.value.usage).toEqual({
        uncachedInputTokens: 70,
        totalInputTokens: 80,
        outputTokens: 12,
        cacheReadTokens: 10,
      });
      expect(res.value.providerMeta).toMatchObject({ provider: "google", model: "gemini-x" });
    }
  });

  it("maps missing function call to protocol/no_tool_call", async () => {
    const transport: GeminiTransport = { send: async () => ok({ functionCalls: [], finishReason: "STOP" }) };
    const provider = createGeminiProvider({ model: "gemini-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "protocol", cause: "no_tool_call" });
  });

  it("maps SAFETY finishReason to refused", async () => {
    const transport: GeminiTransport = { send: async () => ok({ functionCalls: [], finishReason: "SAFETY" }) };
    const provider = createGeminiProvider({ model: "gemini-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "refused" });
  });

  it("maps a 429 transport failure to transport/rate_limit", async () => {
    const transport: GeminiTransport = { send: async () => err({ kind: "http", status: 429 }) };
    const provider = createGeminiProvider({ model: "gemini-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "transport", cause: "rate_limit" });
  });
});
