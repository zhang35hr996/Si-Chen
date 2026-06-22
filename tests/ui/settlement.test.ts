/**
 * 全局中断结算的纯逻辑（§ post-time-advance settlement）：优先级选择器、原子结算 reducer、
 * 完成时的 board 推导，以及多中断逐个消化的「重选」语义。不渲染 App。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventReturnTarget } from "../../src/ui/eventReturn";
import {
  type GlobalInterruptInputs,
  pickNextGlobalInterrupt,
  settlementBoardId,
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
  const target: EventReturnTarget = { kind: "location", locationId: "yanhe_gong" };
  it("begin carries the full return target", () => {
    expect(timeSettlementReducer(null, { type: "begin", returnTarget: target })).toEqual({ returnTarget: target });
  });
  it("begin overwrites a prior pending settlement", () => {
    const next: EventReturnTarget = { kind: "map", atRoot: false, boardId: "jingcheng" };
    expect(timeSettlementReducer({ returnTarget: target }, { type: "begin", returnTarget: next })).toEqual({ returnTarget: next });
  });
  it("consume clears", () => {
    expect(timeSettlementReducer({ returnTarget: target }, { type: "consume" })).toBeNull();
  });
  it("clear clears", () => {
    expect(timeSettlementReducer({ returnTarget: target }, { type: "clear" })).toBeNull();
  });
});

describe("settlementBoardId", () => {
  it("nested map board (atRoot:false) → boardId", () => {
    expect(settlementBoardId({ kind: "map", atRoot: false, boardId: "jingcheng" })).toBe("jingcheng");
  });
  it("root map → undefined", () => {
    expect(settlementBoardId({ kind: "map", atRoot: true })).toBeUndefined();
    expect(settlementBoardId({ kind: "map" })).toBeUndefined();
  });
  it("location / palace targets → undefined (runCheckpoints restores by playerLocation)", () => {
    expect(settlementBoardId({ kind: "location", locationId: "yanhe_gong" })).toBeUndefined();
    expect(settlementBoardId({ kind: "zichendian" })).toBeUndefined();
    expect(settlementBoardId({ kind: "garden", subLocationId: "taiyechi" })).toBeUndefined();
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

  it("rollover completers route through the settlement seam, not a bare runCheckpoints", () => {
    // beginSettlement is the single entry; the only runCheckpoints(true, …) left for settlement is inside the drain effect
    expect(appSrc).toContain("beginSettlement(");
    // flush converts the deferred reaction context into a settlement rather than calling runCheckpoints directly
    expect(appSrc).toMatch(/flushPendingReactionCheckpoint[\s\S]*beginSettlement\(/);
  });

  it("settlement is cleared on new game / load / settings load / death", () => {
    const clears = appSrc.match(/timeSettlementDispatch\(\{ type: "clear" \}\)/g) ?? [];
    expect(clears.length).toBeGreaterThanOrEqual(4);
  });
});
