/**
 * 月度健康编排集成测试（Task 4）
 * 覆盖三个必须场景（无条件，不使用 if 跳过 assertion）：
 *   (a) 健康年轻开局 → 无死亡，确定性
 *   (b) 皇帝重病+1血 & 侍君重病+1血 → sovereignDied=true, aftermathDeaths=[]
 *   (c) 侍君重病+1血 → aftermathDeaths 含该侍君，state 含 lifecycle/pendingAftermath
 */
import { describe, expect, it } from "vitest";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load: " + content.error.map((e) => e.message).join("\n"));
const db = content.value;

/** First living consort id in alphabetical order (matches livingConsortIds sort). */
function firstConsortId(state: ReturnType<typeof createNewGameState>): string {
  const ids = Object.keys(state.standing).filter(
    (id) => (db.characters[id]?.kind === "consort" || state.generatedConsorts[id]) &&
      state.standing[id]?.lifecycle !== "deceased" &&
      state.standing[id]?.lifecycle !== "candidate",
  ).sort();
  if (!ids[0]) throw new Error("No living consort found in state");
  return ids[0];
}

describe("buildMonthlyHealthTick", () => {
  // ── (a) 健康年轻开局 → 无死亡，effects 确定性 ─────────────────────────
  it("(a) healthy young start: no deaths, effects deterministic", () => {
    const state = createNewGameState(db);
    // rngSeed=1, year=1, month=1, period="early" (default new game state)
    const result = buildMonthlyHealthTick({ db, state, year: 1, month: 1, period: "early", rngSeed: 1 });
    expect(result.sovereignDied).toBe(false);
    expect(result.aftermathDeaths).toHaveLength(0);

    // Determinism: calling twice with same inputs yields identical effects array
    const result2 = buildMonthlyHealthTick({ db, state, year: 1, month: 1, period: "early", rngSeed: 1 });
    expect(JSON.stringify(result2.effects)).toBe(JSON.stringify(result.effects));
    expect(result2.sovereignDied).toBe(false);
    expect(result2.aftermathDeaths).toHaveLength(0);
  });

  // ── (b) 皇帝重病+1血 → sovereignDied=true, aftermathDeaths=[] 立即返回 ─
  it("(b) sovereign critical+health=1 AND consort critical+health=1 → sovereignDied=true, aftermathDeaths=[]", () => {
    const state = createNewGameState(db);
    // Set sovereign to critical with 1 health
    state.resources.sovereign.health = 1;
    state.resources.sovereign.healthStatus = "critical";
    // Also set the first consort to critical with 1 health (should NOT be processed due to early exit)
    const consortId = firstConsortId(state);
    state.standing[consortId]!.health = 1;
    state.standing[consortId]!.healthStatus = "critical";

    // rngSeed=1: tick:1:sovereign:1:1 → critdmg=4 → health 1-4=-3 → 0 → died (illness)
    const result = buildMonthlyHealthTick({ db, state, year: 1, month: 1, period: "early", rngSeed: 1 });
    expect(result.sovereignDied).toBe(true);
    expect(result.aftermathDeaths).toHaveLength(0);
    // Some effects should be present (at minimum the sovereign health change)
    expect(result.effects.length).toBeGreaterThan(0);
  });

  // ── (c) 侍君重病+1血 → aftermathDeaths 含侍君，效果已 apply ───────────
  it("(c) critical consort health=1 → dies, aftermathDeaths entry + lifecycle=deceased + pendingAftermath", () => {
    const state = createNewGameState(db);
    // Sovereign stays healthy (health=70, healthStatus="healthy")
    // Set first consort to critical with 1 health
    const consortId = firstConsortId(state);
    state.standing[consortId]!.health = 1;
    state.standing[consortId]!.healthStatus = "critical";

    // rngSeed=1: tick:1:{consortId}:1:1 → critdmg → health hits 0 → died (illness)
    const result = buildMonthlyHealthTick({ db, state, year: 1, month: 1, period: "early", rngSeed: 1 });
    expect(result.sovereignDied).toBe(false);
    expect(result.aftermathDeaths.some((d) => d.kind === "consort" && d.subjectId === consortId)).toBe(true);

    // Apply effects and verify state mutations
    const r = applyEffects(db, state, result.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nextState = r.value;
    expect(nextState.standing[consortId]?.lifecycle).toBe("deceased");
    expect(nextState.pendingAftermath.some((p) => p.subjectId === consortId)).toBe(true);
  });
});
