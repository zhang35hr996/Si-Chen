/**
 * Canonical reaction-field coverage: every reaction-capable character must carry
 * machine fields (reactionTraits / structured stance), so the ReactionPlanner never
 * silently falls back to a default disposition / neutral relation for real content.
 * Plus real-content integration: derived disposition/relation are NOT the defaults.
 */
import { describe, it, expect } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";
import { legacyConsortContent } from "../helpers/consortFixture";
import { deriveDisposition, DEFAULT_DISPOSITION } from "../../src/engine/dialogue/disposition";
import { deriveSubjectRelation } from "../../src/engine/dialogue/subjectRelation";

const db = loadRealContent();

describe("canonical reaction-field coverage", () => {
  it("every consort carries at least one canonical reaction trait", () => {
    for (const c of Object.values(db.characters)) {
      if (c.kind !== "consort") continue;
      expect(c.profile.reactionTraits.length, `${c.id} has no reactionTraits`).toBeGreaterThan(0);
    }
  });

  it("every authored stance has a structured stance value and a narrative attitude", () => {
    for (const c of Object.values(db.characters)) {
      for (const s of c.stances ?? []) {
        expect(s.stance, `${c.id}→${s.charId} missing stance`).toBeDefined();
        expect(s.attitude.length, `${c.id}→${s.charId} empty attitude`).toBeGreaterThan(0);
      }
    }
  });
});

// shen_zhibai / xu_qinghuan were removed from authored content/; the legacy test
// fixtures preserve their authored reactionTraits/stances so the derivation logic
// (disposition / subject-relation) stays covered.
describe("derived disposition / relation from authored reaction fields", () => {
  it("沈知白's reactionTraits derive a high discretion, not the default", () => {
    const shen = legacyConsortContent("shen_zhibai");
    const d = deriveDisposition(shen.profile.reactionTraits);
    expect(d.discretion).toBeGreaterThan(DEFAULT_DISPOSITION.discretion);
    expect(d.discretion).toBeGreaterThanOrEqual(80);
  });

  it("徐清欢's structured stance toward 沈知白 derives a non-neutral (competitive) relation", () => {
    const xu = legacyConsortContent("xu_qinghuan");
    const stance = xu.stances?.find((s) => s.charId === "shen_zhibai")?.stance;
    expect(stance).toBeDefined();
    const { relation } = deriveSubjectRelation({ charId: "shen_zhibai", authoredStance: stance });
    expect(relation.stance).not.toBe("neutral");
    expect(relation.stance).toBe("competitive");
  });
});
