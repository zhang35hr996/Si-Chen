/**
 * 集成：成长环境月结经 GameStore.settlePostAdvance 自动运行——每月一次、忽视随时间增长。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";
import { upbringingMonthKey } from "../../src/engine/characters/heirUpbringingSettlement";
import type { Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const defaultPersonality = {
  empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50,
};

function minorHeir(): Heir {
  return {
    id: "heir_int_1", sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"),
    favor: 50, legitimate: false, petName: "",
    education: { scholarship: 20, martial: 20, virtue: 20 },
    health: 70, talent: 50, diligence: 50,
    personality: defaultPersonality,
    interests: [], imperialFear: 30, neglect: 30, custodianBond: 30,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
    // no adoptiveFatherId, no lastImperialInteractionAt → 无有效抚养人，忽视上升
  };
}

function storeWithHeir() {
  const store = new GameStore();
  store.newGame(db);
  const s = store.getState();
  store.loadState({ ...s, resources: { ...s.resources, bloodline: { ...s.resources.bloodline, heirs: [minorHeir()] } } });
  return store;
}

describe("成长环境月结集成", () => {
  it("时间推进自动登记当月结算键，并使无养父皇嗣忽视上升", () => {
    const store = storeWithHeir();
    const beforeNeglect = store.getState().resources.bloodline.heirs[0]!.neglect;

    // 推进直到至少跨入一个新月。
    let crossed = false;
    for (let i = 0; i < 8 && !crossed; i++) {
      const before = monthOrdinal(store.getState().calendar);
      const r = store.advanceTime(db, { type: "SKIP_REMAINDER" });
      expect(r.ok).toBe(true);
      if (monthOrdinal(store.getState().calendar) > before) crossed = true;
    }
    expect(crossed).toBe(true);

    const st = store.getState();
    // 至少一个月键被登记。
    expect(st.settledHeirUpbringingMonths.length).toBeGreaterThan(0);
    // 无养父 → 忽视较初始上升（除非被 clamp，此处初始 30 远未到顶）。
    expect(st.resources.bloodline.heirs[0]!.neglect).toBeGreaterThan(beforeNeglect);
  });

  it("同一月份不重复结算（月键不重复）", () => {
    const store = storeWithHeir();
    for (let i = 0; i < 10; i++) {
      store.advanceTime(db, { type: "SKIP_REMAINDER" });
    }
    const keys = store.getState().settledHeirUpbringingMonths;
    expect(new Set(keys).size).toBe(keys.length); // 无重复
  });

  it("读档后不重复结算当月（幂等键随档保存）", () => {
    const store = storeWithHeir();
    // 跨入一个新月以登记键。
    for (let i = 0; i < 4; i++) store.advanceTime(db, { type: "SKIP_REMAINDER" });
    const snapshot = store.getState();
    const keyCount = snapshot.settledHeirUpbringingMonths.length;
    expect(keyCount).toBeGreaterThan(0);

    // 重载同一 state，当月键已存在 → 同月再推进不新增重复键。
    const store2 = new GameStore();
    store2.newGame(db);
    store2.loadState(snapshot);
    const curKey = upbringingMonthKey(store2.getState().calendar);
    expect(store2.getState().settledHeirUpbringingMonths).toContain(curKey);
  });
});
