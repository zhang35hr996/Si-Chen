import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("funnel: bedchamber", () => {
  it("appends an encounter at current time", () => {
    const state = createNewGameState(db);
    const r = applyEffects(db, state, [{ type: "bedchamber", char: "shen_chenghui", mode: "passion" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const enc = r.value.bedchamber.shen_chenghui!.encounters;
    expect(enc).toHaveLength(1);
    expect(enc[0]!.mode).toBe("passion");
    expect(enc[0]!.at.month).toBe(state.calendar.month);
    expect(state.bedchamber.shen_chenghui!.encounters).toHaveLength(0);
  });

  it("rejects bedchamber for an official (no record)", () => {
    const state = createNewGameState(db);
    const errs = validateEffects(db, state, [{ type: "bedchamber", char: "sili_nvguan", mode: "passion" }]);
    expect(errs).toHaveLength(1);
  });
});

describe("funnel: pregnancy", () => {
  it("begin → pending with conceivedAt + empty candidateIds", () => {
    const state = createNewGameState(db);
    const r = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.value.resources.bloodline.pregnancy;
    expect(p.status).toBe("pending");
    expect(p.conceivedAt?.month).toBe(state.calendar.month);
    expect(p.candidateIds).toEqual([]);
  });

  it("carry → carrying + sovereign gestation, keeps conceivedAt", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const r = applyEffects(db, begun.value, [{ type: "pregnancy", op: "carry" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy.status).toBe("carrying");
    expect(r.value.resources.bloodline.gestation).toEqual({
      carrier: "sovereign",
      conceivedAt: begun.value.resources.bloodline.pregnancy.conceivedAt,
    });
    expect(r.value.resources.bloodline.pregnancy.conceivedAt).toEqual(
      begun.value.resources.bloodline.pregnancy.conceivedAt,
    );
    expect(r.value.resources.bloodline.pregnancy.candidateIds).toEqual([]);
  });

  it("rejects begin when not none, carry when not pending", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(validateEffects(db, begun.value, [{ type: "pregnancy", op: "begin" }])).toHaveLength(1);
    expect(validateEffects(db, state, [{ type: "pregnancy", op: "carry" }])).toHaveLength(1);
  });

  it("clear resets to none and drops gestation", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const carried = applyEffects(db, begun.value, [{ type: "pregnancy", op: "carry" }]);
    expect(carried.ok).toBe(true);
    if (!carried.ok) return;
    const r = applyEffects(db, carried.value, [{ type: "pregnancy", op: "clear" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", candidateIds: [] });
    expect(r.value.resources.bloodline.gestation).toBeUndefined();
  });

  it("clear works directly from pending", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const r = applyEffects(db, begun.value, [{ type: "pregnancy", op: "clear" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", candidateIds: [] });
  });

  it("rejects carry when conceivedAt is missing", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    if (!begun.ok) return;
    const broken = structuredClone(begun.value);
    delete broken.resources.bloodline.pregnancy.conceivedAt;
    expect(validateEffects(db, broken, [{ type: "pregnancy", op: "carry" }])).toHaveLength(1);
  });
});
