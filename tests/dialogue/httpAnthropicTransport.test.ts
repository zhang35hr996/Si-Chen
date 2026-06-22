import { describe, expect, it, vi, afterEach } from "vitest";
import type { AnthropicRequestPayload } from "../../src/engine/dialogue/providers/anthropicProvider";

const minimalPayload: AnthropicRequestPayload = {
  model: "claude-sonnet-4-6", max_tokens: 100,
  system: [{ type: "text", text: "s" }],
  messages: [{ role: "user", content: "u" }],
  tools: [], tool_choice: { type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true },
};

function mockFetch(status: number, body: unknown, headers?: Record<string, string>) {
  const hdrs = new Headers(headers ?? {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => hdrs.get(k) },
    json: async () => body,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("HttpAnthropicTransport", () => {
  it("200: 返回 ok(AnthropicTransportResult)", async () => {
    const envelope = {
      message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "emit_dialogue_line", input: {} }], usage: {} },
      requestId: "msg_02",
    };
    mockFetch(200, envelope);
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const t = createHttpAnthropicTransport();
    const r = await t.send(minimalPayload);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.requestId).toBe("msg_02");
  });

  it("401: err({ kind:'http', status:401 })", async () => {
    mockFetch(401, { error: "auth failed" });
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 401 });
  });

  it("429 + Retry-After: err({ kind:'http', status:429, retryAfterMs:5000 })", async () => {
    mockFetch(429, { error: "rate limit" }, { "Retry-After": "5" });
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 429, retryAfterMs: 5000 });
  });

  it("500: err({ kind:'http', status:500 })", async () => {
    mockFetch(500, { error: "internal" });
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "http", status: 500 });
  });

  it("AbortError → err({ kind:'network', message:'aborted' })", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("The user aborted"), { name: "AbortError" })));
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await createHttpAnthropicTransport().send(minimalPayload, { signal: ctrl.signal });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.kind).toBe("network"); }
  });

  it("fetch TypeError + navigator.onLine=false (offline) → err({ kind:'offline' })", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.stubGlobal("navigator", { onLine: false });
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("offline");
  });

  it("fetch TypeError + navigator.onLine=true → err({ kind:'network' })", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.stubGlobal("navigator", { onLine: true });
    const { createHttpAnthropicTransport } = await import("../../src/engine/dialogue/providers/httpAnthropicTransport");
    const r = await createHttpAnthropicTransport().send(minimalPayload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("network");
  });
});
