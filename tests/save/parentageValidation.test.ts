import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import { validateParentage } from "../../src/engine/save/parentageValidation";

const db: any = { characters: { c1: {} } };

function stateWithHeir(parentage: any, heir: any = { id: "heir_000001", fatherId: "c1" }) {
  const s = createInitialState();
  s.resources.bloodline.heirs.push(heir);
  s.parentage = parentage;
  return s;
}

describe("validateParentage", () => {
  it("每个 heir 必须有 parentage", () => {
    const s = stateWithHeir({});
    expect(validateParentage(s, db).map((e) => e.code)).toContain("PARENTAGE_MISSING_FOR_HEIR");
  });
  it("fatherId 镜像不一致 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "cX", legalMotherId: "sovereign", legalFatherId: "cX" } });
    expect(validateParentage(s, db).map((e) => e.code)).toContain("PARENTAGE_MIRROR_MISMATCH");
  });
  it("自指 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "heir_000001", legalMotherId: "sovereign", legalFatherId: "heir_000001" } }, { id: "heir_000001", fatherId: "heir_000001" });
    expect(validateParentage(s, db).map((e) => e.code)).toContain("PARENTAGE_SELF_REFERENCE");
  });
  it("biological 环 a→b→a → 失败", () => {
    const s = createInitialState();
    s.parentage = {
      heir_a: { biologicalMotherId: "heir_b", biologicalFatherId: null, legalMotherId: "heir_b", legalFatherId: null },
      heir_b: { biologicalMotherId: "heir_a", biologicalFatherId: null, legalMotherId: "heir_a", legalFatherId: null },
    } as any;
    expect(validateParentage(s, db).map((e) => e.code)).toContain("PARENTAGE_BIO_CYCLE");
  });
  it("legal 环 a→b→c→a → 失败", () => {
    const s = createInitialState();
    s.parentage = {
      heir_a: { biologicalMotherId: "sovereign", biologicalFatherId: null, legalMotherId: "heir_c", legalFatherId: null },
      heir_b: { biologicalMotherId: "sovereign", biologicalFatherId: null, legalMotherId: "heir_a", legalFatherId: null },
      heir_c: { biologicalMotherId: "sovereign", biologicalFatherId: null, legalMotherId: "heir_b", legalFatherId: null },
    } as any;
    expect(validateParentage(s, db).map((e) => e.code)).toContain("PARENTAGE_LEGAL_CYCLE");
  });
  it("合法共享祖先不是环 → 通过", () => {
    const s = createInitialState();
    s.resources.bloodline.heirs.push({ id: "heir_a", fatherId: "c1" } as any, { id: "heir_b", fatherId: "c1" } as any);
    s.parentage = {
      heir_a: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" },
      heir_b: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" },
    } as any;
    expect(validateParentage(s, db)).toEqual([]);
  });
  it("sovereign 引用合法、无环 → 通过", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" } });
    expect(validateParentage(s, db)).toEqual([]);
  });
  it("active AdoptionRecord 缺反向引用 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" } });
    s.adoptionRecords = { adopt_000001: { id: "adopt_000001", childId: "heir_000001", previousLegalMotherId: "sovereign", previousLegalFatherId: "c1", newLegalMotherId: "sovereign", newLegalFatherId: "c1", effectiveAt: makeGameTime(1, 1, "early"), reason: "preserve_branch", status: "active" } } as any;
    expect(validateParentage(s, db).map((e) => e.code)).toContain("ADOPTION_RECORD_UNREFERENCED");
  });
  it("未知 parent 引用 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "ghost", legalMotherId: "sovereign", legalFatherId: "ghost" } }, { id: "heir_000001", fatherId: "ghost" });
    expect(validateParentage(s, db).map((e) => e.code)).toContain("PARENTAGE_UNKNOWN_PERSON");
  });
  it("residence map key 与 id 不符 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" } });
    s.royalResidences = { res_000001: { id: "res_000002", holderId: "heir_000001", titleType: "fengzhu", spouseIds: [], lineage: { founderId: "heir_000001" } } } as any;
    expect(validateParentage(s, db).map((e) => e.code)).toContain("RESIDENCE_KEY_MISMATCH");
  });

  // parentage → record 正向不变量（验收 #22）
  const goodParentage = (legalFatherId: string | null = "c1", activeAdoptionRecordId?: string) =>
    ({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId, ...(activeAdoptionRecordId ? { activeAdoptionRecordId } : {}) } });
  const rec = (over: Record<string, unknown> = {}) =>
    ({ adopt_000001: { id: "adopt_000001", childId: "heir_000001", previousLegalMotherId: "sovereign", previousLegalFatherId: "c1", newLegalMotherId: "sovereign", newLegalFatherId: "c1", effectiveAt: makeGameTime(1, 1, "early"), reason: "preserve_branch", status: "active", ...over } });

  it.each([
    ["pointer 悬空（record 不存在）", () => stateWithHeir(goodParentage("c1", "adopt_000001")), "ADOPTION_POINTER_INVALID"],
    ["record childId 错误", () => { const s = stateWithHeir(goodParentage("c1", "adopt_000001")); s.adoptionRecords = rec({ childId: "heir_999999" }) as any; return s; }, "ADOPTION_POINTER_INVALID"],
    ["pointer 指向非 active", () => { const s = stateWithHeir(goodParentage("c1", "adopt_000001")); s.adoptionRecords = rec({ status: "revoked" }) as any; return s; }, "ADOPTION_POINTER_INVALID"],
  ])("%s → 失败", (_label, build, code) => {
    expect(validateParentage(build() as any, db).map((e) => e.code)).toContain(code);
  });

  it("active record legal 快照与当前 parentage 不一致 → 失败", () => {
    const s = stateWithHeir(goodParentage("c1", "adopt_000001"), { id: "heir_000001", fatherId: "c1" });
    s.adoptionRecords = rec({ newLegalFatherId: "c3" }) as any; // record 说 c3，parentage legal 是 c1
    expect(validateParentage(s, db).map((e) => e.code)).toContain("ADOPTION_RECORD_UNREFERENCED");
  });

  it("adoption map key 与 record.id 不一致 → 失败", () => {
    const s = stateWithHeir(goodParentage());
    s.adoptionRecords = { adopt_000001: { ...rec().adopt_000001, id: "adopt_000002", status: "revoked" } } as any;
    expect(validateParentage(s, db).map((e) => e.code)).toContain("ADOPTION_KEY_MISMATCH");
  });

  it("两条 active record 指向同一 child → 失败", () => {
    const s = stateWithHeir(goodParentage("c1", "adopt_000001"), { id: "heir_000001", fatherId: "c1" });
    s.adoptionRecords = {
      adopt_000001: rec().adopt_000001,
      adopt_000002: { ...rec().adopt_000001, id: "adopt_000002" }, // 第二条 active，同 child，未被 parentage 反向引用
    } as any;
    expect(validateParentage(s, db).map((e) => e.code)).toContain("ADOPTION_RECORD_UNREFERENCED");
  });
});
