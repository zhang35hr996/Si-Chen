import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { buildBirth } from "../../src/store/gestation";
import { makeGameTime } from "../../src/engine/calendar/time";

const _content = loadGameContent();
if (!_content.ok) throw new Error("content failed to load");
const db = _content.value;

// Step 0 scan results — fixed seeds (conceivedAt year=1 month=1, carrier=lu_huaijin, calendar=year1 month10 ap=0).
const SAFE_SEED = 0;         // bearerOutcome === "safe"
const CHILD_DIES_SEED = 4;   // bearerOutcome === "child_dies"
const BEARER_DIES_SEED = 95; // bearerOutcome === "bearer_dies"
const BOTH_SEED = 154;        // bearerOutcome === "both"

/** Create a state with a due consort gestation (lu_huaijin, conceivedAt year=1 month=1). */
function dueBirth(rngSeed: number, health: number) {
  const s = createNewGameState(db);
  s.rngSeed = rngSeed;
  // Pick first non-deceased consort with standing (skip officials)
  const cid = Object.keys(s.standing).find(
    (id) => s.standing[id]!.lifecycle !== "deceased" && db.characters[id]?.kind === "consort",
  )!;
  s.standing[cid]!.health = health;
  s.standing[cid]!.healthStatus = "healthy";
  s.standing[cid]!.lifecycle = "carrying";
  // conceivedAt year=1, month=1 → plannedBirthMonth ordinal ≥ 8 (early birth) or 10 (term).
  // Calendar at year=1 month=10, ap=0: slot=apMax−ap=5 ≥ any birthSlot (0..4), always due.
  s.resources.bloodline.gestations = [{
    carrier: cid,
    conceivedAt: makeGameTime(1, 1, "early"),
    fatherId: cid,
    transferredAtMonth: 1,
  }];
  const birthCalendar = makeGameTime(1, 10, "early");
  s.calendar = { ...birthCalendar, ap: 0, apMax: 5, eraName: "" };
  return { s, cid };
}

const aftermathFor = (st: ReturnType<typeof applyEffects>, cid: string) =>
  st.ok ? st.value.pendingAftermath.filter((a) => a.subjectId === cid) : [];

describe("生产健康成本 + 难产母死统一管线（固定 seed，无条件断言）", () => {
  it("顺产 safe：母方 −5，皇嗣存活，无身后事", () => {
    const { s, cid } = dueBirth(SAFE_SEED, 80);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("safe");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[cid]!.health).toBe(75); // 80 − 5
    expect(r.value.resources.bloodline.heirs.length).toBe(1);
    expect(r.value.standing[cid]!.lifecycle).not.toBe("deceased");
    expect(aftermathFor(r, cid).length).toBe(0);
  });

  it("顺产成本致死（safe，health=5 → −5=0）：皇嗣存活，母亡 + 身后事一条", () => {
    const { s, cid } = dueBirth(SAFE_SEED, 5);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("safe");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs.length).toBe(1); // 已产存嗣
    expect(r.value.standing[cid]!.lifecycle).toBe("deceased"); // 母亡
    expect(r.value.standing[cid]!.deathRecord!.cause).toBe("childbirth");
    expect(aftermathFor(r, cid).length).toBe(1);
  });

  it("难产 child_dies：母方 −10 存活、无存活皇嗣", () => {
    const { s, cid } = dueBirth(CHILD_DIES_SEED, 80);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("child_dies");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[cid]!.health).toBe(70); // 80 − 10
    expect(r.value.resources.bloodline.heirs.some((h) => h.lifecycle === "alive")).toBe(false); // 子亡
    expect(r.value.standing[cid]!.lifecycle).not.toBe("deceased"); // 母存活
    expect(aftermathFor(r, cid).length).toBe(0);
  });

  it("bearer_dies：皇嗣存活 / 母方 deceased / deathRecord.cause=childbirth / 身后事恰一条", () => {
    const { s, cid } = dueBirth(BEARER_DIES_SEED, 80);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("bearer_dies");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs.some((h) => h.lifecycle === "alive")).toBe(true); // 皇嗣存活
    expect(r.value.standing[cid]!.lifecycle).toBe("deceased");
    expect(r.value.standing[cid]!.deathRecord!.cause).toBe("childbirth");
    expect(aftermathFor(r, cid).length).toBe(1);
  });

  it("both：无存活皇嗣 / 母方 deceased / deathRecord.cause=childbirth / 身后事恰一条", () => {
    const { s, cid } = dueBirth(BOTH_SEED, 80);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("both");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs.some((h) => h.lifecycle === "alive")).toBe(false); // 子亡
    expect(r.value.standing[cid]!.lifecycle).toBe("deceased");
    expect(r.value.standing[cid]!.deathRecord!.cause).toBe("childbirth");
    expect(aftermathFor(r, cid).length).toBe(1);
  });
});
