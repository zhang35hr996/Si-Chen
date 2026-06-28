import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
import { applyEffects } from "../../src/engine/effects/funnel";
import { getCharacterLocation } from "../../src/engine/characters/presence";
import { makeGameTime } from "../../src/engine/calendar/time";
import { withConsort } from "../helpers/consortFixture";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const conceived = makeGameTime(1, 1, "early");

/** 让某侍君怀胎且健康充裕（不会因承养损耗致死），返回布置好的 state。 */
function pregnantConsort(rngSeed: number, consortId: string) {
  let s = createNewGameState(db);
  s.rngSeed = rngSeed;
  if (!s.standing[consortId]) {
    s = withConsort(s, db, consortId);
  }
  s.standing[consortId]!.health = 95;
  s.standing[consortId]!.healthStatus = "healthy";
  s.standing[consortId]!.lifecycle = "carrying";
  s.resources.bloodline.gestations.push({
    carrier: consortId,
    conceivedAt: conceived,
    fatherId: consortId,
    transferredAtMonth: 1,
  });
  return s;
}

const hasMiscarriage = (s: ReturnType<typeof createNewGameState>, cid: string): boolean =>
  buildMonthlyHealthTick(db, s).effects.some(
    (e) => e.type === "consort_miscarriage" && (e as { carrierId: string }).carrierId === cid,
  );

describe("冷宫孕侍君月度小产（+20%）", () => {
  it("wenya 确在长门宫", () => {
    expect(getCharacterLocation(db, createNewGameState(db), "wenya")).toBe("changmengong");
  });

  it("冷宫孕侍君在某些月份会小产；宫中孕侍君（对照）永不命中此机制", () => {
    let coldHit = 0;
    let warmHit = 0;
    for (let seed = 1; seed <= 200; seed++) {
      if (hasMiscarriage(pregnantConsort(seed, "wenya"), "wenya")) coldHit++;
      if (hasMiscarriage(pregnantConsort(seed, "xu_qinghuan"), "xu_qinghuan")) warmHit++;
    }
    expect(coldHit).toBeGreaterThan(0); // 冷宫确有小产
    expect(warmHit).toBe(0); // 非冷宫永不触发此机制
  });

  it("小产效果断该侍君胎息并把生命周期判回 normal（确定性）", () => {
    // 取一个命中小产的种子
    let seed = 1;
    while (seed <= 500 && !hasMiscarriage(pregnantConsort(seed, "wenya"), "wenya")) seed++;
    expect(seed).toBeLessThanOrEqual(500);
    const s = pregnantConsort(seed, "wenya");
    const a = buildMonthlyHealthTick(db, s).effects;
    const b = buildMonthlyHealthTick(db, s).effects;
    expect(a).toEqual(b); // 确定性
    expect(a.some((e) => e.type === "consort_miscarriage")).toBe(true);

    // 应用后：断该侍君胎息，生命周期判回 normal。
    const applied = applyEffects(db, s, a);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.resources.bloodline.gestations.some((g) => g.carrier === "wenya")).toBe(false);
    expect(applied.value.standing["wenya"]!.lifecycle).toBe("normal");
  });
});
