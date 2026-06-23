import { describe, expect, it } from "vitest";
import type { EventEffect } from "../../src/engine/content/schemas";
import { applyEffects, validateEffects, AXIS_CAP } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db);
// slice starting values: shen_zhibai favor 25; lu_huaijin favor 30; sovereign prestige 50.

const expectApplied = (state: GameState, effects: EventEffect[]): GameState => {
  const result = applyEffects(db, state, effects);
  if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));
  return result.value;
};

describe("valid effects apply", () => {
  it("favor / resource deltas with 0–100 value clamping", () => {
    const next = expectApplied(fresh(), [
      { type: "favor", char: "shen_zhibai", delta: 3 },
      { type: "favor", char: "lu_huaijin", delta: 5 },
      { type: "resource", pillar: "sovereign", field: "prestige", delta: -4 },
    ]);
    expect(next.standing["shen_zhibai"]?.favor).toBe(28);
    expect(next.standing["lu_huaijin"]?.favor).toBe(35);
    expect(next.resources.sovereign.prestige).toBe(46);
  });

  it("values clamp at the 0–100 floor/ceiling", () => {
    let state = fresh();
    state = {
      ...state,
      standing: {
        ...state.standing,
        shen_zhibai: { ...state.standing["shen_zhibai"]!, favor: 95 },
        lu_huaijin: { ...state.standing["lu_huaijin"]!, favor: 4 },
      },
    };
    const next = expectApplied(state, [
      { type: "favor", char: "shen_zhibai", delta: 10 },
      { type: "favor", char: "lu_huaijin", delta: -10 },
    ]);
    expect(next.standing["shen_zhibai"]?.favor).toBe(100);
    expect(next.standing["lu_huaijin"]?.favor).toBe(0);
  });

  it("per-axis cumulative delta caps at ±AXIS_CAP per batch; other axes unaffected", () => {
    const next = expectApplied(fresh(), [
      { type: "favor", char: "shen_zhibai", delta: 8 },
      { type: "favor", char: "shen_zhibai", delta: 8 }, // only +2 more lands
      { type: "favor", char: "lu_huaijin", delta: 8 }, // separate axis
    ]);
    expect(next.standing["shen_zhibai"]?.favor).toBe(25 + AXIS_CAP);
    expect(next.standing["lu_huaijin"]?.favor).toBe(30 + 8);
  });

  it("flag + set_bloodline_status", () => {
    const next = expectApplied(fresh(), [
      { type: "flag", key: "rite_scheduled", value: true },
      { type: "set_bloodline_status", field: "menstrualStatus", value: "irregular" },
    ]);
    expect(next.flags["rite_scheduled"]).toBe(true);
    expect(next.resources.bloodline.menstrualStatus).toBe("irregular");
  });

  it("memory appends: monotonic id, ownerId, GameTime stamp, new fields", () => {
    const state = fresh(); // lu_huaijin already has mem_..._000001 authored
    const next = expectApplied(state, [
      {
        type: "memory",
        char: "lu_huaijin",
        entry: {
          kind: "episodic",
          summary: "测试记忆。",
          strength: 40,
          retention: "fast",
          subjectIds: ["player", "lu_huaijin"],
          perspective: "witness",
          triggerTags: ["test"],
          unresolved: false,
          emotions: {},
        },
      },
    ]);
    const store = next.memories["lu_huaijin"]!;
    expect(store.entries).toHaveLength(2);
    const entry = store.entries[1]!;
    expect(entry.id).toBe("mem_lu_huaijin_000002");
    expect(entry.ownerId).toBe("lu_huaijin");
    expect(entry.strength).toBe(40);
    expect(entry.retention).toBe("fast");
    expect(entry.createdAt).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect("ap" in entry.createdAt).toBe(false);
    expect(store.nextSeq).toBe(3);
  });

  it("never mutates the input state", () => {
    const state = fresh();
    const snapshot = structuredClone(state);
    expectApplied(state, [{ type: "favor", char: "shen_zhibai", delta: 5 }]);
    expect(state).toEqual(snapshot);
  });
});

describe("invalid effects reject", () => {
  const cases: [string, unknown][] = [
    ["unknown favor target", { type: "favor", char: "char_ghost", delta: 2 }],
    ["unknown memory target", { type: "memory", char: "char_ghost", entry: { kind: "episodic", summary: "x", strength: 1, retention: "fast", subjectIds: ["player"], perspective: "witness", triggerTags: [], unresolved: false, emotions: {} } }],
    ["illegal pillar/field pair", { type: "resource", pillar: "sovereign", field: "harmony", delta: 1 }],
    ["oversized single delta", { type: "favor", char: "shen_zhibai", delta: 40 }],
    ["old v0 salience field rejected by schema", { type: "memory", char: "shen_zhibai", entry: { kind: "event", summary: "x", salience: 1, tags: [], participants: ["player"] } }],
    ["empty flag key", { type: "flag", key: "", value: 1 }],
    ["set_rank to 凤后 cap (fenghou) is rejected", { type: "set_rank", char: "shen_zhibai", rank: "fenghou" }],
    ["garbage", { hello: "world" }],
  ];

  it.each(cases)("%s", (_name, effect) => {
    const errors = validateEffects(db, fresh(), [effect as EventEffect]);
    expect(errors.length).toBeGreaterThan(0);
    expect(applyEffects(db, fresh(), [effect as EventEffect]).ok).toBe(false);
  });
});

const sovereign = { kind: "sovereign" as const, actorId: "player" as const };

describe("rank/title effects", () => {
  it("set_rank changes a consort's rank", () => {
    const r = applyEffects(db, fresh(), [{ type: "set_rank", char: "lu_huaijin", rank: "jun", authority: sovereign }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.standing["lu_huaijin"]!.rank).toBe("jun");
  });
  it("set_title then remove_title sets and clears the 封号", () => {
    const state = fresh();
    const a = applyEffects(db, state, [{ type: "set_title", char: "lu_huaijin", title: "婉", authority: sovereign }]);
    expect(a.ok && a.value.standing["lu_huaijin"]!.title).toBe("婉");
    if (!a.ok) return;
    const b = applyEffects(db, a.value, [{ type: "remove_title", char: "lu_huaijin", authority: sovereign }]);
    expect(b.ok && b.value.standing["lu_huaijin"]!.title).toBeUndefined();
  });
  it("rejects set_rank to 凤后 (the cap)", () => {
    expect(applyEffects(db, fresh(), [{ type: "set_rank", char: "lu_huaijin", rank: "fenghou", authority: sovereign }]).ok).toBe(false);
  });
  it("rejects set_rank on an official", () => {
    expect(applyEffects(db, fresh(), [{ type: "set_rank", char: "wei_sui", rank: "jun", authority: sovereign }]).ok).toBe(false);
  });
  it("rejects a 封号 containing a forbidden term", () => {
    expect(applyEffects(db, fresh(), [{ type: "set_title", char: "lu_huaijin", title: "女帝", authority: sovereign }]).ok).toBe(false);
  });
  it("rejects rank/title ops targeting the 凤后 consort (the 正宫 cap)", () => {
    expect(applyEffects(db, fresh(), [{ type: "set_rank", char: "shen_zhibai", rank: "jun", authority: sovereign }]).ok).toBe(false);
    expect(applyEffects(db, fresh(), [{ type: "set_title", char: "shen_zhibai", title: "婉", authority: sovereign }]).ok).toBe(false);
    expect(applyEffects(db, fresh(), [{ type: "remove_title", char: "shen_zhibai", authority: sovereign }]).ok).toBe(false);
  });
});

describe("atomicity", () => {
  it("one bad effect rejects the whole batch with ALL errors collected", () => {
    const state = fresh();
    const result = applyEffects(db, state, [
      { type: "favor", char: "shen_zhibai", delta: 2 },
      { type: "favor", char: "char_ghost", delta: 2 },
      { type: "favor", char: "also_ghost", delta: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(2); // both bad effects reported, with indices
    expect(result.error[0]?.context?.["index"]).toBe(1);
    expect(result.error[1]?.context?.["index"]).toBe(2);
    expect(state.standing["shen_zhibai"]?.favor).toBe(25); // nothing landed
  });
});
