/**
 * 全局中断结算的纯逻辑（§ post-time-advance settlement）：优先级选择器、原子结算 reducer、
 * 完成时的 board 推导，以及多中断逐个消化的「重选」语义。不渲染 App。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AutoCheckpointRequest, autoCheckpointEventId, autoCheckpointTriggers, deferredAutoCheckpointMode } from "../../src/ui/eventReturn";
import {
  type GlobalInterruptInputs,
  pickNextGlobalInterrupt,
  timeSettlementReducer,
} from "../../src/ui/settlement";

const none: GlobalInterruptInputs = {
  birthDue: false,
  pregnancyDisclosureDue: false,
  successorDue: false,
  centennialDue: false,
  grandSelectionDue: false,
};

describe("pickNextGlobalInterrupt priority", () => {
  it("returns null when nothing is due", () => {
    expect(pickNextGlobalInterrupt(none)).toBeNull();
  });
  it("birth outranks everything", () => {
    expect(pickNextGlobalInterrupt({ ...none, birthDue: true, pregnancyDisclosureDue: true, grandSelectionDue: true })).toBe("birth");
  });
  it("pregnancy disclosure outranks successor/centennial/grand-selection", () => {
    expect(pickNextGlobalInterrupt({ ...none, pregnancyDisclosureDue: true, successorDue: true, grandSelectionDue: true })).toBe("pregnancy_disclosure");
  });
  it("successor outranks centennial/grand-selection", () => {
    expect(pickNextGlobalInterrupt({ ...none, successorDue: true, centennialDue: true, grandSelectionDue: true })).toBe("successor");
  });
  it("centennial outranks grand-selection", () => {
    expect(pickNextGlobalInterrupt({ ...none, centennialDue: true, grandSelectionDue: true })).toBe("centennial_heir");
  });
  it("grand-selection is lowest", () => {
    expect(pickNextGlobalInterrupt({ ...none, grandSelectionDue: true })).toBe("grand_selection");
  });
});

describe("deterministic drain by re-selection", () => {
  it("resolving one interrupt surfaces the next from the latest inputs (sequential, never simultaneous)", () => {
    // birth + pregnancy both due → birth first
    let inputs: GlobalInterruptInputs = { ...none, birthDue: true, pregnancyDisclosureDue: true };
    expect(pickNextGlobalInterrupt(inputs)).toBe("birth");
    // resolving birth flips birthDue off; re-select → pregnancy
    inputs = { ...inputs, birthDue: false };
    expect(pickNextGlobalInterrupt(inputs)).toBe("pregnancy_disclosure");
    // resolving pregnancy → none remain
    inputs = { ...inputs, pregnancyDisclosureDue: false };
    expect(pickNextGlobalInterrupt(inputs)).toBeNull();
  });
});

describe("timeSettlementReducer", () => {
  const stationary: AutoCheckpointRequest = { source: "stationary_rollover", returnTarget: { kind: "location", locationId: "yanhe_gong" }, dispatch: "new_chain" };
  it("begin carries the full AutoCheckpointRequest", () => {
    expect(timeSettlementReducer(null, { type: "begin", request: stationary })).toEqual({ request: stationary });
  });
  it("begin overwrites a prior pending settlement", () => {
    const next: AutoCheckpointRequest = { source: "travel_rollover", returnTarget: { kind: "map", atRoot: false, boardId: "jingcheng" }, dispatch: "new_chain" };
    expect(timeSettlementReducer({ request: stationary }, { type: "begin", request: next })).toEqual({ request: next });
  });
  it("consume clears", () => {
    expect(timeSettlementReducer({ request: stationary }, { type: "consume" })).toBeNull();
  });
  it("clear clears", () => {
    expect(timeSettlementReducer({ request: stationary }, { type: "clear" })).toBeNull();
  });
});

describe("autoCheckpoint routing (stationary / travel / arrival) — Blocker 1", () => {
  it("triggers: stationary=time only; travel=time+location; arrival=location only", () => {
    expect(autoCheckpointTriggers("stationary_rollover")).toEqual({ timeAdvance: true, locationEnter: false });
    expect(autoCheckpointTriggers("travel_rollover")).toEqual({ timeAdvance: true, locationEnter: true });
    expect(autoCheckpointTriggers("arrival")).toEqual({ timeAdvance: false, locationEnter: true });
  });

  it("1. stationary rollover with an eligible location-enter event but no time event does NOT choose it", () => {
    expect(autoCheckpointEventId("stationary_rollover", null, "ev_loc")).toBeNull();
  });
  it("2. stationary rollover with a time event chooses it", () => {
    expect(autoCheckpointEventId("stationary_rollover", "ev_time", "ev_loc")).toBe("ev_time");
  });
  it("3. travel rollover chooses time event before location-enter", () => {
    expect(autoCheckpointEventId("travel_rollover", "ev_time", "ev_loc")).toBe("ev_time");
  });
  it("4. travel rollover with no time event chooses location-enter", () => {
    expect(autoCheckpointEventId("travel_rollover", null, "ev_loc")).toBe("ev_loc");
  });
  it("5. non-rollover arrival chooses location-enter only", () => {
    expect(autoCheckpointEventId("arrival", "ev_time", "ev_loc")).toBe("ev_loc"); // time ignored at arrival
    expect(autoCheckpointEventId("arrival", "ev_time", null)).toBeNull();
  });
  it("6. no trigger produces no event", () => {
    expect(autoCheckpointEventId("stationary_rollover", null, null)).toBeNull();
    expect(autoCheckpointEventId("travel_rollover", null, null)).toBeNull();
    expect(autoCheckpointEventId("arrival", null, null)).toBeNull();
  });
});

describe("App settlement wiring source contract (no jsdom)", () => {
  const appSrc = readFileSync(new URL("../../src/ui/App.tsx", import.meta.url), "utf8");

  it("every due overlay is gated by activeGlobalInterrupt.kind (no parallel independent due-conditions)", () => {
    expect(appSrc).toMatch(/activeGlobalInterrupt === "birth"/);
    expect(appSrc).toMatch(/activeGlobalInterrupt === "pregnancy_disclosure"/);
    expect(appSrc).toMatch(/activeGlobalInterrupt === "successor"/);
    expect(appSrc).toMatch(/activeGlobalInterrupt === "centennial_heir"/);
    expect(appSrc).toMatch(/activeGlobalInterrupt === "grand_selection"/);
  });

  it("grand-selection discovery no longer depends on view === \"location\"", () => {
    // the old view-gated daxuan effect is removed; grand-selection is a selector input now
    expect(appSrc).not.toMatch(/view !== "location" \|\| daxuanPrompt/);
  });

  it("rollover completers route through the settlement seam, and completion uses completeAutoCheckpoint", () => {
    expect(appSrc).toContain("beginSettlement(");
    expect(appSrc).toContain("completeAutoCheckpoint(");
    // flush converts the deferred reaction context into a settlement
    expect(appSrc).toMatch(/flushPendingReactionCheckpoint[\s\S]*beginSettlement\(/);
  });

  it("the overloaded runCheckpoints router and settlementBoardId are gone (Blocker 1+2)", () => {
    expect(appSrc).not.toContain("runCheckpoints");
    expect(appSrc).not.toContain("settlementBoardId");
  });

  it("settlement is cleared on new game / load / settings load / death", () => {
    const clears = appSrc.match(/timeSettlementDispatch\(\{ type: "clear" \}\)/g) ?? [];
    expect(clears.length).toBeGreaterThanOrEqual(4);
  });

  // ── Blocker 1: reactionful arrival keeps location_enter ──
  it("deferred completion is centralized; reactionful arrival is not lost", () => {
    expect(appSrc).toContain("completeDeferredAutoCheckpoint(");
    // travel passes the request even when beats exist (non-rollover arrival not replaced by null)
    expect(appSrc).toMatch(/if \(beats\.length\) playReactions\(beats, request\)/);
    expect(appSrc).toMatch(/else completeDeferredAutoCheckpoint\(request\)/);
    // flush + empty playReactions both route through the centralized continuation
    expect(appSrc).toMatch(/flushPendingReactionCheckpoint[\s\S]*completeDeferredAutoCheckpoint\(pending\.request\)/);
  });

  // ── Blocker 2: event-scene rollover goes through global settlement with continue_chain ──
  it("committed event rollover begins settlement with dispatch continue_chain (not a direct time_advance chain)", () => {
    const onDone = appSrc.slice(appSrc.indexOf("if (rolledOver) {", appSrc.indexOf("scene-commit autosave")));
    expect(onDone).toMatch(/beginSettlement\(\{[\s\S]*dispatch: "continue_chain"/);
    // completion honors continue_chain via chainAdvance (preserve chain), not playerStart
    expect(appSrc).toMatch(/request\.dispatch === "continue_chain"[\s\S]*chainAdvance/);
  });

  // ── Blocker 3: atomic-flow gating (state-based, not stale view strings) ──
  it("atomicFlowInProgress gates on event/court/dianxuan/shop/gift/dialogue state, not a stale view string", () => {
    const block = appSrc.slice(appSrc.indexOf("const atomicFlowInProgress"), appSrc.indexOf("const atomicFlowInProgress") + 700);
    expect(block).toContain("activeEventId !== null");
    expect(block).toContain("court !== null");
    expect(block).toContain("dianxuan !== null");
    expect(block).toContain("shopId !== null");
    expect(block).toContain("giftItemId !== null");
    expect(block).toContain("dialogueInFlight");
    expect(block).not.toMatch(/view === "event"/); // replaced by activeEventId !== null (avoids deadlock)
  });

  it("generative dialogue is in-flight-guarded with an op token cleared in finally", () => {
    const conv = appSrc.slice(appSrc.indexOf("const converse"), appSrc.indexOf("const transferTo"));
    expect(conv).toContain("setDialogueInFlight(true)");
    expect(conv).toMatch(/dialogueOpRef\.current !== opToken/); // stale completion ignored
    expect(conv).toMatch(/finally[\s\S]*setDialogueInFlight\(false\)/);
  });

  it("dialogue op token is invalidated on new game / load / settings load / death", () => {
    const bumps = appSrc.match(/dialogueOpRef\.current \+= 1/g) ?? [];
    expect(bumps.length).toBeGreaterThanOrEqual(4);
  });
});

describe("deferredAutoCheckpointMode (Blocker 1 routing)", () => {
  it("arrival completes immediately (no global drain)", () => {
    expect(deferredAutoCheckpointMode({ source: "arrival", returnTarget: { kind: "map", atRoot: true }, dispatch: "new_chain" })).toBe("complete_now");
  });
  it("stationary/travel rollovers settle (drain global interrupts first)", () => {
    expect(deferredAutoCheckpointMode({ source: "stationary_rollover", returnTarget: { kind: "map", atRoot: true }, dispatch: "new_chain" })).toBe("settle");
    expect(deferredAutoCheckpointMode({ source: "travel_rollover", returnTarget: { kind: "map", atRoot: true }, dispatch: "new_chain" })).toBe("settle");
  });
});
