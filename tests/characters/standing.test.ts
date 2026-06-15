import { describe, expect, it } from "vitest";
import { resolveDisplayName, effectiveOrder } from "../../src/engine/characters/standing";
import type { CharacterContent, CharacterRank } from "../../src/engine/content/schemas";

const chenghui = { id: "chenghui", name: "承徽", grade: "正三品", order: 134, domain: "harem", favorTerm: "恩宠", selfRefs: { toPlayer: ["侍", "侍身"], formal: ["本宫"], informal: ["我"] } } as CharacterRank;

const consort = (over: Partial<CharacterContent["profile"]>) =>
  ({ kind: "consort", profile: { name: "沈承徽", surname: "沈", ...over } } as unknown as CharacterContent);

describe("resolveDisplayName", () => {
  it("composes surname + 位分 when untitled", () => {
    expect(resolveDisplayName(consort({}), { rank: "chenghui", favor: 30 }, chenghui)).toBe("沈承徽");
  });
  it("composes 封号 + 位分 when titled", () => {
    expect(resolveDisplayName(consort({}), { rank: "chenghui", favor: 30, title: "婉" }, chenghui)).toBe("婉承徽");
  });
  it("falls back to profile.name when there is no surname (凤后)", () => {
    const fenghou = { kind: "consort", profile: { name: "凤后" } } as unknown as CharacterContent;
    expect(resolveDisplayName(fenghou, { rank: "fenghou", favor: 25 }, { ...chenghui, name: "凤后" })).toBe("凤后");
  });
});

describe("effectiveOrder", () => {
  it("nudges a titled rank above its untitled order", () => {
    expect(effectiveOrder(chenghui, true)).toBe(135);
    expect(effectiveOrder(chenghui, false)).toBe(134);
  });
});
