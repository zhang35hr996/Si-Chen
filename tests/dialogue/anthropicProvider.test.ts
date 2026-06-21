import { describe, it, expect } from "vitest";
import { createAnthropicProvider } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okTransport, makeRequest, hangingTransport, msg, msgTransport, failTransport } from "./fixtures/anthropic";
import type { AnthropicTransport } from "../../src/engine/dialogue/providers/anthropicProvider";

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
    expect(provider.capabilities).toEqual({ strictTools: true, promptCaching: false, batch: false });
    expect(toolChoice).toEqual({ type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true });
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
  it("wrong tool", () => expectErr(run(msgTransport(msg({ content: [{ type: "tool_use", name: "other", input: {} }] }))), { kind: "protocol", cause: "wrong_tool" }));
  it("multiple tool calls", () => expectErr(run(msgTransport(msg({ content: [
    { type: "tool_use", name: "emit_dialogue_line", input: { text: "a", proposedClaims: [] } },
    { type: "tool_use", name: "emit_dialogue_line", input: { text: "b", proposedClaims: [] } }] }))), { kind: "protocol", cause: "multiple_tool_calls" }));
  it("max_tokens → truncated", () => expectErr(run(msgTransport(msg({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "半", proposedClaims: [] } }] }))), { kind: "protocol", cause: "truncated" }));
  it("refusal → refused", () => expectErr(run(msgTransport(msg({ stop_reason: "refusal" }))), { kind: "refused" }));
  it("pause_turn → protocol NOT retryable", () => expectErr(run(msgTransport(msg({ stop_reason: "pause_turn" }))), { kind: "protocol", cause: "pause_turn", retryable: false }));
  it("context exceeded → config/request_too_large", () => expectErr(run(msgTransport(msg({ stop_reason: "model_context_window_exceeded" }))), { kind: "config", cause: "request_too_large" }));
  it("end_turn no tool → no_tool_call", () => expectErr(run(msgTransport(msg({ stop_reason: "end_turn", content: [{ type: "text" }] }))), { kind: "protocol", cause: "no_tool_call" }));
  it("invalid tool input → schema_invalid", () => expectErr(run(msgTransport(msg({ content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "", proposedClaims: [] } }] }))), { kind: "protocol", cause: "schema_invalid" }));
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
