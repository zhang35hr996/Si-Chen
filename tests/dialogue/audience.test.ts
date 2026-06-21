// tests/dialogue/audience.test.ts
import { describe, it, expect } from "vitest";
import { buildAudienceContext } from "../../src/engine/dialogue/audience";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;
const state = createNewGameState(db);

describe("buildAudienceContext", () => {
  it("targets the player as sovereign, semi_private by default", () => {
    const a = buildAudienceContext(state, db, { speakerId: "shen_zhibai", targetId: "player" });
    expect(a.targetRole).toBe("sovereign");
    expect(a.privacy).toBe("semi_private");
    expect(a.presentCharacterIds).toContain("player");
  });
  it("classifies a fellow consort target as consort", () => {
    const a = buildAudienceContext(state, db, { speakerId: "shen_zhibai", targetId: "lu_huaijin" });
    expect(a.targetRole).toBe("consort");
  });
  it("dedupes/excludes speaker and sorts presentCharacterIds; honors explicit privacy", () => {
    const a = buildAudienceContext(state, db, {
      speakerId: "shen_zhibai", targetId: "player",
      presentCharacterIds: ["lu_huaijin", "player", "shen_zhibai", "lu_huaijin"], privacy: "public",
    });
    expect(a.privacy).toBe("public");
    expect(a.presentCharacterIds).toEqual([...a.presentCharacterIds].sort());
    expect(a.presentCharacterIds).not.toContain("shen_zhibai");
    expect(a.presentCharacterIds.filter((x) => x === "lu_huaijin")).toHaveLength(1);
  });
  it("is deterministic", () => {
    const args = { speakerId: "shen_zhibai", targetId: "player" } as const;
    expect(buildAudienceContext(state, db, args)).toEqual(buildAudienceContext(state, db, args));
  });
});
