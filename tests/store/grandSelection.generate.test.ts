import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { characterSchema } from "../../src/engine/content/schemas";
import { generateCandidates, describeRaiseHead, describeTalent } from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("generateCandidates", () => {
  it("生成 8–12 位、id 唯一、皆过 characterSchema、住储秀宫", () => {
    const s = createNewGameState(db);
    const cands = generateCandidates(db, s, 1);
    expect(cands.length).toBeGreaterThanOrEqual(8);
    expect(cands.length).toBeLessThanOrEqual(12);
    const ids = cands.map((c) => c.content.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cands) {
      expect(c.content.id).toMatch(/^xiunan_1_\d+$/);
      expect(c.content.defaultLocation).toBe("chuxiu_gong");
      expect(c.content.kind).toBe("consort");
      expect(characterSchema.safeParse(c.content).success).toBe(true);
      expect(c.announce.length).toBeGreaterThan(0);
      if (c.fatherOfficialId) expect(s.officials[c.fatherOfficialId]).toBeDefined();
    }
  });

  it("确定性：同 seed/year 同结果", () => {
    const s = createNewGameState(db);
    const a = generateCandidates(db, s, 4);
    const b = generateCandidates(db, s, 4);
    expect(a.map((c) => c.content.id)).toEqual(b.map((c) => c.content.id));
    expect(a.map((c) => c.announce)).toEqual(b.map((c) => c.announce));
  });
});

describe("抬头/才艺描述", () => {
  it("依容貌/性格/特长产出非空确定性文案", () => {
    const s = createNewGameState(db);
    const c = generateCandidates(db, s, 1)[0]!.content;
    expect(describeRaiseHead(c)).toBe(describeRaiseHead(c));
    expect(describeRaiseHead(c).length).toBeGreaterThan(0);
    expect(describeTalent(c)).toContain(c.attributes!.specialty);
  });
});
