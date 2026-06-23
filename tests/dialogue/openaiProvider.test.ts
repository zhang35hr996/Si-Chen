import { describe, it, expect } from "vitest";
import { createOpenAIProvider, buildOpenAIToolRequest, type OpenAITransport } from "../../src/engine/dialogue/providers/openaiProvider";
import { ok, err } from "../../src/engine/infra/result";
import { makeDialogueRequest } from "../../tools/fixtures/dialogueRequest";

describe("openai tool contract carries mentionedContextRefs", () => {
  const req = buildOpenAIToolRequest(makeDialogueRequest(), "gpt-4o");
  it("system message includes the mentionedContextRefs rule", () => {
    expect(String(req.messages[0]!.content)).toContain("mentionedContextRefs");
  });
  it("tool description mentions referenced context", () => {
    expect(req.tools[0]!.function.description).toContain("引用");
  });
});

function transportReturning(args: object): OpenAITransport {
  return {
    send: async () =>
      ok({
        message: {
          finish_reason: "tool_calls",
          tool_calls: [{ function: { name: "emit_dialogue_line", arguments: JSON.stringify(args) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 30 } },
        },
        requestId: "req_1",
      }),
  };
}

describe("openaiProvider", () => {
  it("parses a forced tool call into DialogueProviderResult", async () => {
    const provider = createOpenAIProvider({
      model: "gpt-x",
      transport: transportReturning({ text: "臣妾参见陛下。", proposedClaims: [] }),
    });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.text).toBe("臣妾参见陛下。");
      expect(res.value.providerMeta).toMatchObject({ provider: "openai", model: "gpt-x" });
    }
  });

  it("normalizes OpenAI prompt_tokens (TOTAL, incl. cache) into uncached + total", async () => {
    // prompt_tokens=100 includes 30 cached → uncached 70, total 100, no cache creation
    const provider = createOpenAIProvider({ model: "gpt-x", transport: transportReturning({ text: "好", proposedClaims: [] }) });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.usage).toEqual({
        uncachedInputTokens: 70,
        totalInputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
      });
    }
  });

  it("preserves usage + requestId on a billed protocol failure (no_tool_call)", async () => {
    const transport: OpenAITransport = {
      send: async () =>
        ok({
          message: { finish_reason: "stop", tool_calls: [], usage: { prompt_tokens: 50, completion_tokens: 0 } },
          requestId: "req_billed",
        }),
    };
    const provider = createOpenAIProvider({ model: "gpt-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatchObject({ kind: "protocol", cause: "no_tool_call" });
      expect(res.error.meta?.usage).toEqual({ uncachedInputTokens: 50, totalInputTokens: 50, outputTokens: 0 });
      expect(res.error.meta?.requestId).toBe("req_billed");
    }
  });

  it("omits usage when a required token field is missing (no faked zero)", async () => {
    const transport: OpenAITransport = {
      send: async () =>
        ok({
          message: {
            finish_reason: "tool_calls",
            tool_calls: [{ function: { name: "emit_dialogue_line", arguments: JSON.stringify({ text: "好", proposedClaims: [] }) } }],
            usage: { completion_tokens: 20 }, // prompt_tokens missing → usage not trustworthy
          },
        }),
    };
    const provider = createOpenAIProvider({ model: "gpt-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.usage).toBeUndefined();
  });

  it("maps schema-invalid tool args to protocol/schema_invalid", async () => {
    const provider = createOpenAIProvider({
      model: "gpt-x",
      transport: transportReturning({ text: "" }), // empty text violates min(1)
    });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "protocol", cause: "schema_invalid" });
  });

  it("maps a 401 transport failure to config/auth", async () => {
    const transport: OpenAITransport = { send: async () => err({ kind: "http", status: 401 }) };
    const provider = createOpenAIProvider({ model: "gpt-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "config", cause: "auth" });
  });
});
