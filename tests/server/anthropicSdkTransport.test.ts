import { describe, expect, it, vi } from "vitest";
import type { AnthropicRequestPayload } from "../../src/engine/dialogue/providers/anthropicProvider";

// 用 vi.mock 替换 SDK，不发真实网络请求
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  function MockAnthropic() { return { messages: { create: mockCreate } }; }
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

  it("成功：返回 ok(AnthropicTransportResult)，含 requestId", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    _mockCreate.mockResolvedValueOnce({
      id: "msg_01abc",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "臣妾遵旨。", proposedClaims: [] } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("test-key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.requestId).toBe("msg_01abc");
      expect(r.value.message.stop_reason).toBe("tool_use");
    }
  });

  it("401: 返回 err({ kind:'http', status:401 })", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    const e = Object.assign(new Error("auth"), { status: 401, headers: {} });
    _mockCreate.mockRejectedValueOnce(e);
    const { createAnthropicSdkTransport } = await import("../../server/llm/anthropicSdkTransport");
    const transport = createAnthropicSdkTransport("bad-key");
    const r = await transport.send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 401 });
  });

  it("429: 返回 err({ kind:'http', status:429 })，含 retryAfterMs", async () => {
    const { _mockCreate } = await import("@anthropic-ai/sdk") as any;
    const e = Object.assign(new Error("rate limit"), { status: 429, headers: { "retry-after": "2" } });
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
