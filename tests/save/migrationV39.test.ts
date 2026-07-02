/**
 * Save format v38 → v39 migration (宗亲 Slice A 亲缘数据基础)。
 *   回填 parentage（legal=bio，母=sovereign）；adoptiveFatherId → custodianId；
 *   faction "adoptive" → "custodian"；新增 adoptionRecords/royalResidences + 两计数器。
 */
import { describe, expect, it } from "vitest";
import { MIGRATIONS, SAVE_FORMAT_VERSION } from "../../src/engine/save/saveSystem";

describe("v38 → v39 parentage 迁移", () => {
  it("SAVE_FORMAT_VERSION >= 39", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(39);
  });

  it("回填 parentage、rename custodian、flip faction、加空容器", () => {
    const env: unknown = {
      formatVersion: 38,
      state: {
        resources: {
          bloodline: {
            heirs: [
              { id: "heir_000001", fatherId: "lu_huaijin", adoptiveFatherId: "xu_qinghuan", faction: "adoptive" },
              { id: "heir_000002", fatherId: null, faction: "none" },
            ],
          },
        },
      },
    };
    const out = MIGRATIONS[38]!(env) as { formatVersion: number; state: any };
    expect(out.formatVersion).toBe(39);

    const h1 = out.state.resources.bloodline.heirs[0];
    expect(h1.custodianId).toBe("xu_qinghuan");
    expect(h1.adoptiveFatherId).toBeUndefined();
    expect(h1.faction).toBe("custodian");

    expect(out.state.parentage["heir_000001"]).toEqual({
      biologicalMotherId: "sovereign", biologicalFatherId: "lu_huaijin",
      legalMotherId: "sovereign", legalFatherId: "lu_huaijin",
    });
    expect(out.state.parentage["heir_000002"].biologicalFatherId).toBeNull();
    expect(out.state.parentage["heir_000002"].legalFatherId).toBeNull();

    expect(out.state.adoptionRecords).toEqual({});
    expect(out.state.royalResidences).toEqual({});
    expect(out.state.adoptionNextSeq).toBe(1);
    expect(out.state.royalResidenceNextSeq).toBe(1);
  });
});
