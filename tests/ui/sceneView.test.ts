/**
 * 场景人物纯决策层单测（无 jsdom）：在场人物条项、聚焦视图门槛、选中态调和、单一权威。
 */
import { describe, expect, it } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import { createNewGameState } from "../../src/engine/state/newGame";
import { shichenSlot } from "../../src/engine/calendar/time";
import { consortLocationAt } from "../../src/engine/characters/presence";
import type { GameState } from "../../src/engine/state/types";
import { displayRole, focusedCharacterView, presentBarItems, reconcileSelection } from "../../src/ui/sceneView";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });
const fresh = (): GameState => createNewGameState(db);

describe("reconcileSelection", () => {
  it("keeps the current selection when it is still present", () => {
    expect(reconcileSelection(["a", "b", "c"], "b")).toBe("b");
  });
  it("falls to the first present character when the selection left", () => {
    expect(reconcileSelection(["a", "b"], "c")).toBe("a");
  });
  it("clears to null when nobody is present", () => {
    expect(reconcileSelection([], "a")).toBeNull();
  });
  it("falls to the first present character when nothing was selected", () => {
    expect(reconcileSelection(["a", "b"], null)).toBe("a");
    expect(reconcileSelection(["a", "b"], undefined)).toBe("a");
  });
  it("never returns a stale id not in the present list", () => {
    const out = reconcileSelection(["x", "y"], "ghost");
    expect(["x", "y"]).toContain(out);
  });
});

describe("presentBarItems is driven by presentAt (physical), not residence roster", () => {
  it("a wandering consort appears in the garden bar, not her home bar; sets are disjoint", () => {
    // find a slot where lu_huaijin wanders to the garden
    let state: GameState | null = null;
    outer: for (let dayIndex = 0; dayIndex < 200; dayIndex++) {
      for (let slot = 1; slot <= 3; slot++) {
        const base = withConsort(fresh(), db, "lu_huaijin");
        const s: GameState = { ...base, playerLocation: "zichendian", calendar: { ...base.calendar, dayIndex, ap: base.calendar.apMax - slot } };
        if (consortLocationAt(db, s, "lu_huaijin", shichenSlot(s.calendar)) === "yuhuayuan") { state = s; break outer; }
      }
    }
    expect(state).not.toBeNull();
    const gardenIds = presentBarItems(db, state!, "yuhuayuan").map((i) => i.id);
    const homeIds = presentBarItems(db, state!, "zhongcui_gong").map((i) => i.id);
    expect(gardenIds).toContain("lu_huaijin");
    expect(homeIds).not.toContain("lu_huaijin");
    for (const id of homeIds) expect(gardenIds).not.toContain(id);
  });

  it("bar item carries name + display role", () => {
    const state = fresh();
    const items = presentBarItems(db, state, state.playerLocation);
    for (const it of items) {
      expect(it.name).toBeTruthy();
      expect(typeof it.role).toBe("string");
    }
  });
});

describe("focusedCharacterView gating mirrors existing summon rules", () => {
  it("a consort with no AP is not actionable and gives a real reason", () => {
    const state: GameState = { ...fresh(), calendar: { ...fresh().calendar, ap: 0 } };
    const consortId = Object.keys(db.characters).find((id) => db.characters[id]!.kind === "consort")!;
    const view = focusedCharacterView(db, state, registry, consortId)!;
    expect(view.isConsort).toBe(true);
    expect(view.actionable).toBe(false);
    expect(view.unavailableReason).toBeTruthy();
  });

  it("a non-consort (official) is never actionable and exposes no bedchamber reason", () => {
    const state = fresh();
    const officialId = Object.keys(db.characters).find((id) => db.characters[id]!.kind === "official")!;
    const view = focusedCharacterView(db, state, registry, officialId)!;
    expect(view.isConsort).toBe(false);
    expect(view.actionable).toBe(false);
    expect(view.unavailableReason).toBeUndefined();
  });

  it("unknown character → undefined", () => {
    expect(focusedCharacterView(db, fresh(), registry, "nobody")).toBeUndefined();
  });
});

describe("displayRole", () => {
  it("uses rank name for a consort with standing", () => {
    const state = fresh();
    // generated consorts are in state.generatedConsorts, not db.characters — check both
    const consortId = Object.keys(state.standing).find(
      (id) => (db.characters[id] ?? state.generatedConsorts[id])?.kind === "consort",
    )!;
    expect(displayRole(db, state, consortId)).toBeTruthy();
  });
});
