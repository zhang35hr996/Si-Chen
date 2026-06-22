import { describe, it, expect } from "vitest";
import { createOpenAIProvider, type OpenAITransport } from "../../src/engine/dialogue/providers/openaiProvider";
import { ok, err } from "../../src/engine/infra/result";
import { makeDialogueRequest } from "../helpers/dialogueRequest";

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
      expect(res.value.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 });
      expect(res.value.providerMeta).toMatchObject({ provider: "openai", model: "gpt-x" });
    }
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

  it("maps missing tool call to protocol/no_tool_call", async () => {
    const transport: OpenAITransport = {
      send: async () => ok({ message: { finish_reason: "stop", tool_calls: [] } }),
    };
    const provider = createOpenAIProvider({ model: "gpt-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "protocol", cause: "no_tool_call" });
  });

  it("maps a 401 transport failure to config/auth", async () => {
    const transport: OpenAITransport = { send: async () => err({ kind: "http", status: 401 }) };
    const provider = createOpenAIProvider({ model: "gpt-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "config", cause: "auth" });
  });
});
