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
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const state = ["shen_zhibai","lu_huaijin"].reduce((st, id) => withConsort(st, db, id), createNewGameState(db));

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
  it("皇后 (shen_zhibai) uses 陛下; no alternates without register (fail-closed)", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player");
    expect(addr.targetAddress).toBe("陛下");
    expect(addr.allowedAlternates).toEqual([]); // 皇上 only in private/intimate
  });

  it("皇后 × private → 皇上 在 allowedAlternates（内廷日常）", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player", { register: "private" });
    expect(addr.allowedAlternates).toContain("皇上");
    expect(addr.allowedAlternates).not.toContain("圣上"); // 圣上 is third-person only
  });

  it("皇后 × court → allowedAlternates 为空（朝堂礼制：陛下唯一）", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player", { register: "court" });
    expect(addr.allowedAlternates).toEqual([]);
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

describe("resolveAddress — forbiddenInContext 圣上 (third-person form, blocked as direct address to emperor)", () => {
  it("target=player → forbiddenInContext 含圣上（所有 register 均适用）", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player");
    expect(addr.forbiddenInContext).toContain("圣上");
  });

  it("target=player × court → forbiddenInContext 仍含圣上", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player", { register: "court" });
    expect(addr.forbiddenInContext).toContain("圣上");
  });

  it("target=player × private → forbiddenInContext 含圣上（私下亦不得直称）", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player", { register: "private" });
    expect(addr.forbiddenInContext).toContain("圣上");
  });

  it("target ≠ player → forbiddenInContext 不含圣上（第三人称用途合法）", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "lu_huaijin");
    expect(addr.forbiddenInContext).not.toContain("圣上");
  });

  it("太后（elder）target=player → forbiddenInContext 含圣上", () => {
    const addr = resolveAddress(db, state, "taihou", "player");
    expect(addr.forbiddenInContext).toContain("圣上");
  });
});

describe("resolveAddress — liftedForbiddenTerms (凤君 conditional permission)", () => {
  it("皇后 × target=player × private → liftedForbiddenTerms 含凤君", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player", { register: "private" });
    expect(addr.liftedForbiddenTerms).toContain("凤君");
    expect(addr.allowedAlternates).toContain("凤君");
  });

  it("皇后 × target=player × intimate → liftedForbiddenTerms 含凤君", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player", { register: "intimate" });
    expect(addr.liftedForbiddenTerms).toContain("凤君");
  });

  it("皇后 × target=player × court → liftedForbiddenTerms 不含凤君", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player", { register: "court" });
    expect(addr.liftedForbiddenTerms).not.toContain("凤君");
    expect(addr.allowedAlternates).not.toContain("凤君");
  });

  it("皇后 × target=player × public → liftedForbiddenTerms 不含凤君", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player", { register: "public" });
    expect(addr.liftedForbiddenTerms).not.toContain("凤君");
  });

  it("未授权侍君 × target=player × private → liftedForbiddenTerms 不含凤君", () => {
    // lu_huaijin is chenghui rank — no fengjun permission
    const addr = resolveAddress(db, state, "lu_huaijin", "player", { register: "private" });
    expect(addr.liftedForbiddenTerms).not.toContain("凤君");
  });

  it("获授权 addressPermissions=['fengjun'] × private → liftedForbiddenTerms 含凤君", () => {
    // Pass typed permission key — simulates character with dialoguePolicy.addressPermissions: ["fengjun"]
    const addr = resolveAddress(db, state, "lu_huaijin", "player", {
      register: "private",
      addressPermissions: ["fengjun"],
    });
    expect(addr.liftedForbiddenTerms).toContain("凤君");
    expect(addr.allowedAlternates).toContain("凤君");
  });

  it("获授权 × court → liftedForbiddenTerms 不含凤君（register 不满足）", () => {
    const addr = resolveAddress(db, state, "lu_huaijin", "player", {
      register: "court",
      addressPermissions: ["fengjun"],
    });
    expect(addr.liftedForbiddenTerms).not.toContain("凤君");
  });

  it("太后（elder）× private → liftedForbiddenTerms 不含凤君（elders 不用凤君）", () => {
    const addr = resolveAddress(db, state, "taihou", "player", { register: "private" });
    expect(addr.liftedForbiddenTerms).not.toContain("凤君");
  });

  it("target 非皇帝 → liftedForbiddenTerms 为空（权限只限对皇帝）", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "lu_huaijin", { register: "private" });
    expect(addr.liftedForbiddenTerms).toHaveLength(0);
  });

  it("无 register 选项 → liftedForbiddenTerms 为空（不推断 register）", () => {
    const addr = resolveAddress(db, state, "shen_zhibai", "player");
    expect(addr.liftedForbiddenTerms).toHaveLength(0);
  });
});

describe("resolveAddress — non-harem target (official / elder)", () => {
  it("high-rank consort uses deferential selfRef (not 本宫) when speaking to official", () => {
    // cheng_feng is kind=official; consort must not use 本宫 to an official
    const addr = resolveAddress(db, state, "shen_zhibai", "cheng_feng");
    expect(addr.selfRef).toBe("臣侍"); // deferential, not 本宫
    expect(addr.forbiddenInContext).toContain("本宫");
  });

  it("uses profile.name as targetAddress fallback, not raw internal ID", () => {
    // Register-aware addressing (大人/司礼/先生 by role) is follow-up scope.
    // This test locks in the minimum: profile.name beats a raw character ID.
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
