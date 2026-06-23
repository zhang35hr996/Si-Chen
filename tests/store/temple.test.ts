import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildIncense, buildFortune, fortuneTierFromRoll } from "../../src/store/temple";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;
const state = createNewGameState(db);

describe("fortuneTierFromRoll 分档边界", () => {
  it("0–9 大吉 / 10–34 吉 / 35–64 中平 / 65–89 凶 / 90–99 大凶", () => {
    expect(fortuneTierFromRoll(0)).toBe("大吉");
    expect(fortuneTierFromRoll(9)).toBe("大吉");
    expect(fortuneTierFromRoll(10)).toBe("吉");
    expect(fortuneTierFromRoll(34)).toBe("吉");
    expect(fortuneTierFromRoll(35)).toBe("中平");
    expect(fortuneTierFromRoll(64)).toBe("中平");
    expect(fortuneTierFromRoll(65)).toBe("凶");
    expect(fortuneTierFromRoll(89)).toBe("凶");
    expect(fortuneTierFromRoll(90)).toBe("大凶");
    expect(fortuneTierFromRoll(99)).toBe("大凶");
  });
});

describe("buildIncense", () => {
  it("三项 effects：民心/威望/健康，delta∈[0,5]", () => {
    const r = buildIncense(db, state, "k1");
    expect(r.effects).toHaveLength(3);
    const map = Object.fromEntries(r.effects.map((e: any) => [`${e.pillar}.${e.field}`, e.delta]));
    expect(map["nation.publicSupport"]).toBeGreaterThanOrEqual(0);
    expect(map["nation.publicSupport"]).toBeLessThanOrEqual(5);
    expect(map["sovereign.prestige"]).toBeGreaterThanOrEqual(0);
    expect(map["sovereign.prestige"]).toBeLessThanOrEqual(5);
    expect(map["sovereign.health"]).toBeGreaterThanOrEqual(0);
    expect(map["sovereign.health"]).toBeLessThanOrEqual(5);
    expect(r.zhuchiLines.length).toBeGreaterThan(0);
    expect(r.chengfengLines.length).toBeGreaterThan(0);
  });
  it("同 key 确定性", () => {
    expect(buildIncense(db, state, "same")).toEqual(buildIncense(db, state, "same"));
  });
});

describe("buildFortune", () => {
  it("任意 key：含 publicSupport effect，所有 delta 量级≤10，有台词", () => {
    for (let i = 0; i < 60; i++) {
      const r = buildFortune(db, state, `key${i}`);
      expect(r.effects.some((e: any) => e.field === "publicSupport")).toBe(true);
      for (const e of r.effects as any[]) expect(Math.abs(e.delta)).toBeLessThanOrEqual(10);
      expect(r.zhuchiLines.length).toBeGreaterThan(0);
      expect(r.chengfengLines.length).toBeGreaterThan(0);
    }
  });
  it("同 key 确定性", () => {
    expect(buildFortune(db, state, "fx")).toEqual(buildFortune(db, state, "fx"));
  });
});
