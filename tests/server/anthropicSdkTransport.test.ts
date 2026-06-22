import { describe, expect, it, vi } from "vitest";
import type { AnthropicRequestPayload } from "../../src/engine/dialogue/providers/anthropicProvider";

// 用 vi.mock 替换 SDK，不发真实网络请求
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const mockCreate = vi.fn();
  function MockAnthropic() { return { messages: { create: mockCreate } }; }
  // Preserve real error classes from the SDK
  MockAnthropic.APIError = original.default.APIError;
  MockAnthropic.APIUserAbortError = original.default.APIUserAbortError;
  MockAnthropic.APIConnectionError = original.default.APIConnectionError;
  MockAnthropic.APIConnectionTimeoutError = original.default.APIConnectionTimeoutError;
  return { default: MockAnthropic, _mockCreate: mockCreate };
});

describe("AnthropicSdkTransport", () => {
  const minimalPayload: AnthropicRequestPayload = {
    model: "claude-sonnet-4-6",
    max_tokens: 100,
    system: [{ type: "text", text: "s" }],
    messages: [{ role: "user", content: "u" }],
    tools: [],
    tool_choice: { type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true },
  };

  it("成功：返回 ok(AnthropicTransportResult)，含 requestId from _request_id", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    _mockCreate.mockResolvedValueOnce(
      Object.assign(
        {
          id: "msg_01abc",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "臣妾遵旨。", proposedClaims: [] } }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        { _request_id: "req_01xyz" },
      ),
    );
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("test-key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // requestId should be _request_id (HTTP request ID), not msg.id (message ID)
      expect(r.value.requestId).toBe("req_01xyz");
      expect(r.value.message.stop_reason).toBe("tool_use");
    }
  });

  it("成功（无 _request_id）：requestId 为 undefined", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    _mockCreate.mockResolvedValueOnce({
      id: "msg_01abc",
      stop_reason: "tool_use",
      content: [],
      usage: {},
    });
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("test-key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.requestId).toBeUndefined();
    }
  });

  it("401: 返回 err({ kind:'http', status:401 })", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    const e = new Anthropic.APIError(401, {}, "Unauthorized", new Headers());
    _mockCreate.mockRejectedValueOnce(e);
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("bad-key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 401 });
  });

  it("429: 返回 err({ kind:'http', status:429 })，含 retryAfterMs", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    const e = new Anthropic.APIError(429, {}, "Rate limit", new Headers({ "retry-after": "2" }));
    _mockCreate.mockRejectedValueOnce(e);
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ kind: "http", status: 429 });
      expect((r.error as any).retryAfterMs).toBe(2000);
    }
  });

  it("AbortError → err({ kind:'network', message:'aborted' })", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    const e = new Anthropic.APIUserAbortError();
    _mockCreate.mockRejectedValueOnce(e);
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "network", message: "aborted" });
  });

  it("网络错误（无 status）: 返回 err({ kind:'network' })", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    _mockCreate.mockRejectedValueOnce(new Error("ECONNRESET"));
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("network");
  });
});
