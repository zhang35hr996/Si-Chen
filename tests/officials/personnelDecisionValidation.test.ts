/** 人事决策 validator 闭环（Phase 3 PR3C-3b）：record key、去重、引用、官族匹配、状态/裁断一致性。 */
import { describe, expect, it } from "vitest";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, PersonnelDecision } from "../../src/engine/state/types";
import type { PunishmentRecord } from "../../src/engine/justice/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 5, period: "early" as const, dayIndex: y * 100 });
const LU_CONSORT = "lu_huaijin";
const LU_OFFICIAL = "official_fam_lu_main";

const codes = (s: GameState) => validateOfficialWorld(s, db).map((e) => e.code);

/** 注入一条侍君 PunishmentRecord（牵连来源）。 */
function withConsortPun(s: GameState, id = "pun_000001"): GameState {
  const rec: PunishmentRecord = {
    id, targetId: LU_CONSORT, targetKind: "consort", actorId: "player", kind: "rank_demotion",
    severity: "severe", imposedAt: at(2), publicity: "palace", lifecycle: { status: "active" },
    details: { fromRankId: "rank_a", toRankId: "rank_b" },
  };
  return { ...s, justice: { ...s.justice, punishments: { ...s.justice.punishments, [id]: rec } } };
}

/** 一条结构合法的待裁 petition 决策（基线）。 */
function basePetition(s: GameState): PersonnelDecision {
  const o = s.officials[LU_OFFICIAL]!;
  return {
    id: "pdec_000001", kind: "consort_petition_promotion", status: "pending", createdAt: at(3),
    sourceId: "petition:lu_huaijin:official_fam_lu_main:3", officialId: LU_OFFICIAL, consortId: LU_CONSORT,
    familyId: o.familyId, fromPostId: o.postId!, recommendedPostId: "libu_shangshu",
  };
}

function withDecisions(s: GameState, ...ds: PersonnelDecision[]): GameState {
  return { ...s, personnelDecisions: Object.fromEntries(ds.map((d) => [d.id, d])) };
}

describe("personnel decision validator — clean baseline", () => {
  it("a structurally valid pending decision passes", () => {
    const s = createNewGameState(db, 1);
    expect(codes(withDecisions(s, basePetition(s)))).toEqual([]);
  });

  it("a valid resolved decision passes", () => {
    const s = createNewGameState(db, 1);
    const d: PersonnelDecision = { ...basePetition(s), status: "resolved", resolvedAt: at(3), resolution: "approve" };
    expect(codes(withDecisions(s, d))).toEqual([]);
  });
});

describe("personnel decision validator — corruption", () => {
  it("record key ≠ id", () => {
    const s = createNewGameState(db, 1);
    const d = basePetition(s);
    const corrupt = { ...s, personnelDecisions: { wrong_key: d } };
    expect(codes(corrupt)).toContain("PDEC_KEY_MISMATCH");
  });

  it("duplicate sourceId", () => {
    const s = createNewGameState(db, 1);
    const a = basePetition(s);
    const b: PersonnelDecision = { ...a, id: "pdec_000002" };
    expect(codes(withDecisions(s, a, b))).toContain("PDEC_DUP_SOURCE");
  });

  it("bad officialId", () => {
    const s = createNewGameState(db, 1);
    expect(codes(withDecisions(s, { ...basePetition(s), officialId: "ghost" }))).toContain("PDEC_BAD_OFFICIAL");
  });

  it("bad consortId (points at an official, not a consort)", () => {
    const s = createNewGameState(db, 1);
    expect(codes(withDecisions(s, { ...basePetition(s), consortId: LU_OFFICIAL }))).toContain("PDEC_BAD_CONSORT");
  });

  it("bad familyId", () => {
    const s = createNewGameState(db, 1);
    expect(codes(withDecisions(s, { ...basePetition(s), familyId: "fam_ghost" }))).toContain("PDEC_BAD_FAMILY");
  });

  it("official/family mismatch", () => {
    const s = createNewGameState(db, 1);
    expect(codes(withDecisions(s, { ...basePetition(s), familyId: "fam_wen_main" }))).toContain("PDEC_FAMILY_MISMATCH");
  });

  it("bad post reference", () => {
    const s = createNewGameState(db, 1);
    expect(codes(withDecisions(s, { ...basePetition(s), recommendedPostId: "no_such_post" }))).toContain("PDEC_BAD_POST");
  });

  it("source punishment does not exist", () => {
    const s = withConsortPun(createNewGameState(db, 1));
    const d: PersonnelDecision = { ...basePetition(s), kind: "family_implication", sourceId: "implication:pun_000001", sourcePunishmentId: "pun_999999" };
    expect(codes(withDecisions(s, d))).toContain("PDEC_BAD_SOURCE_PUNISHMENT");
  });

  it("family implication missing source punishment", () => {
    const s = createNewGameState(db, 1);
    const d: PersonnelDecision = { ...basePetition(s), kind: "family_implication", sourceId: "implication:x" };
    expect(codes(withDecisions(s, d))).toContain("PDEC_IMPLICATION_NO_SOURCE");
  });

  it("family implication source is not a consort punishment", () => {
    const s = createNewGameState(db, 1);
    // 注入一条官员目标 punishment 充当非法来源。
    const offPun: PunishmentRecord = {
      id: "pun_000001", targetId: LU_OFFICIAL, targetKind: "official", actorId: "player", kind: "official_dismissal",
      severity: "severe", imposedAt: at(2), publicity: "palace",
      lifecycle: { status: "completed", resolvedAt: at(2), resolution: "immediate" }, details: { fromPostId: "guozijian_jijiu" },
    };
    const s2 = { ...s, justice: { ...s.justice, punishments: { pun_000001: offPun } } };
    const d: PersonnelDecision = { ...basePetition(s2), kind: "family_implication", sourceId: "implication:pun_000001", sourcePunishmentId: "pun_000001" };
    expect(codes(withDecisions(s2, d))).toContain("PDEC_SOURCE_NOT_CONSORT");
  });

  it("pending decision carrying a resolution", () => {
    const s = createNewGameState(db, 1);
    expect(codes(withDecisions(s, { ...basePetition(s), resolution: "approve" }))).toContain("PDEC_PENDING_WITH_RESOLUTION");
  });

  it("resolved decision missing resolvedAt/resolution", () => {
    const s = createNewGameState(db, 1);
    expect(codes(withDecisions(s, { ...basePetition(s), status: "resolved" }))).toContain("PDEC_RESOLVED_MISSING_FIELDS");
  });

  it("illegal resolution for kind", () => {
    const s = createNewGameState(db, 1);
    const d: PersonnelDecision = { ...basePetition(s), status: "resolved", resolvedAt: at(3), resolution: "demote" };
    expect(codes(withDecisions(s, d))).toContain("PDEC_BAD_RESOLUTION");
  });

  it("resolvedAt earlier than createdAt", () => {
    const s = createNewGameState(db, 1);
    const d: PersonnelDecision = { ...basePetition(s), status: "resolved", resolvedAt: at(1), resolution: "approve" };
    expect(codes(withDecisions(s, d))).toContain("PDEC_RESOLVED_BEFORE_CREATED");
  });
});

describe("personnel decision validator — kind-specific invariants", () => {
  it("petition missing recommendedPostId", () => {
    const s = createNewGameState(db, 1);
    const d = { ...basePetition(s) };
    delete (d as { recommendedPostId?: string }).recommendedPostId;
    expect(codes(withDecisions(s, d))).toContain("PDEC_MISSING_FIELD");
  });

  it("petition consort birthFamily ≠ decision.familyId", () => {
    const s = createNewGameState(db, 1);
    // consort shen_zhibai 母族 fam_shen_main，但 decision 用 fam_lu_main 官员/家族 → 侍君母族不匹配。
    const d: PersonnelDecision = { ...basePetition(s), consortId: "shen_zhibai" };
    expect(codes(withDecisions(s, d))).toContain("PDEC_CONSORT_FAMILY_MISMATCH");
  });

  it("memorial_promotion missing recommendedPostId", () => {
    const s = createNewGameState(db, 1);
    const off = s.officials[LU_OFFICIAL]!;
    const d: PersonnelDecision = {
      id: "pdec_000001", kind: "memorial_promotion", status: "pending", createdAt: at(3),
      sourceId: "memorial:memorial_promotion:official_fam_lu_main:3", officialId: LU_OFFICIAL,
      familyId: off.familyId, fromPostId: off.postId!,
    };
    expect(codes(withDecisions(s, d))).toContain("PDEC_MISSING_FIELD");
  });

  it("memorial_dismissal must not carry recommendedPostId", () => {
    const s = createNewGameState(db, 1);
    const off = s.officials[LU_OFFICIAL]!;
    const d: PersonnelDecision = {
      id: "pdec_000001", kind: "memorial_dismissal", status: "pending", createdAt: at(3),
      sourceId: "memorial:memorial_dismissal:official_fam_lu_main:3", officialId: LU_OFFICIAL,
      familyId: off.familyId, fromPostId: off.postId!, recommendedPostId: "zhixian",
    };
    expect(codes(withDecisions(s, d))).toContain("PDEC_DISMISSAL_WITH_TARGET");
  });

  it("family implication source punishment targets a different consort", () => {
    const s = withConsortPun(createNewGameState(db, 1)); // pun_000001 targets LU_CONSORT
    const off = s.officials[LU_OFFICIAL]!;
    const d: PersonnelDecision = {
      id: "pdec_000001", kind: "family_implication", status: "pending", createdAt: at(3),
      sourceId: "implication:pun_000001", officialId: LU_OFFICIAL, consortId: "shen_zhibai",
      familyId: off.familyId, fromPostId: off.postId!, sourcePunishmentId: "pun_000001",
    };
    expect(codes(withDecisions(s, d))).toContain("PDEC_SOURCE_TARGET_MISMATCH");
  });

  it("family implication missing familyId", () => {
    const s = withConsortPun(createNewGameState(db, 1));
    const off = s.officials[LU_OFFICIAL]!;
    const d: PersonnelDecision = {
      id: "pdec_000001", kind: "family_implication", status: "pending", createdAt: at(3),
      sourceId: "implication:pun_000001", officialId: LU_OFFICIAL, consortId: LU_CONSORT,
      fromPostId: off.postId!, sourcePunishmentId: "pun_000001",
      // familyId 缺失 → 关联校验失效缺口（本应被 kind-specific 校验拦下）。
    };
    expect(codes(withDecisions(s, d))).toContain("PDEC_MISSING_FIELD");
  });

  it("family implication official belongs to a different family", () => {
    const s = withConsortPun(createNewGameState(db, 1)); // 受罚侍君 LU_CONSORT，母族 fam_lu_main
    const WEN_OFFICIAL = "official_fam_wen_main"; // 别族官员
    const d: PersonnelDecision = {
      id: "pdec_000001", kind: "family_implication", status: "pending", createdAt: at(3),
      sourceId: "implication:pun_000001", officialId: WEN_OFFICIAL, consortId: LU_CONSORT,
      familyId: "fam_lu_main", fromPostId: s.officials[WEN_OFFICIAL]!.postId!, sourcePunishmentId: "pun_000001",
    };
    // 官员家族(fam_wen_main) ≠ decision.familyId(fam_lu_main) → 官族不匹配。
    expect(codes(withDecisions(s, d))).toContain("PDEC_FAMILY_MISMATCH");
  });

  it("family implication source punishment not severe enough", () => {
    const s = createNewGameState(db, 1);
    // 注入 moderate 来源 punishment。
    const moderate: PunishmentRecord = {
      id: "pun_000001", targetId: LU_CONSORT, targetKind: "consort", actorId: "player", kind: "rank_demotion",
      severity: "moderate", imposedAt: at(2), publicity: "palace", lifecycle: { status: "active" },
      details: { fromRankId: "rank_a", toRankId: "rank_b" },
    };
    const s2 = { ...s, justice: { ...s.justice, punishments: { pun_000001: moderate } } };
    const off = s2.officials[LU_OFFICIAL]!;
    const d: PersonnelDecision = {
      id: "pdec_000001", kind: "family_implication", status: "pending", createdAt: at(3),
      sourceId: "implication:pun_000001", officialId: LU_OFFICIAL, consortId: LU_CONSORT,
      familyId: off.familyId, fromPostId: off.postId!, sourcePunishmentId: "pun_000001",
    };
    expect(codes(withDecisions(s2, d))).toContain("PDEC_SOURCE_NOT_SEVERE");
  });
});
