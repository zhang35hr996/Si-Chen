/**
 * 殿选侍君的母族与亲缘持久化（review F5）：世家子弟入宫后母族关联与亲缘边必须原子写入，
 * 且经存档 round-trip 仍在；候选生母只能取自在任有效官员；动态侍君不被存档误判为 missing。
 */
import { describe, it, expect } from "vitest";
import {
  addGeneratedConsort,
  generateCandidates,
  type Candidate,
} from "../../src/store/grandSelection";
import {
  getOfficialRelativesOfConsort,
  getPalaceRelativesOfOfficial,
} from "../../src/engine/officials/selectors";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

/** 解包 addGeneratedConsort，失败即抛（用于「应当成功」的路径）。 */
function commit(state: GameState, c: Candidate, rank: string, favor: number, motherId?: string): GameState {
  const r = addGeneratedConsort(state, db, c.content, rank, favor, motherId);
  if (!r.ok) throw new Error(`addGeneratedConsort failed: ${r.error.code}`);
  return r.value;
}

/** 找一位带 motherOfficialId 的世家候选（跨年扫描）。 */
function findShijia(state: GameState): Candidate {
  for (const year of [1, 4, 7, 10, 13]) {
    const cand = generateCandidates(db, state, year).find((c) => c.motherOfficialId);
    if (cand) return cand;
  }
  throw new Error("no shijia candidate found");
}

describe("grand selection — family persistence", () => {
  it("世家候选礼官词为『官职之男』，且生母为在任官员", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    expect(cand.announce).toContain("之男");
    const mother = state.officials[cand.motherOfficialId!]!;
    expect(mother.status).toBe("active");
    expect(mother.postId).not.toBeNull();
  });

  it("入宫后双向亲缘可查，且通过 validator", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const motherId = cand.motherOfficialId!;
    const next = commit(state, cand, "guiren", 18, motherId);

    expect(getOfficialRelativesOfConsort(next, cand.content.id).map((o) => o.id)).toContain(motherId);
    expect(getPalaceRelativesOfOfficial(next, motherId)).toContain(cand.content.id);
    expect(next.standing[cand.content.id]!.birthFamilyId).toBe(state.officials[motherId]!.familyId);
    expect(validateOfficialWorld(next, db)).toEqual([]);
  });

  it("重复落库幂等：不产生重复亲缘边", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const motherId = cand.motherOfficialId!;
    const once = commit(state, cand, "guiren", 18, motherId);
    const twice = commit(once, cand, "guiren", 18, motherId);
    expect(twice.kinship.length).toBe(once.kinship.length);
    expect(twice).toBe(once); // 完全相同的重复提交：原样返回
  });

  it("动态侍君存档 round-trip 后母族与亲缘仍在（不被判 missing character）", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const motherId = cand.motherOfficialId!;
    const next = commit(state, cand, "guiren", 18, motherId);

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, next, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1234 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.standing[cand.content.id]!.birthFamilyId).toBe(state.officials[motherId]!.familyId);
    expect(getOfficialRelativesOfConsort(loaded.value.state, cand.content.id).map((o) => o.id)).toContain(motherId);
  });

  it("候选生母不取自已故官员", () => {
    const state = createNewGameState(db, 1);
    for (const id of Object.keys(state.officials)) {
      state.officials[id] = { ...state.officials[id]!, status: "dead", postId: null };
    }
    for (const year of [1, 4, 7]) {
      for (const c of generateCandidates(db, state, year)) {
        expect(c.motherOfficialId).toBeUndefined();
      }
    }
  });
});

describe("addGeneratedConsort — 重复/冲突提交", () => {
  it("二次提交缺失 motherOfficialId 不清除 birthFamilyId（冲突拒绝）", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const once = commit(state, cand, "guiren", 18, cand.motherOfficialId!);
    const r = addGeneratedConsort(once, db, cand.content, "guiren", 18); // 无 mother
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONSORT_FAMILY_CONFLICT");
  });

  it("二次提交不同 motherOfficialId 被拒绝（不致两个生母）", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const once = commit(state, cand, "guiren", 18, cand.motherOfficialId!);
    const otherOfficial = Object.values(state.officials).find((o) => o.id !== cand.motherOfficialId)!;
    const r = addGeneratedConsort(once, db, cand.content, "guiren", 18, otherOfficial.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONSORT_FAMILY_CONFLICT");
  });

  it("同 id 不同 content 不静默覆盖", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const once = commit(state, cand, "guiren", 18, cand.motherOfficialId!);
    const altered = { ...cand, content: { ...cand.content, profile: { ...cand.content.profile, name: "改名" } } };
    const r = addGeneratedConsort(once, db, altered.content, "guiren", 18, cand.motherOfficialId!);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONSORT_OVERWRITE_CONFLICT");
  });

  it("maternalClan 与母官员不符被拒绝", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    // 篡改 content.maternalClan.postId 使之与母官员不符。
    const bad = { ...cand.content, maternalClan: { ...cand.content.maternalClan!, postId: "no_such_post" } };
    const r = addGeneratedConsort(state, db, bad, "guiren", 18, cand.motherOfficialId!);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONSORT_CLAN_MISMATCH");
  });

  it("maternalClan 无 motherOfficialId（不成对）被拒绝", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const r = addGeneratedConsort(state, db, cand.content, "guiren", 18); // 有 clan 无 mother
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONSORT_CLAN_PAIRING");
  });

  it("motherOfficialId 无 maternalClan（不成对）被拒绝", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const stripped = { ...cand.content, maternalClan: undefined };
    const r = addGeneratedConsort(state, db, stripped, "guiren", 18, cand.motherOfficialId!);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONSORT_CLAN_PAIRING");
  });

  it("生母非 active 被拒绝", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const mid = cand.motherOfficialId!;
    state.officials[mid] = { ...state.officials[mid]!, status: "retired" };
    const r = addGeneratedConsort(state, db, cand.content, "guiren", 18, mid);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_NOT_ACTIVE");
  });

  it.each([
    ["authored character", "shen_zhibai"],
    ["official", "official_fam_shen_main"],
  ])("拒绝与既有 %s id 冲突的新侍君", (_label, conflictId) => {
    const state = createNewGameState(db, 1);
    const c = liangjiaziCandidate(state);
    const bad = { ...c.content, id: conflictId };
    const before = state.generatedConsorts;
    const r = addGeneratedConsort(state, db, bad, "guiren", 18);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("PERSON_ID_CONFLICT");
    expect(state.generatedConsorts).toBe(before); // 不变
  });

  it("拒绝与既有 FamilyMember id 冲突的新侍君", () => {
    const state = createNewGameState(db, 1);
    const memberId = Object.keys(state.familyMembers)[0]!;
    const c = liangjiaziCandidate(state);
    const r = addGeneratedConsort(state, db, { ...c.content, id: memberId }, "guiren", 18);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("PERSON_ID_CONFLICT");
  });

  it("generateCandidates 避开已占用的 xiunan id（确定性取下一个可用序号）", () => {
    const state = createNewGameState(db, 1);
    state.generatedConsorts = { ...state.generatedConsorts, ["xiunan_1_0"]: {} as never };
    const cands = generateCandidates(db, state, 1);
    const ids = cands.map((c) => c.content.id);
    expect(ids).not.toContain("xiunan_1_0");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/** 良家子候选（无母族）。 */
function liangjiaziCandidate(state: GameState): Candidate {
  for (const year of [1, 4, 7, 10]) {
    const c = generateCandidates(db, state, year).find((x) => !x.motherOfficialId);
    if (c) return c;
  }
  throw new Error("no 良家子 candidate");
}
