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
    expect(buildBedchamber(db, state, "wei_sui", "passion")).toBeNull();
  });

  it("first night flag is set when no prior encounters", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "lu_huaijin", "pleasure");
    expect(plan).not.toBeNull();
    expect(plan!.isFirstNight).toBe(true);
    expect(plan!.lines.length).toBeGreaterThan(0);
    expect(plan!.effects[0]).toMatchObject({ type: "bedchamber", char: "lu_huaijin", mode: "pleasure" });
  });

  it("not first night after a prior encounter", () => {
    const state = createNewGameState(db);
    const a = applyEffects(db, state, [{ type: "bedchamber", char: "lu_huaijin", mode: "pleasure" }]);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const plan = buildBedchamber(db, a.value, "lu_huaijin", "pleasure");
    expect(plan!.isFirstNight).toBe(false);
  });

  it("pleasure never conceives (no pregnancy effect)", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "lu_huaijin", "pleasure");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });

  it("passion conceives iff conception roll hits, adds pregnancy begin", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "lu_huaijin", "passion");
    expect(plan!.effects.some((e) => e.type === "pregnancy" && (e as any).op === "begin")).toBe(plan!.conceived);
  });

  it("does not roll conception while already pregnant", () => {
    let state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    state = begun.value;
    const plan = buildBedchamber(db, state, "lu_huaijin", "passion");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });
});

describe("陪伴 dialogue four-case branching", () => {
  const conceivedAt = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

  const lines = (s: ReturnType<typeof createNewGameState>) =>
    buildBedchamber(db, s, "lu_huaijin", "companionship")!.lines.join("\n");

  it("picks distinct lines for neither / sovereign / consort / both pregnant", () => {
    const neither = createNewGameState(db);

    const sovereign = createNewGameState(db);
    sovereign.resources.bloodline.pregnancy = { status: "carrying", conceivedAt, candidateIds: [] };
    sovereign.resources.bloodline.gestations = [{ carrier: "sovereign", conceivedAt }];

    const consort = createNewGameState(db);
    consort.resources.bloodline.gestations = [
      { carrier: "lu_huaijin", conceivedAt, fatherId: "lu_huaijin", transferredAtMonth: 3 },
    ];
    consort.standing.lu_huaijin!.lifecycle = "carrying";

    const both = createNewGameState(db);
    both.resources.bloodline.pregnancy = { status: "carrying", conceivedAt, candidateIds: [] };
    both.resources.bloodline.gestations = [
      { carrier: "sovereign", conceivedAt },
      { carrier: "lu_huaijin", conceivedAt, fatherId: "lu_huaijin", transferredAtMonth: 3 },
    ];
    both.standing.lu_huaijin!.lifecycle = "carrying";

    const a = lines(neither), b = lines(sovereign), c = lines(consort), d = lines(both);
    expect(new Set([a, b, c, d]).size).toBe(4); // all four distinct
    expect(b).toContain("养胎");
    expect(c).toContain("皇嗣");
    expect(d).toContain("皆怀身孕");
  });
});

describe("bedchamber conception gate (multi-line gestation)", () => {
  it("passion does not conceive when the sovereign's own pregnancy is active", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.pregnancy = { status: "carrying", candidateIds: [] };
    s.resources.bloodline.gestations = [
      { carrier: "sovereign", conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } },
    ];
    const plan = buildBedchamber(db, s, "lu_huaijin", "passion");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });

  it("a consort carrying a transferred heir does NOT block the sovereign from conceiving", () => {
    const baseline = buildBedchamber(db, createNewGameState(db), "lu_huaijin", "passion")!;
    const s = createNewGameState(db);
    s.resources.bloodline.gestations = [
      {
        carrier: "wenya",
        conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
        fatherId: "wenya",
        transferredAtMonth: 3,
      },
    ];
    // pregnancy.status stays "none" (the sovereign's own body), so conception is unaffected.
    const plan = buildBedchamber(db, s, "lu_huaijin", "passion")!;
    expect(plan.conceived).toBe(baseline.conceived);
  });
});

describe("passionAllowed / canSummon / hasActiveGestation", () => {
  it("carrying consort cannot use passion but can be summoned", () => {
    const s = createNewGameState(db);
    s.standing.lu_huaijin!.lifecycle = "carrying";
    expect(passionAllowed(s, "lu_huaijin")).toBe(false);
    expect(canSummon(s, "lu_huaijin")).toBe(true);
  });

  it("recovering consort (recoverUntilMonth in future) cannot use passion", () => {
    const s = createNewGameState(db);
    s.standing.lu_huaijin!.recoverUntilMonth = 999;
    expect(passionAllowed(s, "lu_huaijin")).toBe(false);
  });

  it("recovery expired (recoverUntilMonth <= now) allows passion again", () => {
    const s = createNewGameState(db);
    s.standing.lu_huaijin!.recoverUntilMonth = 1; // now is monthOrdinal of 元年一月 = 1, not < 1
    expect(passionAllowed(s, "lu_huaijin")).toBe(true);
  });

  it("deceased consort cannot be summoned", () => {
    const s = createNewGameState(db);
    s.standing.lu_huaijin!.lifecycle = "deceased";
    expect(canSummon(s, "lu_huaijin")).toBe(false);
  });

  it("normal consort allows passion and summon", () => {
    const s = createNewGameState(db);
    expect(passionAllowed(s, "lu_huaijin")).toBe(true);
    expect(canSummon(s, "lu_huaijin")).toBe(true);
  });

  it("hasActiveGestation reflects pregnancy status or gestation presence", () => {
    const s = createNewGameState(db);
    expect(hasActiveGestation(s)).toBe(false);
    s.resources.bloodline.pregnancy = { status: "pending", candidateIds: [] };
    expect(hasActiveGestation(s)).toBe(true);
  });
});
