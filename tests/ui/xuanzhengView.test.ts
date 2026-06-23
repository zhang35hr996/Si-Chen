/**
 * 宣政殿纯决策层单测（无 jsdom）：升朝门槛、朝议结果摘要（真实 diff → 显示模型，无变化不臆造）。
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { buildCourtSummary, courtHoldGate } from "../../src/ui/xuanzhengView";
import type { CourtMetricsDiff } from "../../src/engine/court/agenda";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db);

describe("courtHoldGate", () => {
  it("allows holding court at full AP and healthy sovereign", () => {
    const g = courtHoldGate(fresh());
    expect(g.ok).toBe(true);
  });
  it("blocks when not at full AP, with a real reason", () => {
    const s: GameState = { ...fresh(), calendar: { ...fresh().calendar, ap: 3 } };
    const g = courtHoldGate(s);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toBeTruthy();
  });
  it("blocks when sovereign is critical, surfacing the health reason", () => {
    const base = fresh();
    const s: GameState = { ...base, resources: { ...base.resources, sovereign: { ...base.resources.sovereign, healthStatus: "critical" } } };
    const g = courtHoldGate(s);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toContain("静养");
  });
});

describe("buildCourtSummary", () => {
  const diff = (over: Partial<CourtMetricsDiff>): CourtMetricsDiff => ({ resourceDeltas: [], attitudeDeltas: [], ...over });

  it("maps namespaced resource keys to readable labels with signed deltas", () => {
    const view = buildCourtSummary(db, diff({ resourceDeltas: [{ key: "nation.treasury", delta: 500 }, { key: "sovereign.prestige", delta: -3 }] }));
    const labels = view.resources.map((r) => r.label);
    expect(labels).toContain("国库");
    expect(labels).toContain("威望");
    expect(view.resources.find((r) => r.label === "国库")!.delta).toBe(500);
    expect(view.empty).toBe(false);
  });

  it("maps attitude deltas to character display names when standing exists", () => {
    const charId = Object.keys(db.characters).find((id) => db.characters[id]!.kind === "consort")!;
    const view = buildCourtSummary(db, diff({ attitudeDeltas: [{ char: charId, delta: 7 }] }));
    expect(view.attitudes).toHaveLength(1);
    expect(view.attitudes[0]!.label).toBe(db.characters[charId]!.profile.name);
    expect(view.attitudes[0]!.delta).toBe(7);
  });

  it("empty diff → empty=true, no fabricated rows", () => {
    const view = buildCourtSummary(db, diff({}));
    expect(view.resources).toEqual([]);
    expect(view.attitudes).toEqual([]);
    expect(view.empty).toBe(true);
  });

  it("unknown resource key falls back to the raw key (never crashes)", () => {
    const view = buildCourtSummary(db, diff({ resourceDeltas: [{ key: "nation.unknownThing", delta: 2 }] }));
    expect(view.resources[0]!.label).toBe("nation.unknownThing");
  });
});
