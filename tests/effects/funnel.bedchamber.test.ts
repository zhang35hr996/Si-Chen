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
  it("begin → pending with conceivedAt", () => {
    const state = createNewGameState(db);
    const r = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy.status).toBe("pending");
    expect(r.value.resources.bloodline.pregnancy.conceivedAt?.month).toBe(state.calendar.month);
  });

  it("confirm sets expecting + fatherIds and keeps conceivedAt", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const r = applyEffects(db, begun.value, [
      { type: "pregnancy", op: "confirm", fatherIds: ["shen_chenghui", "chu_jun"] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.value.resources.bloodline.pregnancy;
    expect(p.status).toBe("expecting");
    expect(p.fatherIds).toEqual(["shen_chenghui", "chu_jun"]);
    expect(p.conceivedAt).toEqual(begun.value.resources.bloodline.pregnancy.conceivedAt);
  });

  it("rejects confirm with a non-consort fatherId", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]); // → pending
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const errs = validateEffects(db, begun.value, [
      { type: "pregnancy", op: "confirm", fatherIds: ["sili_nvguan"] },
    ]);
    expect(errs).toHaveLength(1);
  });

  it("rejects begin when already pending/expecting (no overwrite)", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const errs = validateEffects(db, begun.value, [{ type: "pregnancy", op: "begin" }]);
    expect(errs).toHaveLength(1);
  });

  it("rejects confirm when status is not pending", () => {
    const state = createNewGameState(db); // status "none"
    const errs = validateEffects(db, state, [
      { type: "pregnancy", op: "confirm", fatherIds: ["shen_chenghui"] },
    ]);
    expect(errs.some((e) => e.message.includes("requires status"))).toBe(true);
  });

  it("clear resets to none", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const r = applyEffects(db, begun.value, [{ type: "pregnancy", op: "clear" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", fatherIds: [] });
  });
});
