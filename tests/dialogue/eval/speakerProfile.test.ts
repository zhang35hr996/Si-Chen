import { describe, it, expect } from "vitest";
import { buildSpeakerProfiles } from "../../../src/engine/dialogue/eval/speakerProfile";
import { loadRealContent } from "../../helpers/contentFixture";

describe("buildSpeakerProfiles", () => {
  const db = loadRealContent();
  const profiles = buildSpeakerProfiles(db);

  it("produces a profile for every character", () => {
    expect(Object.keys(profiles).length).toBe(Object.keys(db.characters).length);
  });

  it("maps voice.register, tabooTopics, and quoted quirk lexemes for a known consort", () => {
    const lu = profiles["lu_huaijin"];
    expect(lu).toBeDefined();
    expect(lu!.register).toBe("poetic");
    expect(lu!.addressTerm).toBe("陛下");
    // lu_huaijin voice.quirks include 自称『臣侍』 → lexeme 臣侍
    expect(lu!.quirkLexemes).toContain("臣侍");
    expect(lu!.selfRefs.length).toBeGreaterThan(0);
  });
});
