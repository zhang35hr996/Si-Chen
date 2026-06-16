import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import { DEFAULT_GESTATION } from "../../src/engine/characters/gestation";
import { DEFAULT_TIERS } from "../../src/engine/characters/favorTier";
import { resolveBirth } from "../../src/engine/characters/birth";
import type { BedchamberRecord } from "../../src/engine/state/types";

const now = makeGameTime(1, 10, "early");
const emptyRecord: BedchamberRecord = { encounters: [] };

describe("resolveBirth — self pregnancy", () => {
  it("safe, fatherId null, legitimate, favor=100", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "sovereign",
      fatherId: null,
      transferredAtMonth: undefined,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord,
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.bearerOutcome).toBe("safe");
    expect(v.fatherId).toBeNull();
    expect(v.legitimate).toBe(true);
    expect(v.favor).toBe(100);
    expect(v.sex === "daughter" || v.sex === "son").toBe(true);
  });
});

describe("resolveBirth — consort carrier", () => {
  it("transfer at month 3 (5% dystocia) is usually safe; favor from tier none=0", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "shen_chenghui",
      fatherId: "shen_chenghui",
      transferredAtMonth: 3,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord, // no encounters → tier none → 0
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.fatherId).toBe("shen_chenghui");
    expect(v.legitimate).toBe(false);
    if (v.bearerOutcome === "safe") expect(v.favor).toBe(0);
  });

  it("fenghou bearer adds +30 (capped 80) and is legitimate", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "feng_hou",
      fatherId: "feng_hou",
      transferredAtMonth: 3,
      bearerIsFenghou: true,
      carrierRecord: emptyRecord, // tier none=0 → +30 = 30
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.legitimate).toBe(true);
    if (v.bearerOutcome === "safe") expect(v.favor).toBe(30);
  });

  it("100% dystocia yields a non-safe outcome from the split", () => {
    const cfg = { ...DEFAULT_GESTATION, dystocia: { ...DEFAULT_GESTATION.dystocia, baseAtMonth3: 100 } };
    const v = resolveBirth({
      rngSeed: 5,
      now,
      carrier: "shen_chenghui",
      fatherId: "shen_chenghui",
      transferredAtMonth: 3,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord,
      thresholds: DEFAULT_TIERS,
      cfg,
    });
    expect(["child_dies", "bearer_dies", "both"]).toContain(v.bearerOutcome);
  });

  it("is deterministic", () => {
    const input = {
      rngSeed: 9,
      now,
      carrier: "shen_chenghui",
      fatherId: "shen_chenghui",
      transferredAtMonth: 6,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord,
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    } as const;
    expect(resolveBirth(input)).toEqual(resolveBirth(input));
  });
});
