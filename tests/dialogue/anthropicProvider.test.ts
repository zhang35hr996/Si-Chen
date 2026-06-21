import { describe, it, expect } from "vitest";
import { createAnthropicProvider } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okTransport, makeRequest, hangingTransport } from "./fixtures/anthropic";
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
