/**
 * Text-gate corpus (skeleton-plan §8 / PR 11). Every synthetic bad-output case
 * is rejected/flagged exactly as specced; authored content trivially passes.
 */
import { describe, expect, it } from "vitest";
import { buildTextGateContext, scanDialogueText } from "../../src/engine/dialogue/gates";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
// Default register = "private" — most tests target private harem context
const huanghouCtx = buildTextGateContext(db, "huanghou"); // selfRefs: 臣侍/本宫
const chenghuiCtx = buildTextGateContext(db, "chenghui"); // selfRefs: 臣侍/本宫/我
const siliCtx = buildTextGateContext(db, "sili_zhang"); // selfRefs: 臣/下官

describe("buildTextGateContext", () => {
  it("foreign selfRefs exclude the speaker's own and single-char refs", () => {
    // 皇后 uses 臣侍 herself, so 臣侍 is NOT foreign for her.
    expect(huanghouCtx.foreignSelfRefs).not.toContain("臣侍");
    // 下官 belongs to 司礼 — that is foreign for 皇后.
    expect(huanghouCtx.foreignSelfRefs).toContain("下官");
    // 本宫 is shared by 皇后/驸-tier ranks (their to-lower ref), so it is never "foreign".
    expect(huanghouCtx.foreignSelfRefs).not.toContain("本宫");
    // 「臣」 (司礼's toPlayer ref) is single-char — excluded to avoid 大臣/众臣.
    expect(huanghouCtx.foreignSelfRefs).not.toContain("臣");
  });

  it("wrongPlayerHonorifics is empty — 皇上/圣上/万岁/圣驾 are now context-restricted not globally wrong", () => {
    expect(huanghouCtx.wrongPlayerHonorifics).toEqual([]);
  });
});

describe("forbidden_lexicon gate", () => {
  it("rejects forbidden terms anywhere in the text", () => {
    const findings = scanDialogueText("你这般作态，倒像个嫔妃。", huanghouCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ gate: "forbidden_lexicon", severity: "reject", matched: "嫔妃" });
  });

  it("rejects 万岁爷 (a globally forbidden honorific)", () => {
    const findings = scanDialogueText("万岁爷圣明。", huanghouCtx);
    expect(findings.some((f) => f.gate === "forbidden_lexicon" && f.matched === "万岁爷")).toBe(true);
  });

  it("rejects 凤后 (forbidden — old title replaced by 皇后)", () => {
    const findings = scanDialogueText("凤后召见。", huanghouCtx);
    expect(findings.some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤后")).toBe(true);
  });

  it("does NOT reject 皇上 (context-restricted, not globally banned)", () => {
    const findings = scanDialogueText("皇上圣明。", huanghouCtx);
    expect(findings.every((f) => f.matched !== "皇上")).toBe(true);
  });
});

describe("self_ref gate", () => {
  it("rejects a speaker borrowing another rank's selfRef", () => {
    // chenghui uses 臣侍 (长御+ tier); 侍身 belongs to 少使/贵人 mid tier
    const findings = scanDialogueText("侍身自有主张。", chenghuiCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ gate: "self_ref", matched: "侍身" });
  });

  it("allows a speaker using their OWN selfRef", () => {
    expect(scanDialogueText("臣侍累了。", chenghuiCtx)).toHaveLength(0);
    expect(scanDialogueText("本宫累了。", huanghouCtx)).toHaveLength(0);
  });

  it("does not false-positive on compounds of single-char refs", () => {
    // 「臣」 is 司礼's ref but excluded; 「大臣」 must not trip the gate for 皇后.
    expect(scanDialogueText("满朝大臣皆知。", huanghouCtx)).toHaveLength(0);
  });
});

describe("rank_title gate", () => {
  it("returns no findings since WRONG_PLAYER_HONORIFICS is empty", () => {
    const findings = scanDialogueText("圣上万安。", siliCtx);
    const rankTitleFindings = findings.filter((f) => f.gate === "rank_title");
    expect(rankTitleFindings).toHaveLength(0);
  });

  it("accepts the canonical 陛下 address", () => {
    expect(scanDialogueText("陛下万安。", siliCtx)).toHaveLength(0);
  });
});

describe("template_leak gate", () => {
  it.each([
    ["{{speakerName}}向陛下行礼。", "{{speakerName}}"],
    ["{name}启奏。", "{name}"],
    ["你好，${user}。", "${user}"],
    ["[[selfRef]]叩首。", "[[selfRef]]"],
    ["<expression>陛下。", "<expression>"],
    ["臣回禀 %s 之事。", "%s"],
  ])("rejects leaked token in %s", (text, matched) => {
    const findings = scanDialogueText(text, huanghouCtx);
    expect(findings.some((f) => f.gate === "template_leak" && f.matched === matched)).toBe(true);
  });

  it("does not flag normal punctuation/CJK text", () => {
    expect(scanDialogueText("陛下驾临，臣侍有一事启奏。", huanghouCtx)).toHaveLength(0);
  });
});

describe("choice text uses content gates only (skipIdentityGates)", () => {
  it("a player choice may name another rank's selfRef without tripping self_ref", () => {
    // The 女帝 quoting 「本宫」 in a choice is not impersonation.
    expect(scanDialogueText("你莫要再说本宫如何如何。", huanghouCtx, { skipIdentityGates: true })).toHaveLength(0);
  });

  it("but forbidden terms and template leaks still apply to choices", () => {
    const findings = scanDialogueText("传旨给那嫔妃。", huanghouCtx, { skipIdentityGates: true });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ gate: "forbidden_lexicon", matched: "嫔妃" });
  });
});

describe("凤君 conditional permission gate — full register × speaker matrix", () => {
  // ── contexts built with explicit registers ───────────────────────────
  const huanghouPrivate  = buildTextGateContext(db, "huanghou",   [], "private");
  const huanghouIntimate = buildTextGateContext(db, "huanghou",   [], "intimate");
  const huanghouCourt    = buildTextGateContext(db, "huanghou",   [], "court");
  const huanghouPublic   = buildTextGateContext(db, "huanghou",   [], "public");

  const zhaoyiPrivate  = buildTextGateContext(db, "zhaoyi", [], "private");
  const zhaoyiIntimate = buildTextGateContext(db, "zhaoyi", [], "intimate");

  // Authorized 侍君/大臣: character-level permission via typed addressPermissions key
  const authConsortPrivate  = buildTextGateContext(db, "fu",          ["fengjun"], "private");
  const authConsortCourt    = buildTextGateContext(db, "fu",          ["fengjun"], "court");
  const authOfficialPrivate = buildTextGateContext(db, "sili_zhang",  ["fengjun"], "private");
  const authOfficialCourt   = buildTextGateContext(db, "sili_zhang",  ["fengjun"], "court");
  it("凤君 在 lexicon.forbiddenTerms 中（全局禁用）", () => {
    expect(db.lexicon.forbiddenTerms).toContain("凤君");
  });
  it("凤君 不在 lexicon.approvedTerms 中", () => {
    expect(db.lexicon.approvedTerms).not.toContain("凤君");
  });

  // ── 皇后 × register ─────────────────────────────────────────────────
  it("皇后 × private → 凤君通过", () => {
    expect(scanDialogueText("凤君今日心情不错。", huanghouPrivate).every((f) => f.matched !== "凤君")).toBe(true);
  });
  it("皇后 × intimate → 凤君通过", () => {
    expect(scanDialogueText("凤君今日心情不错。", huanghouIntimate).every((f) => f.matched !== "凤君")).toBe(true);
  });
  it("皇后 × court → 凤君被拒", () => {
    expect(scanDialogueText("凤君今日心情不错。", huanghouCourt).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });
  it("皇后 × public → 凤君被拒", () => {
    expect(scanDialogueText("凤君今日心情不错。", huanghouPublic).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });

  // ── 未授权侍君 ───────────────────────────────────────────────────────
  it("未授权侍君(zhaoyi) × private → 凤君被拒", () => {
    expect(scanDialogueText("凤君今日心情不错。", zhaoyiPrivate).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });
  it("未授权侍君(zhaoyi) × intimate → 凤君被拒", () => {
    expect(scanDialogueText("凤君今日心情不错。", zhaoyiIntimate).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });

  // ── 获授权亲密侍君 ───────────────────────────────────────────────────
  it("授权侍君 × private → 凤君通过", () => {
    expect(scanDialogueText("凤君今日心情不错。", authConsortPrivate).every((f) => f.matched !== "凤君")).toBe(true);
  });
  it("授权侍君 × court → 凤君仍被拒", () => {
    expect(scanDialogueText("凤君今日心情不错。", authConsortCourt).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });

  // ── 获授权亲信大臣 ───────────────────────────────────────────────────
  it("授权大臣 × private → 凤君通过", () => {
    expect(scanDialogueText("凤君今日心情不错。", authOfficialPrivate).every((f) => f.matched !== "凤君")).toBe(true);
  });
  it("授权大臣 × court → 凤君仍被拒", () => {
    expect(scanDialogueText("凤君今日心情不错。", authOfficialCourt).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });

  // ── 凤后不受豁免 ────────────────────────────────────────────────────
  it("皇后 × private → 凤后仍被拒（无凤后豁免）", () => {
    expect(scanDialogueText("凤后驾到。", huanghouPrivate).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤后")).toBe(true);
  });
});

describe("雄→雌 褒义词迁移 gate", () => {
  it("英雄被 gate 拒绝", () => {
    const findings = scanDialogueText("真乃一代英雄。", huanghouCtx);
    expect(findings.some((f) => f.gate === "forbidden_lexicon" && f.matched === "英雄")).toBe(true);
  });

  it("雄心壮志被拒绝", () => {
    const findings = scanDialogueText("此人颇有雄心壮志。", chenghuiCtx);
    expect(findings.some((f) => f.gate === "forbidden_lexicon" && f.matched === "雄心")).toBe(true);
  });

  it("一代枭雄被拒绝", () => {
    const findings = scanDialogueText("是一代枭雄。", siliCtx);
    expect(findings.some((f) => f.gate === "forbidden_lexicon" && f.matched === "枭雄")).toBe(true);
  });

  it("群雄逐鹿被拒绝", () => {
    const findings = scanDialogueText("群雄并起，逐鹿天下。", siliCtx);
    expect(findings.some((f) => f.gate === "forbidden_lexicon" && f.matched === "群雄")).toBe(true);
  });

  it("英雌通过 gate", () => {
    expect(scanDialogueText("真乃一代英雌。", huanghouCtx)).toHaveLength(0);
  });

  it("雌心壮志通过 gate", () => {
    expect(scanDialogueText("此人颇有雌心壮志。", chenghuiCtx)).toHaveLength(0);
  });

  it("枭雌通过 gate", () => {
    expect(scanDialogueText("是一代枭雌。", siliCtx)).toHaveLength(0);
  });

  it("群雌逐鹿通过 gate", () => {
    expect(scanDialogueText("群雌并起，逐鹿天下。", siliCtx)).toHaveLength(0);
  });

  it("雄性（生物性别标识）通过 gate — 不在禁词表", () => {
    // 单字「雄」未入禁词，作为生物性别标识合法
    expect(scanDialogueText("该犬为雄性。", siliCtx)).toHaveLength(0);
  });

  it("雄蕊（植物性别词）通过 gate", () => {
    expect(scanDialogueText("此花雄蕊甚多。", siliCtx)).toHaveLength(0);
  });
});

describe("authored content passes every gate (mock output is clean)", () => {
  it("no scene line or choice in shipped content trips any gate", () => {
    for (const scene of Object.values(db.scenes)) {
      for (const node of scene.nodes) {
        if (node.type === "line") {
          const speaker = db.characters[node.speaker]!;
          const ctx = buildTextGateContext(db, speaker.initialStanding?.rank ?? "");
          expect(scanDialogueText(node.text, ctx)).toEqual([]);
        }
        if (node.type === "choice") {
          for (const choice of node.choices) {
            const ctx = buildTextGateContext(db, "huanghou");
            expect(scanDialogueText(choice.text, ctx, { skipIdentityGates: true })).toEqual([]);
          }
        }
      }
    }
  });
});
