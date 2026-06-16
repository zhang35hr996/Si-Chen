import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildBedchamber, bedchamberConfig, passionAllowed, canSummon, hasActiveGestation } from "../../src/store/bedchamber";

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

describe("bedchamber single-track conception (heir lifecycle)", () => {
  it("passion does not conceive when a sovereign gestation is active", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.pregnancy = { status: "carrying", candidateIds: [] };
    s.resources.bloodline.gestation = {
      carrier: "sovereign",
      conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    };
    const plan = buildBedchamber(db, s, "shen_chenghui", "passion");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });

  it("passion does not conceive when a consort carries (gestation present, status none)", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.gestation = {
      carrier: "wenya_shijun",
      conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      fatherId: "wenya_shijun",
      transferredAtMonth: 3,
    };
    const plan = buildBedchamber(db, s, "shen_chenghui", "passion");
    expect(plan!.conceived).toBe(false);
  });
});

describe("passionAllowed / canSummon / hasActiveGestation", () => {
  it("carrying consort cannot use passion but can be summoned", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.lifecycle = "carrying";
    expect(passionAllowed(s, "shen_chenghui")).toBe(false);
    expect(canSummon(s, "shen_chenghui")).toBe(true);
  });

  it("recovering consort (recoverUntilMonth in future) cannot use passion", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.recoverUntilMonth = 999;
    expect(passionAllowed(s, "shen_chenghui")).toBe(false);
  });

  it("recovery expired (recoverUntilMonth <= now) allows passion again", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.recoverUntilMonth = 1; // now is monthOrdinal of 元年一月 = 1, not < 1
    expect(passionAllowed(s, "shen_chenghui")).toBe(true);
  });

  it("deceased consort cannot be summoned", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.lifecycle = "deceased";
    expect(canSummon(s, "shen_chenghui")).toBe(false);
  });

  it("normal consort allows passion and summon", () => {
    const s = createNewGameState(db);
    expect(passionAllowed(s, "shen_chenghui")).toBe(true);
    expect(canSummon(s, "shen_chenghui")).toBe(true);
  });

  it("hasActiveGestation reflects pregnancy status or gestation presence", () => {
    const s = createNewGameState(db);
    expect(hasActiveGestation(s)).toBe(false);
    s.resources.bloodline.pregnancy = { status: "pending", candidateIds: [] };
    expect(hasActiveGestation(s)).toBe(true);
  });
});
