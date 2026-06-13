/**
 * Remote provider skeleton (skeleton-plan §11): the seam compiles and refuses
 * cleanly. No network, no keys — connecting a real model is a later PR.
 */
import { describe, expect, it } from "vitest";
import { createRemoteProvider, type ProviderAdapter } from "../../src/engine/dialogue/providers/remoteProvider";
import { rawDialogueResponseSchema, type DialogueRequest } from "../../src/engine/dialogue/types";
import { err, ok } from "../../src/engine/infra/result";

// A trivial adapter purely to prove the interface is implementable in v0.
const stubAdapter: ProviderAdapter = {
  id: "stub",
  toWire: (request: DialogueRequest) => ({ speaker: request.speakerId }),
  fromWire: (raw) => {
    const parsed = rawDialogueResponseSchema.safeParse(raw);
    return parsed.success ? ok(parsed.data) : err({ category: "ai", code: "MALFORMED", severity: "error", message: "bad wire" });
  },
};

describe("createRemoteProvider", () => {
  it("satisfies the DialogueProvider contract and refuses with NOT_CONFIGURED", async () => {
    const provider = createRemoteProvider({ endpoint: "https://example.invalid", model: "test-model", adapter: stubAdapter });
    expect(provider.id).toBe("remote:test-model");
    expect(provider.kind).toBe("generative");

    const result = await provider.generate({} as DialogueRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_CONFIGURED");
      expect(result.error.category).toBe("ai");
    }
  });
});
