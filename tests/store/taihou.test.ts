import { describe, expect, it } from "vitest";
import { buildShizhiEncounter, buildTaihouRebuke } from "../../src/store/taihou";
import { inPalaceConsorts } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { withConsort, legacyConsortContent } from "../helpers/consortFixture";

describe("buildShizhiEncounter", () => {
  const loaded = loadGameContent();
  const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

  it("null when 太后 not ill", () => {
    const s = createNewGameState(db);
    expect(buildShizhiEncounter(db, s, "1:1:early")).toBeNull();
  });

  it("when ill + hitting gate: picks an attendant, +5 favor, but does NOT cure 太后", () => {
    const s = createNewGameState(db);
    s.taihou.healthStatus = "sick";
    let seed = "";
    for (let i = 0; i < 200; i++) {
      const plan = buildShizhiEncounter(db, s, `g:${i}`);
      if (plan) { seed = `g:${i}`; break; }
    }
    expect(seed).not.toBe("");
    const plan = buildShizhiEncounter(db, s, seed)!;
    // attendant may be a generated consort (not in db.characters)
    expect(db.characters[plan.attendantId] ?? s.generatedConsorts[plan.attendantId]).toBeDefined();
    // 侍疾不再免费治愈太后。
    expect(plan.effects.some((e) => e.type === "set_taihou_health")).toBe(false);
    expect(plan.effects.some((e) => e.type === "favor" && e.char === plan.attendantId && e.delta === 5)).toBe(true);
    expect(plan.beats.length).toBe(3);
  });

  it("deterministic", () => {
    const s = createNewGameState(db);
    s.taihou.healthStatus = "sick";
    expect(JSON.stringify(buildShizhiEncounter(db, s, "k"))).toBe(JSON.stringify(buildShizhiEncounter(db, s, "k")));
  });
});

describe("buildTaihouRebuke", () => {
  const loaded2 = loadGameContent();
  const db2 = loaded2.ok ? loaded2.value : (() => { throw new Error("content failed"); })();

  it("null when 太后 ill (病中不敲打)", () => {
    const s = createNewGameState(db2);
    s.taihou.healthStatus = "sick";
    let any = false;
    for (let i = 0; i < 100; i++) if (buildTaihouRebuke(db2, s, `x:${i}`)) any = true;
    expect(any).toBe(false);
  });

  it("on hit: targets a non-皇后 consort, -5 favor + memory entry", () => {
    const s = createNewGameState(db2);
    let seed = "";
    for (let i = 0; i < 300; i++) {
      const plan = buildTaihouRebuke(db2, s, `h:${i}`);
      if (plan) { seed = `h:${i}`; break; }
    }
    expect(seed).not.toBe("");
    const plan = buildTaihouRebuke(db2, s, seed)!;
    expect(plan.targetId).not.toBe("shen_zhibai");
    // target may be a generated consort (not in db.characters)
    expect((db2.characters[plan.targetId] ?? s.generatedConsorts[plan.targetId])?.kind).toBe("consort");
    expect(plan.effects.some((e) => e.type === "favor" && e.char === plan.targetId && e.delta === -5)).toBe(true);
    expect(plan.beats.length).toBe(2);
    // 稳定目标显示称谓（供乘风 prompt 使用），与首条现场台词中的称谓一致。
    expect(plan.targetDisplayName).toBeTruthy();
    expect(plan.beats[0]!.lines[0]).toContain(plan.targetDisplayName);
  });

  it("never targets 皇后 across many hits", () => {
    const s = createNewGameState(db2);
    const counts: Record<string, number> = {};
    let hits = 0;
    for (let i = 0; i < 2000 && hits < 200; i++) {
      const plan = buildTaihouRebuke(db2, s, `w:${i}`);
      if (plan) { counts[plan.targetId] = (counts[plan.targetId] ?? 0) + 1; hits++; }
    }
    expect(hits).toBeGreaterThan(0);
    expect(counts["shen_zhibai"]).toBeUndefined();
  });

  it("deterministic", () => {
    const s = createNewGameState(db2);
    expect(JSON.stringify(buildTaihouRebuke(db2, s, "k"))).toBe(JSON.stringify(buildTaihouRebuke(db2, s, "k")));
  });

  it("runtime-db（生成角色合并进 characters）：敲打/侍疾池来自去重后的 inPalaceConsorts，无重复 ID", () => {
    const s = createNewGameState(db2);
    // App-style runtime db：generatedConsorts 同时存在于 characters 与 state.generatedConsorts
    const runtimeDb = { ...db2, characters: { ...db2.characters, ...s.generatedConsorts } };
    // rebukePool / attendantPool 均为 inPalaceConsorts().filter(...).map(...)；
    // filter/map 不会引入重复，故池去重等价于 inPalaceConsorts 去重。
    const ids = inPalaceConsorts(runtimeDb, s).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // 无任何重复 ID
    // 每名在宫生成侍君恰好出现一次（旧实现会出现两次）
    for (const id of Object.keys(s.generatedConsorts)) {
      const st = s.standing[id];
      if (st && st.rank !== "huanghou" && st.lifecycle !== "deceased") {
        expect(ids.filter((x) => x === id)).toHaveLength(1);
      }
    }
  });

  it("weighting reaches every consort when total favor exceeds 99 (raw roll, no 0–99 clamp)", () => {
    let s = createNewGameState(db2);
    // Push favors so total > 99 and the last cumulative slice starts above 99.
    // Story consorts were removed from content; use non-cold-palace legacy fixtures.
    const pool = ["lu_huaijin", "xu_qinghuan"].map(legacyConsortContent);
    expect(pool.length).toBeGreaterThanOrEqual(2);
    // Story consorts are not in state.standing; inject them first.
    for (const c of pool) s = withConsort(s, db2, c.id);
    for (const c of pool) s.standing[c.id]!.favor = 60; // e.g. 2×60 = 120 total
    const picked = new Set<string>();
    let hits = 0;
    for (let i = 0; i < 4000 && hits < 400; i++) {
      const plan = buildTaihouRebuke(db2, s, `wt:${i}`);
      if (plan) { picked.add(plan.targetId); hits++; }
    }
    // every eligible consort must be reachable (the bug made high-cumulative ones unreachable)
    for (const c of pool) expect(picked.has(c.id)).toBe(true);
  });
});
