import { describe, expect, it } from "vitest";
import { wanderChance, wanders } from "../../src/engine/characters/greeting";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("wanderChance (性格加权)", () => {
  it("端肃/克制/重礼法 的沈知白低于基础 25", () => {
    // personalityTraits: ["端肃","克制","重礼法","外冷内热"] → 命中 3 个内敛关键词
    expect(wanderChance(db.characters.shen_zhibai!)).toBeLessThan(25);
  });

  it("clamp 不低于 5、不高于 60", () => {
    const reserved = { profile: { personalityTraits: ["端肃", "克制", "守礼", "清冷", "淡泊"] } } as never;
    const outgoing = { profile: { personalityTraits: ["活泼", "开朗", "好动", "爱热闹", "天真"] } } as never;
    expect(wanderChance(reserved)).toBe(5);
    expect(wanderChance(outgoing)).toBe(60);
  });

  it("无 traits 用基础 25", () => {
    expect(wanderChance({ profile: {} } as never)).toBe(25);
  });
});

describe("wanders (确定性)", () => {
  it("同 (seed,day,slot,char) 稳定", () => {
    const a = wanders(1, 10, 2, "lu_huaijin", 50);
    const b = wanders(1, 10, 2, "lu_huaijin", 50);
    expect(a).toBe(b);
  });

  it("概率 0 永不出门、100 必出门", () => {
    expect(wanders(1, 10, 2, "lu_huaijin", 0)).toBe(false);
    expect(wanders(1, 10, 2, "lu_huaijin", 100)).toBe(true);
  });
});
