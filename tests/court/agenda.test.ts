import { describe, expect, it } from "vitest";
import { pickCourtAffairs } from "../../src/engine/court/affairs";
import {
  courtAgendaPreview,
  snapshotCourtMetrics,
  diffCourtMetrics,
} from "../../src/engine/court/agenda";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db);

describe("courtAgendaPreview", () => {
  it("preview ids === pickCourtAffairs(same seed) and titles come from real content", () => {
    const state = fresh();
    const seed = `court:${state.rngSeed}:${state.calendar.dayIndex}`;
    const ids = pickCourtAffairs(db, seed);
    const preview = courtAgendaPreview(db, state);
    expect(preview.map((p) => p.id)).toEqual(ids);
    for (const p of preview) {
      expect(p.title).toBe(db.events[p.id]?.title ?? p.id);
      expect(p.title).toBeTruthy();
    }
  });

  it("empty pool → empty preview (no fabricated agenda)", () => {
    const noCourt = { ...db, events: Object.fromEntries(Object.entries(db.events).filter(([, e]) => e.checkpoint !== "court")) } as typeof db;
    expect(courtAgendaPreview(noCourt, fresh())).toEqual([]);
  });
});

describe("snapshotCourtMetrics + diffCourtMetrics", () => {
  it("captures a nation resource net change (treasury)", () => {
    const before = fresh();
    const after: GameState = {
      ...before,
      resources: { ...before.resources, nation: { ...before.resources.nation, treasury: before.resources.nation.treasury + 500 } },
    };
    const diff = diffCourtMetrics(snapshotCourtMetrics(before), snapshotCourtMetrics(after));
    expect(diff.resourceDeltas).toContainEqual({ key: "nation.treasury", delta: 500 });
  });

  it("captures a sovereign resource net change (prestige)", () => {
    const before = fresh();
    const after: GameState = {
      ...before,
      resources: { ...before.resources, sovereign: { ...before.resources.sovereign, prestige: before.resources.sovereign.prestige - 3 } },
    };
    const diff = diffCourtMetrics(snapshotCourtMetrics(before), snapshotCourtMetrics(after));
    expect(diff.resourceDeltas).toContainEqual({ key: "sovereign.prestige", delta: -3 });
  });

  it("captures favor (attitude) change for a participant", () => {
    const before = fresh();
    const someConsort = Object.keys(before.standing)[0]!;
    const after: GameState = {
      ...before,
      standing: { ...before.standing, [someConsort]: { ...before.standing[someConsort]!, favor: before.standing[someConsort]!.favor + 7 } },
    };
    const diff = diffCourtMetrics(snapshotCourtMetrics(before), snapshotCourtMetrics(after));
    expect(diff.attitudeDeltas).toContainEqual({ char: someConsort, delta: 7 });
  });

  it("no change → empty deltas (nothing fabricated)", () => {
    const s = fresh();
    const diff = diffCourtMetrics(snapshotCourtMetrics(s), snapshotCourtMetrics(s));
    expect(diff.resourceDeltas).toEqual([]);
    expect(diff.attitudeDeltas).toEqual([]);
  });

  it("resource deltas are stably sorted by key", () => {
    const before = fresh();
    const after: GameState = {
      ...before,
      resources: {
        ...before.resources,
        nation: { ...before.resources.nation, treasury: before.resources.nation.treasury + 1, military: before.resources.nation.military + 1 },
        sovereign: { ...before.resources.sovereign, prestige: before.resources.sovereign.prestige + 1 },
      },
    };
    const keys = diffCourtMetrics(snapshotCourtMetrics(before), snapshotCourtMetrics(after)).resourceDeltas.map((d) => d.key);
    expect(keys).toEqual([...keys].sort());
  });

  it("diff does not mutate its inputs", () => {
    const before = snapshotCourtMetrics(fresh());
    const after = snapshotCourtMetrics({ ...fresh(), resources: { ...fresh().resources, nation: { ...fresh().resources.nation, treasury: 99999 } } });
    const beforeCopy = JSON.parse(JSON.stringify(before));
    const afterCopy = JSON.parse(JSON.stringify(after));
    diffCourtMetrics(before, after);
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });
});
