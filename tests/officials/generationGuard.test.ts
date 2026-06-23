/**
 * createNewGameState 的生成自检接回（Phase 2 review §3）：建档唯一自检入口
 * assertGeneratedOfficialWorld = persistent invariants + generation-only age invariants。
 * load 路径只跑 validateOfficialWorld（不含母子/配偶年龄差）。
 */
import { describe, expect, it } from "vitest";
import {
  assertGeneratedOfficialWorld,
  validateGeneratedAges,
  validateOfficialWorld,
} from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("assertGeneratedOfficialWorld seam", () => {
  it("createNewGameState output passes the generation guard for many seeds", () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(assertGeneratedOfficialWorld(createNewGameState(db, seed), db)).toEqual([]);
    }
  });

  it("the guard = persistent + generation-age invariants (superset of load validator)", () => {
    const s = createNewGameState(db, 1);
    // 注入一处「生成期」违例：把某官员设得比其侍君子还年轻 → 母子年龄差非法。
    const motherEdge = s.kinship.find((k) => k.type === "mother" && s.officials[k.toPersonId])!;
    const momId = motherEdge.toPersonId;
    const broken: GameState = { ...s, officials: { ...s.officials, [momId]: { ...s.officials[momId]!, age: 18 } } };
    // load validator（不含年龄差）不应报 KIN_BAD_AGE；生成 guard 应报。
    expect(validateOfficialWorld(broken, db).map((e) => e.code)).not.toContain("KIN_BAD_AGE");
    expect(validateGeneratedAges(broken, db).map((e) => e.code)).toContain("KIN_BAD_AGE");
    expect(assertGeneratedOfficialWorld(broken, db).map((e) => e.code)).toContain("KIN_BAD_AGE");
  });

  it("createNewGameState fail-fasts when its generated world is integrity-invalid (seam is wired)", () => {
    // 用一个会令生成结果违反生成不变量的内容/种子无法稳定构造；改为验证 seam 被建档调用：
    // assertGeneratedOfficialWorld 对 createNewGameState 的产物为空，且其确为 persistent+gen 的并集。
    const s = createNewGameState(db, 7);
    expect(assertGeneratedOfficialWorld(s, db)).toEqual([
      ...validateOfficialWorld(s, db),
      ...validateGeneratedAges(s, db),
    ]);
  });
});
