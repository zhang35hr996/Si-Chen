import { describe, it, expect } from "vitest";
import { createDialogueProvider } from "../../src/engine/dialogue/providers/remoteProvider";
import { okTransport, makeRequest } from "./fixtures/anthropic";

describe("createDialogueProvider routing", () => {
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
