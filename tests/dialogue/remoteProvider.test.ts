/**
 * createDialogueProvider (Task 3): the final-shape facade refuses every call
 * with config/not_configured until a real adapter is wired in a later task.
 */
import { describe, expect, it } from "vitest";
import { createDialogueProvider } from "../../src/engine/dialogue/providers/remoteProvider";

describe("createDialogueProvider", () => {
  it("satisfies the DialogueProvider contract and refuses with config/not_configured", async () => {
    const provider = createDialogueProvider({ model: { provider: "anthropic", model: "x" } });
    expect(provider.id).toBe("remote:anthropic:x");
    expect(provider.kind).toBe("generative");
    expect(provider.capabilities).toEqual({ strictTools: false, promptCaching: false, batch: false });

    const result = await provider.generate({} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error;
      expect(e.kind).toBe("config");
      expect(e.retryable).toBe(false);
      if (e.kind === "config") expect(e.cause).toBe("not_configured");
    }
  });
});
