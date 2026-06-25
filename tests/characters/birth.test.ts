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
      carrier: "lu_huaijin",
      fatherId: "lu_huaijin",
      transferredAtMonth: 3,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord, // no encounters → tier none → 0
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.fatherId).toBe("lu_huaijin");
    expect(v.legitimate).toBe(false);
    if (v.bearerOutcome === "safe") expect(v.favor).toBe(0);
  });

  it("fenghou bearer adds +30 (capped 80) and is legitimate", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "shen_zhibai",
      fatherId: "shen_zhibai",
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

  it("twinFavor is independently set from favor", () => {
    const v = resolveBirth({ ...base, cfg: ALL_DRAGON_PHOENIX });
    // Both favor values are numbers in [0,100]
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

  it("100% auspicious → omen=auspicious, favor += delta (clamped)", () => {
    const v = resolveBirth({ ...base, cfg: ALL_AUSPICIOUS });
    expect(v.omen).toBe("auspicious");
    expect(v.omenText).toBeDefined();
    // self-preg base=100; auspicious +10 → clamped to 100
    expect(v.favor).toBe(100);
  });

  it("100% inauspicious → omen=inauspicious, favor -= delta", () => {
    const v = resolveBirth({ ...base, cfg: ALL_INAUSPICIOUS });
    expect(v.omen).toBe("inauspicious");
    expect(v.omenText).toBeDefined();
    // self-preg base=100; inauspicious −10 → 90
    expect(v.favor).toBe(90);
  });

  it("0% omen → omen=null, no omenText", () => {
    const v = resolveBirth({ ...base, cfg: NO_TWINS_NO_OMEN });
    expect(v.omen).toBeNull();
    expect(v.omenText).toBeUndefined();
  });

  it("auspicious omen on tier-none consort → favor 0+10=10", () => {
    const v = resolveBirth({
      rngSeed: 1, now, carrier: "lu_huaijin", fatherId: "lu_huaijin",
      transferredAtMonth: 3, bearerIsFenghou: false,
      carrierRecord: emptyRecord, thresholds: DEFAULT_TIERS,
      cfg: ALL_AUSPICIOUS,
    });
    if (v.bearerOutcome === "safe") expect(v.favor).toBe(10);
  });

  it("inauspicious omen on tier-none consort → favor clamped to 0", () => {
    const v = resolveBirth({
      rngSeed: 1, now, carrier: "lu_huaijin", fatherId: "lu_huaijin",
      transferredAtMonth: 3, bearerIsFenghou: false,
      carrierRecord: emptyRecord, thresholds: DEFAULT_TIERS,
      cfg: ALL_INAUSPICIOUS,
    });
    if (v.bearerOutcome === "safe") expect(v.favor).toBe(0); // max(0-10, 0) = 0
  });

  it("twins each get independent omen rolls", () => {
    const cfg: GestationConfig = {
      ...ALL_DRAGON_PHOENIX,
      birthOmen: { auspiciousChance: 50, inauspiciousChance: 50, auspiciousFavorDelta: 10, inauspiciousFavorDelta: -10 },
    };
    const v = resolveBirth({ ...base, cfg });
    // Both omens are set (may be the same or different — both defined)
    expect(["auspicious", "inauspicious"]).toContain(v.omen);
    expect(v.twinOmen !== undefined).toBe(true);
  });
});
