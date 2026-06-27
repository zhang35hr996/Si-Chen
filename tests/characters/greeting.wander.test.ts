import { describe, expect, it } from "vitest";
import { wanderChance, wanders, gardenSubLocationFor } from "../../src/engine/characters/greeting";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("wanderChance (性格加权)", () => {
  it("端肃/克制/重礼法 的沈知白低于基础 12", () => {
    // personalityTraits: ["端肃","克制","重礼法","外冷内热"] → 命中 3 个内敛关键词
    expect(wanderChance(db.characters.shen_zhibai!)).toBeLessThan(12);
  });

  it("clamp 不低于 3、不高于 40", () => {
    const reserved = { profile: { personalityTraits: ["端肃", "克制", "守礼", "清冷", "淡泊"] } } as never;
    const outgoing = { profile: { personalityTraits: ["活泼", "开朗", "好动", "爱热闹", "天真"] } } as never;
    expect(wanderChance(reserved)).toBe(3);
    expect(wanderChance(outgoing)).toBe(40);
  });

  it("无 traits 用基础 12", () => {
    expect(wanderChance({ profile: {} } as never)).toBe(12);
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

describe("gardenSubLocationFor (御花园子地点分配)", () => {
  const subs = ["taiyechi", "jiangxuexuan", "fubiting", "tuixiushan"];

  it("空列表返回 null", () => {
    expect(gardenSubLocationFor(1, 10, "lu_huaijin", [])).toBeNull();
  });

  it("单子地点始终返回该子地点", () => {
    expect(gardenSubLocationFor(1, 10, "lu_huaijin", ["taiyechi"])).toBe("taiyechi");
  });

  it("同 (seed,day,char) 恒定返回同一子地点", () => {
    const a = gardenSubLocationFor(42, 5, "lu_huaijin", subs);
    const b = gardenSubLocationFor(42, 5, "lu_huaijin", subs);
    expect(a).toBe(b);
  });

  it("返回值必须在 subs 列表内", () => {
    for (const charId of ["lu_huaijin", "shen_zhibai", "wei_sui"]) {
      expect(subs).toContain(gardenSubLocationFor(99, 3, charId, subs));
    }
  });
});
