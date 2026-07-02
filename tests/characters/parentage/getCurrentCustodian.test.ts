import { describe, it, expect } from "vitest";
import { createInitialState } from "../../../src/engine/state/initialState";
import { getCurrentCustodian } from "../../../src/engine/characters/parentage/parentageSelectors";

describe("getCurrentCustodian", () => {
  it("读 Heir.custodianId（登记即返回，不判资格）", () => {
    const s = createInitialState();
    s.resources.bloodline.heirs.push({ id: "heir_000001", custodianId: "c9" } as any);
    expect(getCurrentCustodian(s, "heir_000001")).toBe("c9");
  });
  it("无 custodian 返回 undefined", () => {
    const s = createInitialState();
    s.resources.bloodline.heirs.push({ id: "heir_000002" } as any);
    expect(getCurrentCustodian(s, "heir_000002")).toBeUndefined();
  });
});
