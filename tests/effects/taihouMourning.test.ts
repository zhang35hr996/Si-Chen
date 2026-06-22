import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import type { GameTime } from "../../src/engine/calendar/time";

const _content = loadGameContent();
if (!_content.ok) throw new Error("content failed to load");
const db = _content.value;

const at = (dayIndex: number): GameTime => ({ year: 1, month: 6, period: "mid", dayIndex });

describe("taihou_decease 服丧截止", () => {
  it("死亡 dayIndex=10 → mourningUntilDayExclusive=13（死亡当日计第1日，独占上界 +3）", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [{ type: "taihou_decease", at: at(10), cause: "illness" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.taihou.deceased).toBe(true);
    expect(r.value.taihou.diedAt).toEqual(at(10));
    expect(r.value.taihou.mourningUntilDayExclusive).toBe(13);
  });

  it("重复 taihou_decease 不延长截止日", () => {
    const s0 = createNewGameState(db);
    const r1 = applyEffects(db, s0, [{ type: "taihou_decease", at: at(10), cause: "illness" }]);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyEffects(db, r1.value, [{ type: "taihou_decease", at: at(11), cause: "illness" }]);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.taihou.mourningUntilDayExclusive).toBe(13); // 不被改成 14
    expect(r2.value.taihou.diedAt).toEqual(at(10)); // 死亡日不变
  });
});
