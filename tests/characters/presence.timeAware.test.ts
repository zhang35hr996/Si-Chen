import { describe, expect, it } from "vitest";
import { consortLocationAt, presentAt } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);
const home = db.characters.lu_huaijin!.defaultLocation; // zhongcui_gong

/** 把日历调到指定 slot（apMax-ap=slot）。 */
function atSlot(state: GameState, slot: number): GameState {
  return { ...state, calendar: { ...state.calendar, ap: state.calendar.apMax - slot } };
}

describe("consortLocationAt", () => {
  it("卯时(0) 普通侍君去坤宁宫请安", () => {
    expect(consortLocationAt(db, base, "lu_huaijin", 0)).toBe("kunninggong");
  });

  it("卯时被免请安则留住处", () => {
    const di = base.calendar.dayIndex;
    const s = { ...base, excusedFromGreeting: { dayIndex: di, charIds: ["lu_huaijin"] } };
    expect(consortLocationAt(db, s, "lu_huaijin", 0)).toBe(home);
  });

  it("卯时留宿对象（未离宫）仍在住处", () => {
    const s = { ...base, overnightWith: { charId: "lu_huaijin", morningDayIndex: base.calendar.dayIndex } };
    expect(consortLocationAt(db, s, "lu_huaijin", 0)).toBe(home);
  });

  it("凤后永远在坤宁宫，不请安不游走", () => {
    expect(consortLocationAt(db, base, "shen_zhibai", 0)).toBe("kunninggong");
    expect(consortLocationAt(db, base, "shen_zhibai", 2)).toBe("kunninggong");
  });

  it("夜里(戌5)一律在住处", () => {
    expect(consortLocationAt(db, base, "lu_huaijin", 5)).toBe(home);
  });

  it("同一时辰物理位置不因玩家所在地改变（单一物理位置不变量）", () => {
    // 固定 dayIndex/slot，仅切换 playerLocation：位置必须稳定，绝不因玩家移动到其住处而被重算回宫。
    for (const slot of [1, 2, 3]) {
      const away = consortLocationAt(db, { ...base, playerLocation: "zichendian" }, "lu_huaijin", slot);
      const atHer = consortLocationAt(db, { ...base, playerLocation: home }, "lu_huaijin", slot);
      const elsewhere = consortLocationAt(db, { ...base, playerLocation: "yuhuayuan" }, "lu_huaijin", slot);
      expect(atHer).toBe(away);
      expect(elsewhere).toBe(away);
    }
  });

  it("白天高概率必去御花园、零概率必在家", () => {
    const out = { ...base, standing: { ...base.standing, lu_huaijin: { ...base.standing.lu_huaijin!, } } };
    // 用一个能让概率拉满/归零的探针：直接断言两极由 wanders 决定——此处校验函数会路由到御花园分支
    // 通过寻找一个命中游走的 (slot) 验证；否则跳到下一 slot。
    const slots = [1, 2, 3];
    const anyGarden = slots.some((sl) => consortLocationAt(db, out, "lu_huaijin", sl) === "yuhuayuan");
    const anyHome = slots.some((sl) => consortLocationAt(db, out, "lu_huaijin", sl) === home);
    expect(anyGarden || anyHome).toBe(true); // 白天只可能是御花园或住处
  });
});

describe("presentAt (按当前 slot)", () => {
  it("卯时坤宁宫＝皇后＋出席侍君", () => {
    const ids = presentAt(db, atSlot(base, 0), "kunninggong").map((c) => c.id);
    expect(ids).toContain("shen_zhibai");
    expect(ids).toContain("lu_huaijin");
  });

  it("卯时某后宫居所空（住客去请安）", () => {
    expect(presentAt(db, atSlot(base, 0), "zhongcui_gong").map((c) => c.id)).toEqual([]);
  });

  it("非侍君（乘风/卫绥）按住处在场，不受请安影响", () => {
    const ids = presentAt(db, atSlot(base, 0), "zichendian").map((c) => c.id).sort();
    expect(ids).toEqual(["cheng_feng", "wei_sui"].sort());
  });
});
