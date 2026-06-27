/**
 * 称谓系统权威化 — address system rules tests.
 *
 * Covers:
 *  1. New rank IDs exist; old 君-family IDs are gone.
 *  2. huanghou selfRefs = 臣侍 (not 臣后).
 *  3. fu-and-above use 臣侍 selfRefs.
 *  4. Middle ranks (zhaoyi…changyu) use 侍/侍身 selfRefs.
 *  5. Low ranks (shaoshi…guannanzi) use 我/小侍 selfRefs.
 *  6. 万岁爷, 凤后, 娘娘 in forbiddenTerms.
 *  7. 皇上 NOT in forbiddenTerms (context-restricted, not global ban).
 *  8. WRONG_PLAYER_HONORIFICS is empty; 皇上 blocked via courtRestrictedHonorifics in non-private registers.
 *  9. Save migration v26→v27 remaps old 君-family rank IDs.
 */
import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";
import { buildTextGateContext, scanDialogueText } from "../../src/engine/dialogue/gates";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
  createSaveData,
  MIGRATIONS,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

describe("rank ID canonicalization", () => {
  it("new 驸-family ranks exist", () => {
    for (const id of ["huanghou", "huangguifu", "guifu", "xianfu", "liangfu", "defu", "fu"]) {
      expect(db.ranks[id], `rank ${id} should exist`).toBeDefined();
    }
  });

  it("old 君-family ranks are absent", () => {
    for (const id of ["fenghou", "huangguijun", "guijun", "jun", "zhaorong"]) {
      expect(db.ranks[id], `rank ${id} should be absent`).toBeUndefined();
    }
  });

  it("huanghou has the highest order among harem ranks", () => {
    const haremRanks = Object.values(db.ranks).filter((r) => r.domain === "harem");
    const max = Math.max(...haremRanks.map((r) => r.order));
    expect(db.ranks["huanghou"]!.order).toBe(max);
  });
});

describe("selfRefs tiers", () => {
  const CHEN_SHI_TIER = [
    "huanghou", "huangguifu", "guifu", "xianfu", "liangfu", "defu", "fu",
    "zhaoyi", "zhaohui", "zhaode",
    "chengyi", "chenghui", "chengde", "jieyu", "shichen",
    "changyu",
  ];
  const SHI_TIER = [
    "shaoshi", "guiren", "liangren", "meiren", "cairen",
  ];
  const WO_TIER = ["changzai", "daying", "gengyi", "xuanshi", "guannanzi"];

  it("huanghou selfRefs.toPlayer contains 臣侍, NOT 臣后", () => {
    const r = db.ranks["huanghou"]!;
    expect(r.selfRefs.toPlayer).toContain("臣侍");
    expect(r.selfRefs.toPlayer).not.toContain("臣后");
  });

  it.each(CHEN_SHI_TIER)("%s (驸 tier) uses 臣侍 in selfRefs", (id) => {
    const r = db.ranks[id];
    expect(r, `rank ${id} should exist`).toBeDefined();
    const all = [...r!.selfRefs.toPlayer, ...r!.selfRefs.formal, ...(r!.selfRefs.informal ?? [])];
    expect(all).toContain("臣侍");
  });

  it.each(SHI_TIER)("%s (中品) uses 侍/侍身 in selfRefs", (id) => {
    const r = db.ranks[id];
    expect(r, `rank ${id} should exist`).toBeDefined();
    const all = [...r!.selfRefs.toPlayer, ...r!.selfRefs.formal, ...(r!.selfRefs.informal ?? [])];
    const hasShi = all.some((s) => s === "侍" || s === "侍身");
    expect(hasShi, `rank ${id} should have 侍 or 侍身`).toBe(true);
  });

  it.each(WO_TIER)("%s (低品) uses 我 or 小侍 in formal selfRefs", (id) => {
    const r = db.ranks[id];
    expect(r, `rank ${id} should exist`).toBeDefined();
    const formal = r!.selfRefs.formal;
    const hasWo = formal.some((s) => s === "我" || s === "小侍");
    expect(hasWo, `rank ${id} should have 我 or 小侍 in formal`).toBe(true);
  });
});

describe("lexicon forbidden terms", () => {
  it("万岁爷 is in forbiddenTerms", () => {
    expect(db.lexicon.forbiddenTerms).toContain("万岁爷");
  });

  it("凤后 is in forbiddenTerms", () => {
    expect(db.lexicon.forbiddenTerms).toContain("凤后");
  });

  it("娘娘 is in forbiddenTerms", () => {
    expect(db.lexicon.forbiddenTerms).toContain("娘娘");
  });

  it("皇上 is NOT in forbiddenTerms (context-restricted, not globally banned)", () => {
    expect(db.lexicon.forbiddenTerms).not.toContain("皇上");
  });
});

describe("gates WRONG_PLAYER_HONORIFICS", () => {
  it("buildTextGateContext for any rank returns empty wrongPlayerHonorifics", () => {
    const ctx = buildTextGateContext(db, "zhaoyi");
    expect(ctx.wrongPlayerHonorifics).toEqual([]);
  });

  it("皇上 fires rank_title via courtRestrictedHonorifics in non-private register (inner-quarters address only)", () => {
    // 皇上 is NOT in wrongPlayerHonorifics, but IS in courtRestrictedHonorifics.
    // Default (public) register → rank_title reject.
    const ctx = buildTextGateContext(db, "zhaoyi"); // default = "public"
    const findings = scanDialogueText("陛下，皇上近日龙体如何？", ctx);
    const rankFindings = findings.filter((f) => f.gate === "rank_title");
    expect(rankFindings.some((f) => f.matched === "皇上")).toBe(true);
  });

  it("万岁爷 fires forbidden_lexicon gate (not rank_title)", () => {
    const ctx = buildTextGateContext(db, "zhaoyi");
    const findings = scanDialogueText("臣侍见过万岁爷。", ctx);
    const gateIds = findings.map((f) => f.gate);
    expect(gateIds).toContain("forbidden_lexicon");
    expect(gateIds).not.toContain("rank_title");
  });
});

describe("save migration v26→v27 rank remapping", () => {
  function makeV26Save(rankOverrides: Record<string, string>): string {
    const s = createNewGameState(db);
    const stateV26 = structuredClone(s) as GameState;
    for (const [charId, rankId] of Object.entries(rankOverrides)) {
      if (stateV26.standing[charId]) {
        stateV26.standing[charId]!.rank = rankId;
      }
    }
    const current = createSaveData(db, s, "slot1");
    return JSON.stringify({
      ...current,
      formatVersion: 26,
      state: stateV26,
      checksum: checksumOf(stateV26),
    });
  }

  it("SAVE_FORMAT_VERSION is >= 27", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(27);
  });

  it("fenghou → huanghou in standing.rank", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV26Save({ shen_zhibai: "fenghou" }));
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.standing["shen_zhibai"]?.rank).toBe("huanghou");
  });

  it("huangguijun → huangguifu", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV26Save({ shen_zhibai: "huangguijun" }));
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.standing["shen_zhibai"]?.rank).toBe("huangguifu");
  });

  it("guijun → guifu", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV26Save({ lu_huaijin: "guijun" }));
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.standing["lu_huaijin"]?.rank).toBe("guifu");
  });

  it("jun → fu", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV26Save({ xu_qinghuan: "jun" }));
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.standing["xu_qinghuan"]?.rank).toBe("fu");
  });

  it("guifu (old 正二品 贵驸) → zhaoyi", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV26Save({ xu_qinghuan: "guifu" }));
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.standing["xu_qinghuan"]?.rank).toBe("zhaoyi");
  });

  it("zhaorong → zhaode", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV26Save({ xu_qinghuan: "zhaorong" }));
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.standing["xu_qinghuan"]?.rank).toBe("zhaode");
  });

  it("ranks not in remap are unchanged", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV26Save({ xu_qinghuan: "meiren" }));
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.standing["xu_qinghuan"]?.rank).toBe("meiren");
  });

  it("deathRecord.originalRankId is remapped (fenghou → huanghou)", () => {
    const s = createNewGameState(db);
    const stateV26 = structuredClone(s) as GameState;
    if (stateV26.standing["shen_zhibai"]) {
      (stateV26.standing["shen_zhibai"] as unknown as { deathRecord: unknown }).deathRecord = {
        diedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
        cause: "illness",
        originalRankId: "fenghou",
      };
    }
    const current = createSaveData(db, s, "slot1");
    const raw = JSON.stringify({
      ...current,
      formatVersion: 26,
      state: stateV26,
      checksum: checksumOf(stateV26),
    });
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, raw);
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dr = (result.value.state.standing["shen_zhibai"] as { deathRecord?: { originalRankId: string } })?.deathRecord;
    expect(dr?.originalRankId).toBe("huanghou");
  });

  it("deathRecord.posthumousRankId is remapped (guijun → guifu)", () => {
    const s = createNewGameState(db);
    const stateV26 = structuredClone(s) as GameState;
    if (stateV26.standing["shen_zhibai"]) {
      (stateV26.standing["shen_zhibai"] as unknown as { deathRecord: unknown }).deathRecord = {
        diedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
        cause: "scripted",
        originalRankId: "fenghou",
        posthumousRankId: "guijun",
      };
    }
    const current = createSaveData(db, s, "slot1");
    const raw = JSON.stringify({
      ...current,
      formatVersion: 26,
      state: stateV26,
      checksum: checksumOf(stateV26),
    });
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, raw);
    const result = readSlot(storage, db, "slot1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dr = (result.value.state.standing["shen_zhibai"] as { deathRecord?: { posthumousRankId?: string } })?.deathRecord;
    expect(dr?.posthumousRankId).toBe("guifu");
  });

  // For the remaining branches, we test MIGRATIONS[26] directly to avoid
  // having to construct full schema-valid fixtures for chronicle/justice/generatedConsorts.
  function applyMig26(state: unknown): unknown {
    const envelope = { formatVersion: 26, state, checksum: "" };
    const out = MIGRATIONS[26]!(envelope) as { state: unknown };
    return out.state;
  }

  it("generatedConsorts.initialStanding.rank is remapped (jun → fu)", () => {
    const state = {
      standing: {}, chronicle: [], generatedConsorts: {
        gen_test_001: { initialStanding: { rank: "jun" } },
      },
      justice: { punishments: {} },
    };
    const after = applyMig26(state) as typeof state;
    expect(after.generatedConsorts["gen_test_001"]?.initialStanding?.rank).toBe("fu");
  });

  it("chronicle rank_changed payload.from/to fields are remapped", () => {
    const state = {
      standing: {}, generatedConsorts: {}, justice: { punishments: {} },
      chronicle: [{ type: "rank_changed", payload: { from: "fenghou", to: "huangguijun" } }],
    };
    const after = applyMig26(state) as typeof state;
    const p = after.chronicle[0]!.payload as Record<string, string>;
    expect(p.from).toBe("huanghou");
    expect(p.to).toBe("huangguifu");
  });

  it("chronicle rank_changed payload.fromRankId/toRankId are remapped (haremAdminCommands path)", () => {
    const state = {
      standing: {}, generatedConsorts: {}, justice: { punishments: {} },
      chronicle: [{ type: "rank_changed", payload: { fromRankId: "guijun", toRankId: "zhaorong" } }],
    };
    const after = applyMig26(state) as typeof state;
    const p = after.chronicle[0]!.payload as Record<string, string>;
    expect(p.fromRankId).toBe("guifu");
    expect(p.toRankId).toBe("zhaode");
  });

  it("justice rank_demotion details.fromRankId/toRankId are remapped", () => {
    const state = {
      standing: {}, chronicle: [], generatedConsorts: {},
      justice: {
        punishments: {
          pun_test01: { kind: "rank_demotion", details: { fromRankId: "jun", toRankId: "guifu" } },
        },
      },
    };
    const after = applyMig26(state) as typeof state;
    const pun = after.justice.punishments["pun_test01"] as { details: { fromRankId: string; toRankId: string } };
    expect(pun.details.fromRankId).toBe("fu");
    expect(pun.details.toRankId).toBe("zhaoyi");
  });
});
