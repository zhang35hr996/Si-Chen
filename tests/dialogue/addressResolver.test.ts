/**
 * PairwiseAddress resolver — special-role coverage:
 *  1. 太后 (elder) → player: address as 皇帝, kinship alternates, deferential selfRef
 *  2. Harem consorts → player: standard 陛下 + 皇上/圣上 alternates
 *  3. 皇后 → player: 本宫 in forbiddenInContext
 *  4. 皇后 → lower consort: 本宫 NOT forbidden; selfRef=本宫
 *  5. Non-harem target (official): targetOrder=MAX → consort uses deferential selfRef
 *  6. Non-harem target: targetAddress = display name, not internal ID
 */
import { describe, it, expect } from "vitest";
import { resolveAddress } from "../../src/engine/dialogue/addressResolver";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";

const db = loadRealContent();
const state = createNewGameState(db);

describe("resolveAddress — 太后 speaking to emperor (player)", () => {
  it("uses 皇帝 as targetAddress, not 陛下", () => {
    const addr = resolveAddress(db, state, "taihou", "player");
    expect(addr.targetAddress).toBe("皇帝");
  });

  it("offers kinship alternates 皇儿 and 吾儿", () => {
    const addr = resolveAddress(db, state, "taihou", "player");
    expect(addr.allowedAlternates).toContain("皇儿");
    expect(addr.allowedAlternates).toContain("吾儿");
  });

  it("selfRef is 哀家 (toPlayer form from taihou.selfRefs)", () => {
    const addr = resolveAddress(db, state, "taihou", "player");
    expect(addr.selfRef).toBe("哀家");
  });
});

describe("resolveAddress — harem consort speaking to emperor (player)", () => {
  it("皇后 (shen_zhibai) uses 陛下 and 皇上/圣上 alternates", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player");
    expect(addr.targetAddress).toBe("陛下");
    expect(addr.allowedAlternates).toContain("皇上");
    expect(addr.allowedAlternates).toContain("圣上");
  });

  it("皇后 has 本宫 in forbiddenInContext when speaking to emperor", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player");
    expect(addr.forbiddenInContext).toContain("本宫");
  });

  it("皇后 selfRef is 臣侍 when speaking to emperor (speakingUp)", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player");
    expect(addr.selfRef).toBe("臣侍");
  });
});

describe("resolveAddress — consort speaking DOWN to lower consort", () => {
  it("皇后 speaking to a lower-rank consort: 本宫 NOT in forbiddenInContext", () => {
    // shen_zhibai (huanghou, MAX order) speaking to lu_huaijin (chenghui, lower)
    const addr = resolveAddress(db, state, "shen_zhibai", "lu_huaijin");
    expect(addr.forbiddenInContext).not.toContain("本宫");
  });

  it("皇后 selfRef is 本宫 when speaking DOWN to lower consort", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "lu_huaijin");
    // formal[0] for 皇后 is 本宫
    expect(addr.selfRef).toBe("本宫");
  });
});

describe("resolveAddress — non-harem target (official / elder)", () => {
  it("high-rank consort uses deferential selfRef (not 本宫) when speaking to official", () => {
    // cheng_feng is kind=official; consort must not use 本宫 to an official
    const addr = resolveAddress(db, state, "shen_zhibai", "cheng_feng");
    expect(addr.selfRef).toBe("臣侍"); // deferential, not 本宫
    expect(addr.forbiddenInContext).toContain("本宫");
  });

  it("uses character display name as targetAddress, not internal ID", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "cheng_feng");
    const expectedName = db.characters["cheng_feng"]!.profile.name;
    expect(addr.targetAddress).toBe(expectedName);
    expect(addr.targetAddress).not.toBe("cheng_feng"); // must not be raw ID
  });

  it("太后 as target: uses 太后 display name", () => {
    // A consort addressing taihou (elder) gets display name
    const addr = resolveAddress(db, state, "shen_zhibai", "taihou");
    expect(addr.targetAddress).toBe("太后");
    expect(addr.selfRef).toBe("臣侍"); // elder outranks all consorts → speakingUp
    expect(addr.forbiddenInContext).toContain("本宫");
  });
});
