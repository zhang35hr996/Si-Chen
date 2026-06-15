import { describe, expect, it } from "vitest";
import type { EventEffect } from "../../src/engine/content/schemas";
import { applyEffects, validateEffects, AXIS_CAP } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db);
// slice starting values: feng_hou trust 35 / affinity 20 / favor 25;
// harem {harmony 60, jealousy 20}; bloodline legitimacy 60.

const expectApplied = (state: GameState, effects: EventEffect[]): GameState => {
  const result = applyEffects(db, state, effects);
  if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));
  return result.value;
};

describe("valid effects apply", () => {
  it("relationship / favor / resource deltas with 0–100 value clamping", () => {
    const next = expectApplied(fresh(), [
      { type: "relationship", char: "feng_hou", field: "trust", delta: 3 },
      { type: "relationship", char: "feng_hou", field: "affinity", delta: -10 },
      { type: "favor", char: "shen_chenghui", delta: 5 },
      { type: "resource", pillar: "court", field: "authority", delta: -4 },
      { type: "resource", pillar: "bloodline", field: "legitimacy", delta: 5 },
    ]);
    expect(next.relationships["feng_hou"]).toMatchObject({ trust: 38, affinity: 10 });
    expect(next.standing["shen_chenghui"]?.favor).toBe(35);
    expect(next.resources.court.authority).toBe(46);
    expect(next.resources.bloodline.legitimacy).toBe(65);
  });

  it("values clamp at the 0–100 floor/ceiling", () => {
    let state = fresh();
    state = {
      ...state,
      relationships: {
        ...state.relationships,
        feng_hou: { ...state.relationships["feng_hou"]!, trust: 95, affinity: 4 },
      },
    };
    const next = expectApplied(state, [
      { type: "relationship", char: "feng_hou", field: "trust", delta: 10 },
      { type: "relationship", char: "feng_hou", field: "affinity", delta: -10 },
    ]);
    expect(next.relationships["feng_hou"]).toMatchObject({ trust: 100, affinity: 0 });
  });

  it("per-axis cumulative delta caps at ±AXIS_CAP per batch; other axes unaffected", () => {
    const next = expectApplied(fresh(), [
      { type: "relationship", char: "feng_hou", field: "trust", delta: 8 },
      { type: "relationship", char: "feng_hou", field: "trust", delta: 8 }, // only +2 more lands
      { type: "relationship", char: "shen_chenghui", field: "trust", delta: 8 }, // separate axis
    ]);
    expect(next.relationships["feng_hou"]?.trust).toBe(35 + AXIS_CAP);
    expect(next.relationships["shen_chenghui"]?.trust).toBe(25 + 8);
  });

  it("flag + set_bloodline_status", () => {
    const next = expectApplied(fresh(), [
      { type: "flag", key: "rite_scheduled", value: true },
      { type: "set_bloodline_status", field: "menstrualStatus", value: "irregular" },
    ]);
    expect(next.flags["rite_scheduled"]).toBe(true);
    expect(next.resources.bloodline.menstrualStatus).toBe("irregular");
  });

  it("memory appends: monotonic id, GameTime stamp, scene_outcome source, never protected", () => {
    const state = fresh(); // shen_chenghui already has mem_..._000001 authored
    const next = expectApplied(state, [
      {
        type: "memory",
        char: "shen_chenghui",
        entry: {
          kind: "event",
          summary: "测试记忆。",
          salience: 40,
          tags: ["test"],
          participants: ["player", "shen_chenghui"],
        },
      },
    ]);
    const store = next.memories["shen_chenghui"]!;
    expect(store.entries).toHaveLength(2);
    const entry = store.entries[1]!;
    expect(entry.id).toBe("mem_shen_chenghui_000002");
    expect(entry.source).toBe("scene_outcome");
    expect(entry.protected).toBe(false);
    expect(entry.createdAt).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect("ap" in entry.createdAt).toBe(false);
    expect(store.nextSeq).toBe(3);
  });

  it("never mutates the input state", () => {
    const state = fresh();
    const snapshot = structuredClone(state);
    expectApplied(state, [{ type: "relationship", char: "feng_hou", field: "trust", delta: 5 }]);
    expect(state).toEqual(snapshot);
  });
});

describe("invalid effects reject", () => {
  const cases: [string, unknown][] = [
    ["unknown relationship target", { type: "relationship", char: "char_ghost", field: "trust", delta: 2 }],
    ["unknown favor target", { type: "favor", char: "char_ghost", delta: 2 }],
    ["unknown memory target", { type: "memory", char: "char_ghost", entry: { kind: "event", summary: "x", salience: 1, tags: [], participants: ["player"] } }],
    ["illegal pillar/field pair", { type: "resource", pillar: "court", field: "harmony", delta: 1 }],
    ["oversized single delta", { type: "relationship", char: "feng_hou", field: "trust", delta: 40 }],
    ["protected runtime memory", { type: "memory", char: "feng_hou", entry: { kind: "event", summary: "x", salience: 1, tags: [], participants: ["player"], protected: true } }],
    ["empty flag key", { type: "flag", key: "", value: 1 }],
    ["set_rank to 凤后 cap (fenghou) is rejected", { type: "set_rank", char: "feng_hou", rank: "fenghou" }],
    ["garbage", { hello: "world" }],
  ];

  it.each(cases)("%s", (_name, effect) => {
    const errors = validateEffects(db, fresh(), [effect as EventEffect]);
    expect(errors.length).toBeGreaterThan(0);
    expect(applyEffects(db, fresh(), [effect as EventEffect]).ok).toBe(false);
  });
});

describe("rank/title effects", () => {
  it("set_rank changes a consort's rank", () => {
    const r = applyEffects(db, fresh(), [{ type: "set_rank", char: "shen_chenghui", rank: "jun" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.standing["shen_chenghui"]!.rank).toBe("jun");
  });
  it("set_title then remove_title sets and clears the 封号", () => {
    const state = fresh();
    const a = applyEffects(db, state, [{ type: "set_title", char: "shen_chenghui", title: "婉" }]);
    expect(a.ok && a.value.standing["shen_chenghui"]!.title).toBe("婉");
    if (!a.ok) return;
    const b = applyEffects(db, a.value, [{ type: "remove_title", char: "shen_chenghui" }]);
    expect(b.ok && b.value.standing["shen_chenghui"]!.title).toBeUndefined();
  });
  it("rejects set_rank to 凤后 (the cap)", () => {
    expect(applyEffects(db, fresh(), [{ type: "set_rank", char: "shen_chenghui", rank: "fenghou" }]).ok).toBe(false);
  });
  it("rejects set_rank on an official", () => {
    expect(applyEffects(db, fresh(), [{ type: "set_rank", char: "sili_nvguan", rank: "jun" }]).ok).toBe(false);
  });
  it("rejects a 封号 containing a forbidden term", () => {
    expect(applyEffects(db, fresh(), [{ type: "set_title", char: "shen_chenghui", title: "女帝" }]).ok).toBe(false);
  });
});

describe("atomicity", () => {
  it("one bad effect rejects the whole batch with ALL errors collected", () => {
    const state = fresh();
    const result = applyEffects(db, state, [
      { type: "relationship", char: "feng_hou", field: "trust", delta: 2 },
      { type: "relationship", char: "char_ghost", field: "trust", delta: 2 },
      { type: "favor", char: "also_ghost", delta: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(2); // both bad effects reported, with indices
    expect(result.error[0]?.context?.["index"]).toBe(1);
    expect(result.error[1]?.context?.["index"]).toBe(2);
    expect(state.relationships["feng_hou"]?.trust).toBe(35); // nothing landed
  });
});
