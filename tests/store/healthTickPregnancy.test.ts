import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { projectMonthlyHealth, buildMonthlyHealthTick } from "../../src/store/healthTick";
import { healthRollRange } from "../../src/engine/characters/healthRoll";
import { makeGameTime } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const conceived = makeGameTime(1, 1, "early");

// 选一个使承养损耗 ≥1 的 seedKey；下方 expect 会强制选对（若该 key 损耗为 0 则换一个）。
const SEED_KEY = "tick:1:cseed:1:1";
const PREG_LOSS = healthRollRange(`${SEED_KEY}:preg`, 0, 5);

describe("月度承养健康成本", () => {
  it("锁定 seedKey：承养损耗 > 0（保证后续断言非空跑）", () => {
    expect(PREG_LOSS).toBeGreaterThan(0);
  });

  it("承养损耗本身致死 → deathCause = pregnancy（非 illness）", () => {
    const out = projectMonthlyHealth({
      health: 1, status: "healthy", age: 25, isYearStart: false,
      pregnancyMonthlyCost: true, seedKey: SEED_KEY,
    });
    expect(out.died).toBe(true);
    expect(out.deathCause).toBe("pregnancy");
  });

  it("buildMonthlyHealthTick：承孕侍君精确多扣 PREG_LOSS；无孕对照不扣", () => {
    /** 与 livingConsortIds 逻辑一致：kind=consort + 非 deceased/candidate，字母序首个 */
    function firstConsortId(s: ReturnType<typeof createNewGameState>): string {
      const ids = Object.keys(s.standing).filter(
        (id) => (db.characters[id]?.kind === "consort" || s.generatedConsorts[id]) &&
          s.standing[id]?.lifecycle !== "deceased" &&
          s.standing[id]?.lifecycle !== "candidate",
      ).sort();
      if (!ids[0]) throw new Error("No living consort found");
      return ids[0];
    }
    function stateWithConsort(rngSeed: number, carrying: boolean) {
      const s = createNewGameState(db);
      s.rngSeed = rngSeed;
      const cid = firstConsortId(s);
      s.standing[cid]!.health = 80;
      s.standing[cid]!.healthStatus = "healthy"; // 无病损；isYearStart=false → 无衰老
      if (carrying) s.resources.bloodline.gestations.push({ carrier: cid, conceivedAt: conceived, fatherId: cid, transferredAtMonth: 1 });
      return { s, cid };
    }
    // 用真实 seedKey 形态计算该局承养损耗（buildMonthlyHealthTick 内部 seedKey = tick:{rngSeed}:{cid}:{y}:{m}）
    const probe = stateWithConsort(7, true);
    const seedKey = `tick:${probe.s.rngSeed}:${probe.cid}:${probe.s.calendar.year}:${probe.s.calendar.month}`;
    const loss = healthRollRange(`${seedKey}:preg`, 0, 5);
    expect(loss).toBeGreaterThan(0); // 若为 0，换 rngSeed 直到 >0（强制确定性）

    const tick = buildMonthlyHealthTick(db, probe.s);
    const fx = tick.effects.find((e) => e.type === "set_consort_health" && (e as { char: string }).char === probe.cid) as { healthDelta?: number } | undefined;
    expect(fx).toBeDefined();
    expect(fx!.healthDelta).toBe(-loss); // 精确扣承养损耗（健康 status 无病损）

    // 对照：同 rngSeed、同 cid，但无 gestation → 无任何扣血效果
    const ctrl = stateWithConsort(7, false);
    const ctrlTick = buildMonthlyHealthTick(db, ctrl.s);
    const ctrlFx = ctrlTick.effects.find((e) => e.type === "set_consort_health" && (e as { char: string }).char === ctrl.cid);
    expect(ctrlFx).toBeUndefined();
  });
});
