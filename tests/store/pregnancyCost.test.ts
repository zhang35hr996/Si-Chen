import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { planPregnancyTransfer, childbirthCostDelta } from "../../src/store/pregnancyCost";
import { makeGameTime } from "../../src/engine/calendar/time";

const _content = loadGameContent();
if (!_content.ok) throw new Error("content failed to load");
const db = _content.value;

// 用 makeGameTime 派生合法 dayIndex（手填 dayIndex:120 与 元年五月上旬 不符，会触发日历不变量）。
const at = makeGameTime(1, 5, "early");

function withSovereignGestation(health: number) {
  const s = createNewGameState(db);
  // Must pick a consort (kind === "consort") with standing so pregnancy_transfer & set_consort_health validate.
  // Also check generatedConsorts since story consorts are now event_only.
  const carrierId = Object.keys(s.standing).find(
    (id) => s.standing[id]!.lifecycle !== "deceased" && (db.characters[id] ?? s.generatedConsorts[id])?.kind === "consort",
  )!;
  s.resources.bloodline.pregnancy = { status: "carrying", candidateIds: [carrierId] };
  s.resources.bloodline.gestations = [{ carrier: "sovereign", conceivedAt: { year: 1, month: 3, period: "early", dayIndex: 60 } }];
  s.standing[carrierId]!.health = health;
  s.standing[carrierId]!.healthStatus = "healthy";
  return { s, carrierId };
}

describe("childbirthCostDelta", () => {
  it("safe −5 / child_dies −10 / bearer_dies 0 / both 0", () => {
    expect(childbirthCostDelta("safe")).toBe(-5);
    expect(childbirthCostDelta("child_dies")).toBe(-10);
    expect(childbirthCostDelta("bearer_dies")).toBe(0);
    expect(childbirthCostDelta("both")).toBe(0);
  });
});

describe("planPregnancyTransfer", () => {
  it("转胎落到侍君并扣 10 健康", () => {
    const { s, carrierId } = withSovereignGestation(70);
    const r = applyEffects(db, s, planPregnancyTransfer(s, carrierId, 3, at));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.gestations.some((g) => g.carrier === carrierId)).toBe(true);
    expect(r.value.standing[carrierId]!.health).toBe(60);
  });

  it("转胎扣血致 0 → 侍君死亡 + 断胎 + 入身后事", () => {
    const { s, carrierId } = withSovereignGestation(6); // 6 − 10 ≤ 0
    const r = applyEffects(db, s, planPregnancyTransfer(s, carrierId, 3, at));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[carrierId]!.lifecycle).toBe("deceased");
    expect(r.value.resources.bloodline.gestations.some((g) => g.carrier === carrierId)).toBe(false); // 断胎
    expect(r.value.pendingAftermath.some((a) => a.subjectId === carrierId)).toBe(true);
  });
});
