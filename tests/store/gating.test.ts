import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { canHoldCourt, canBedchamber } from "../../src/store/gating";

const _content = loadGameContent();
if (!_content.ok) throw new Error("content failed to load");
const db = _content.value;

describe("gating：皇帝重病 + 太后服丧", () => {
  it("健康且无丧 → 放行", () => {
    const s = createNewGameState(db);
    expect(canHoldCourt(s).ok).toBe(true);
    expect(canBedchamber(s).ok).toBe(true);
  });

  it("皇帝重病 → 上朝/侍寝禁，文案含凤体违和", () => {
    const s = createNewGameState(db);
    s.resources.sovereign.healthStatus = "critical";
    const c = canHoldCourt(s);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("凤体违和");
    expect(canBedchamber(s).ok).toBe(false);
  });

  it("太后服丧窗口内禁，达独占上界恢复（死亡当日起 3 行动日）", () => {
    const s = createNewGameState(db);
    s.taihou.deceased = true;
    s.taihou.mourningUntilDayExclusive = s.calendar.dayIndex + 3;
    expect(canHoldCourt(s).ok).toBe(false); // 第1日
    const at3 = structuredClone(s);
    (at3.calendar as any).dayIndex = s.calendar.dayIndex + 2;
    expect(canHoldCourt(at3).ok).toBe(false); // 第3日
    const at4 = structuredClone(s);
    (at4.calendar as any).dayIndex = s.calendar.dayIndex + 3;
    expect(canHoldCourt(at4).ok).toBe(true); // 达上界恢复
  });

  it("deceased 但 mourningUntilDayExclusive 缺失 → 不阻止（防御）", () => {
    const s = createNewGameState(db);
    s.taihou.deceased = true; // 无 mourningUntilDayExclusive
    expect(canHoldCourt(s).ok).toBe(true);
  });

  it("重病 + 服丧叠加 → 禁，主因显示重病", () => {
    const s = createNewGameState(db);
    s.resources.sovereign.healthStatus = "critical";
    s.taihou.deceased = true;
    s.taihou.mourningUntilDayExclusive = s.calendar.dayIndex + 3;
    const c = canHoldCourt(s);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("凤体违和");
  });
});
