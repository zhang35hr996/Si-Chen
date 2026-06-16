import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildBedchamber, bedchamberConfig } from "../../src/store/bedchamber";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("bedchamberConfig", () => {
  it("reads world.json values", () => {
    const cfg = bedchamberConfig(db);
    expect(cfg.conceptionChance).toBe(db.world.bedchamber?.conceptionChance ?? 30);
    expect(cfg.tiers.favored).toBeGreaterThan(0);
  });
});

describe("buildBedchamber", () => {
  it("returns null for an official", () => {
    const state = createNewGameState(db);
    expect(buildBedchamber(db, state, "sili_nvguan", "passion")).toBeNull();
  });

  it("first night flag is set when no prior encounters", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "shen_chenghui", "pleasure");
    expect(plan).not.toBeNull();
    expect(plan!.isFirstNight).toBe(true);
    expect(plan!.lines.length).toBeGreaterThan(0);
    expect(plan!.effects[0]).toMatchObject({ type: "bedchamber", char: "shen_chenghui", mode: "pleasure" });
  });

  it("not first night after a prior encounter", () => {
    const state = createNewGameState(db);
    const a = applyEffects(db, state, [{ type: "bedchamber", char: "shen_chenghui", mode: "pleasure" }]);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const plan = buildBedchamber(db, a.value, "shen_chenghui", "pleasure");
    expect(plan!.isFirstNight).toBe(false);
  });

  it("pleasure never conceives (no pregnancy effect)", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "shen_chenghui", "pleasure");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });

  it("passion conceives iff conception roll hits, adds pregnancy begin", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "shen_chenghui", "passion");
    expect(plan!.effects.some((e) => e.type === "pregnancy" && (e as any).op === "begin")).toBe(plan!.conceived);
  });

  it("does not roll conception while already pregnant", () => {
    let state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    state = begun.value;
    const plan = buildBedchamber(db, state, "shen_chenghui", "passion");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });
});
