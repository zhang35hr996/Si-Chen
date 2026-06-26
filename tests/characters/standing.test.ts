import { describe, expect, it } from "vitest";
import { resolveDisplayName, resolveIdentityLabel, effectiveOrder } from "../../src/engine/characters/standing";
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
  it("falls back to profile.name when there is no surname (皇后)", () => {
    const fenghou = { kind: "consort", profile: { name: "皇后" } } as unknown as CharacterContent;
    expect(resolveDisplayName(fenghou, { rank: "huanghou", favor: 25 }, { ...chenghui, name: "皇后" })).toBe("皇后");
  });
});

describe("resolveIdentityLabel", () => {
  it("界面标识用 本名·位分 并列（不影响对话守礼称呼）", () => {
    const c = consort({ name: "徐清欢", surname: "徐" });
    expect(resolveIdentityLabel(c, { rank: "chenghui", favor: 30 }, chenghui)).toBe("徐清欢·承徽");
  });
  it("有封号时拼 本名·封号位分", () => {
    const c = consort({ name: "徐清欢", surname: "徐" });
    expect(resolveIdentityLabel(c, { rank: "chenghui", favor: 30, title: "婉" }, chenghui)).toBe("徐清欢·婉承徽");
  });
  it("无位分时退化为本名", () => {
    const fenghou = { kind: "consort", profile: { name: "皇后" } } as unknown as CharacterContent;
    expect(resolveIdentityLabel(fenghou, { rank: "huanghou", favor: 25 }, undefined)).toBe("皇后");
  });
});

describe("effectiveOrder", () => {
  it("nudges a titled rank above its untitled order", () => {
    expect(effectiveOrder(chenghui, true)).toBe(135);
    expect(effectiveOrder(chenghui, false)).toBe(134);
  });
});
