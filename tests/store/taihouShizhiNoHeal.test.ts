import { describe, expect, it } from "vitest";
import { buildShizhiEncounter, buildTaihouRebuke } from "../../src/store/taihou";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

/** A baked seedKey that passes the 50% 侍疾 gate AND picks a present consort. */
const SEED_SHIZHI_HIT = "SEED_SHIZHI";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

describe("侍疾 / 敲打 与太后死亡", () => {
  it("侍疾 produces an encounter but NO heal effect — UNCONDITIONAL", () => {
    const s = createNewGameState(db);
    s.taihou.healthStatus = "critical";
    s.taihou.health = 30;
    const plan = buildShizhiEncounter(db, s, SEED_SHIZHI_HIT);
    expect(plan).not.toBeNull(); // guard against vacuous pass
    expect(plan!.effects.some((e) => e.type === "set_taihou_health")).toBe(false); // no free cure
    // favor + memory beats are still produced
    expect(plan!.effects.some((e) => e.type === "favor")).toBe(true);
    expect(plan!.effects.some((e) => e.type === "memory")).toBe(true);
  });

  it("侍疾 returns null when 太后 is deceased", () => {
    const s = createNewGameState(db);
    s.taihou.deceased = true;
    s.taihou.healthStatus = "critical";
    expect(buildShizhiEncounter(db, s, SEED_SHIZHI_HIT)).toBeNull();
  });

  it("敲打 returns null when 太后 is deceased", () => {
    const s = createNewGameState(db);
    s.taihou.deceased = true;
    // try many seeds: all must be null because of the death guard
    for (let i = 0; i < 50; i++) {
      expect(buildTaihouRebuke(db, s, `any:${i}`)).toBeNull();
    }
  });
});
