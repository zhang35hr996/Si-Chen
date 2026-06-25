import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import { DEFAULT_GESTATION, type GestationConfig } from "../../src/engine/characters/gestation";
import { DEFAULT_TIERS } from "../../src/engine/characters/favorTier";
import { resolveBirth } from "../../src/engine/characters/birth";
import type { BedchamberRecord } from "../../src/engine/state/types";

const NO_TWINS_NO_OMEN: GestationConfig = {
  ...DEFAULT_GESTATION,
  twins: { dragonPhoenixChance: 0, twoDaughtersChance: 0, twoSonsChance: 0 },
  birthOmen: { auspiciousChance: 0, inauspiciousChance: 0, auspiciousFavorDelta: 10, inauspiciousFavorDelta: -10 },
};
const ALL_DRAGON_PHOENIX: GestationConfig = {
  ...NO_TWINS_NO_OMEN,
  twins: { dragonPhoenixChance: 100, twoDaughtersChance: 0, twoSonsChance: 0 },
};
const ALL_TWIN_DAUGHTERS: GestationConfig = {
  ...NO_TWINS_NO_OMEN,
  twins: { dragonPhoenixChance: 0, twoDaughtersChance: 100, twoSonsChance: 0 },
};
const ALL_TWIN_SONS: GestationConfig = {
  ...NO_TWINS_NO_OMEN,
  twins: { dragonPhoenixChance: 0, twoDaughtersChance: 0, twoSonsChance: 100 },
};
const ALL_AUSPICIOUS: GestationConfig = {
  ...NO_TWINS_NO_OMEN,
  birthOmen: { auspiciousChance: 100, inauspiciousChance: 0, auspiciousFavorDelta: 10, inauspiciousFavorDelta: -10 },
};
const ALL_INAUSPICIOUS: GestationConfig = {
  ...NO_TWINS_NO_OMEN,
  birthOmen: { auspiciousChance: 0, inauspiciousChance: 100, auspiciousFavorDelta: 10, inauspiciousFavorDelta: -10 },
};

const now = makeGameTime(1, 10, "early");
const emptyRecord: BedchamberRecord = { encounters: [] };

describe("resolveBirth — self pregnancy", () => {
  it("safe, fatherId null, legitimate, favor=65 (selfPregnancy default)", () => {
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
    expect(v.favor).toBe(65); // selfPregnancy=65, no omen (seed=1 roll=78)
    expect(v.sex === "daughter" || v.sex === "son").toBe(true);
  });
});

describe("resolveBirth — consort carrier", () => {
  it("transfer at month 3 (5% dystocia) is safe; favor from tier none=15", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "lu_huaijin",
      fatherId: "lu_huaijin",
      transferredAtMonth: 3,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord, // no encounters → tier none → 15
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.fatherId).toBe("lu_huaijin");
    expect(v.legitimate).toBe(false);
    expect(v.bearerOutcome).toBe("safe"); // seed=1 dystocia roll > 5%
    expect(v.favor).toBe(15);
  });

  it("fenghou bearer adds +15 (no cap) and is legitimate; tier none → 15+15=30", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "shen_zhibai",
      fatherId: "shen_zhibai",
      transferredAtMonth: 3,
      bearerIsFenghou: true,
      carrierRecord: emptyRecord, // tier none=15 → +fenghouBonus(15) = 30
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.legitimate).toBe(true);
    expect(v.bearerOutcome).toBe("safe");
    expect(v.favor).toBe(30);
  });

  it("100% dystocia yields a non-safe outcome from the split", () => {
    const cfg = { ...DEFAULT_GESTATION, dystocia: { ...DEFAULT_GESTATION.dystocia, baseAtMonth3: 100 } };
    const v = resolveBirth({
      rngSeed: 5,
      now,
      carrier: "lu_huaijin",
      fatherId: "lu_huaijin",
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
      carrier: "lu_huaijin",
      fatherId: "lu_huaijin",
      transferredAtMonth: 6,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord,
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    } as const;
    expect(resolveBirth(input)).toEqual(resolveBirth(input));
  });
});

describe("resolveBirth — favor defaults", () => {
  const base = {
    rngSeed: 1, now,
    fatherId: "lu_huaijin", transferredAtMonth: 3, bearerIsFenghou: false,
    carrierRecord: emptyRecord, thresholds: DEFAULT_TIERS,
  };

  it("selfPregnancy=65 with no omen", () => {
    const v = resolveBirth({ ...base, carrier: "sovereign", fatherId: null,
      transferredAtMonth: undefined, cfg: NO_TWINS_NO_OMEN });
    expect(v.favor).toBe(65);
  });

  it("tier none=15 with no omen", () => {
    const v = resolveBirth({ ...base, carrier: "lu_huaijin", cfg: NO_TWINS_NO_OMEN });
    expect(v.favor).toBe(15);
  });

  it("fenghouBonus=15 stacks on tier none: 15+15=30", () => {
    const v = resolveBirth({ ...base, carrier: "shen_zhibai", bearerIsFenghou: true, cfg: NO_TWINS_NO_OMEN });
    expect(v.favor).toBe(30);
  });

  it("selfPregnancy auspicious: 65+10=75 (not clamped)", () => {
    const v = resolveBirth({ ...base, carrier: "sovereign", fatherId: null,
      transferredAtMonth: undefined, cfg: ALL_AUSPICIOUS });
    expect(v.favor).toBe(75);
  });

  it("selfPregnancy inauspicious: 65-10=55", () => {
    const v = resolveBirth({ ...base, carrier: "sovereign", fatherId: null,
      transferredAtMonth: undefined, cfg: ALL_INAUSPICIOUS });
    expect(v.favor).toBe(55);
  });
});

describe("resolveBirth — twins", () => {
  const base = {
    rngSeed: 1, now, carrier: "lu_huaijin", fatherId: "lu_huaijin",
    transferredAtMonth: 3, bearerIsFenghou: false,
    carrierRecord: emptyRecord, thresholds: DEFAULT_TIERS,
  } as const;

  it("100% dragon-phoenix → sex=son twinSex=daughter", () => {
    const v = resolveBirth({ ...base, cfg: ALL_DRAGON_PHOENIX });
    expect(v.sex).toBe("son");
    expect(v.twinSex).toBe("daughter");
    expect(v.twinFavor).toBeDefined();
  });

  it("100% twin daughters → sex=daughter twinSex=daughter", () => {
    const v = resolveBirth({ ...base, cfg: ALL_TWIN_DAUGHTERS });
    expect(v.sex).toBe("daughter");
    expect(v.twinSex).toBe("daughter");
  });

  it("100% twin sons → sex=son twinSex=son", () => {
    const v = resolveBirth({ ...base, cfg: ALL_TWIN_SONS });
    expect(v.sex).toBe("son");
    expect(v.twinSex).toBe("son");
  });

  it("0% twins → no twinSex", () => {
    const v = resolveBirth({ ...base, cfg: NO_TWINS_NO_OMEN });
    expect(v.twinSex).toBeUndefined();
    expect(v.twinFavor).toBeUndefined();
  });

  it("twinSex and twinFavor always paired (both present or both absent)", () => {
    for (const cfg of [NO_TWINS_NO_OMEN, ALL_DRAGON_PHOENIX, ALL_TWIN_DAUGHTERS, ALL_TWIN_SONS]) {
      for (let seed = 1; seed <= 5; seed++) {
        const v = resolveBirth({ ...base, rngSeed: seed, cfg });
        expect((v.twinSex !== undefined) === (v.twinFavor !== undefined)).toBe(true);
      }
    }
  });

  it("twinFavor is independently set from favor", () => {
    const v = resolveBirth({ ...base, cfg: ALL_DRAGON_PHOENIX });
    expect(v.favor).toBeGreaterThanOrEqual(0);
    expect(v.favor).toBeLessThanOrEqual(100);
    expect(v.twinFavor).toBeGreaterThanOrEqual(0);
    expect((v.twinFavor as number)).toBeLessThanOrEqual(100);
  });
});

describe("resolveBirth — birth omens", () => {
  const base = {
    rngSeed: 1, now, carrier: "sovereign", fatherId: null,
    transferredAtMonth: undefined, bearerIsFenghou: false,
    carrierRecord: emptyRecord, thresholds: DEFAULT_TIERS,
  } as const;

  it("100% auspicious → omen=auspicious, favor=65+10=75", () => {
    const v = resolveBirth({ ...base, cfg: ALL_AUSPICIOUS });
    expect(v.omen).toBe("auspicious");
    expect(v.omenText).toBeDefined();
    // self-preg base=65; auspicious +10 → 75 (not clamped)
    expect(v.favor).toBe(75);
  });

  it("100% inauspicious → omen=inauspicious, favor=65-10=55", () => {
    const v = resolveBirth({ ...base, cfg: ALL_INAUSPICIOUS });
    expect(v.omen).toBe("inauspicious");
    expect(v.omenText).toBeDefined();
    // self-preg base=65; inauspicious −10 → 55
    expect(v.favor).toBe(55);
  });

  it("0% omen → omen=null, no omenText", () => {
    const v = resolveBirth({ ...base, cfg: NO_TWINS_NO_OMEN });
    expect(v.omen).toBeNull();
    expect(v.omenText).toBeUndefined();
  });

  it("auspicious omen on tier-none consort → favor 15+10=25", () => {
    const v = resolveBirth({
      rngSeed: 1, now, carrier: "lu_huaijin", fatherId: "lu_huaijin",
      transferredAtMonth: 3, bearerIsFenghou: false,
      carrierRecord: emptyRecord, thresholds: DEFAULT_TIERS,
      cfg: ALL_AUSPICIOUS,
    });
    expect(v.bearerOutcome).toBe("safe");
    // tier none=15; auspicious +10 → 25
    expect(v.favor).toBe(25);
  });

  it("inauspicious omen on tier-none consort → favor 15-10=5", () => {
    const v = resolveBirth({
      rngSeed: 1, now, carrier: "lu_huaijin", fatherId: "lu_huaijin",
      transferredAtMonth: 3, bearerIsFenghou: false,
      carrierRecord: emptyRecord, thresholds: DEFAULT_TIERS,
      cfg: ALL_INAUSPICIOUS,
    });
    expect(v.bearerOutcome).toBe("safe");
    // tier none=15; inauspicious −10 → 5
    expect(v.favor).toBe(5);
  });

  it("twins each get independent omen rolls — different omens possible across seeds", () => {
    const cfg: GestationConfig = {
      ...ALL_DRAGON_PHOENIX,
      birthOmen: { auspiciousChance: 50, inauspiciousChance: 50, auspiciousFavorDelta: 10, inauspiciousFavorDelta: -10 },
    };
    const luBase = {
      now, carrier: "lu_huaijin" as const, fatherId: "lu_huaijin",
      transferredAtMonth: 3, bearerIsFenghou: false,
      carrierRecord: emptyRecord, thresholds: DEFAULT_TIERS,
    };
    let found = false;
    for (let seed = 1; seed <= 200; seed++) {
      const v = resolveBirth({ ...luBase, rngSeed: seed, cfg });
      if (v.twinOmen !== v.omen) {
        // Two children got different omens — proves rolls are independent
        expect(v.favor).not.toBe(v.twinFavor);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
