/**
 * Text-gate corpus (skeleton-plan §8 / PR 11). Every synthetic bad-output case
 * is rejected/flagged exactly as specced; authored content trivially passes.
 */
import { describe, expect, it } from "vitest";
import { buildTextGateContext, scanDialogueText } from "../../src/engine/dialogue/gates";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
// Default register = "public" (fail-closed)
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

  it("wrongPlayerHonorifics is empty — 圣上 is blocked via contextForbiddenRefs (target-scoped), not globally", () => {
    expect(huanghouCtx.wrongPlayerHonorifics).toEqual([]);
  });

  it("courtRestrictedHonorifics contains 皇上 (inner-quarters only — blocked in court AND public)", () => {
    expect(huanghouCtx.courtRestrictedHonorifics).toContain("皇上");
  });

  it("privateAllowedTerms starts empty — set externally by orchestrator from resolvedAddress", () => {
    expect(huanghouCtx.privateAllowedTerms).toEqual([]);
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

  it("does NOT reject 皇上 via forbidden_lexicon (context-restricted, not globally banned)", () => {
    const findingsPrivate = scanDialogueText("皇上圣明。", buildTextGateContext(db, "huanghou", "private"));
    expect(findingsPrivate.every((f) => f.gate !== "forbidden_lexicon" || f.matched !== "皇上")).toBe(true);
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
    expect(scanDialogueText("本宫累了。", buildTextGateContext(db, "huanghou", "private"))).toHaveLength(0);
  });

  it("does not false-positive on compounds of single-char refs", () => {
    // 「臣」 is 司礼's ref but excluded; 「大臣」 must not trip the gate for 皇后.
    expect(scanDialogueText("满朝大臣皆知。", huanghouCtx)).toHaveLength(0);
  });
});

describe("rank_title gate", () => {
  it("gate alone (without contextForbiddenRefs) does not block 圣上 — third-person uses in non-emperor conversations pass", () => {
    // 圣上 blocking is target-scoped: the orchestrator sets contextForbiddenRefs = ["圣上"]
    // only when target=player. Without that context, the gate cannot distinguish direct
    // address from third-person reference (e.g. "圣上已决" in a consort-to-consort scene).
    const ctx = buildTextGateContext(db, "sili_zhang", "private");
    const findings = scanDialogueText("圣上已决，臣侍遵旨。", ctx);
    const rankTitleFindings = findings.filter((f) => f.gate === "rank_title");
    expect(rankTitleFindings).toHaveLength(0);
  });

  it("圣上 rejected as direct address when contextForbiddenRefs = ['圣上'] (set by orchestrator for emperor-target)", () => {
    const ctx = buildTextGateContext(db, "huanghou", "private");
    ctx.contextForbiddenRefs = ["圣上"]; // simulates resolvedAddress.forbiddenInContext when target=player
    const findings = scanDialogueText("圣上万安。", ctx);
    expect(findings.some((f) => f.gate === "self_ref" && f.matched === "圣上")).toBe(true);
  });

  it("accepts the canonical 陛下 address in any register", () => {
    expect(scanDialogueText("陛下万安。", siliCtx)).toHaveLength(0);
  });

  it("rejects 皇上 in court register (too informal for formal audience)", () => {
    const courtCtx = buildTextGateContext(db, "huanghou", "court");
    const findings = scanDialogueText("皇上圣明。", courtCtx);
    expect(findings.some((f) => f.gate === "rank_title" && f.matched === "皇上")).toBe(true);
  });

  it("allows 皇上 in private register", () => {
    const privateCtx = buildTextGateContext(db, "huanghou", "private");
    expect(scanDialogueText("皇上圣明。", privateCtx).filter((f) => f.matched === "皇上")).toHaveLength(0);
  });

  it("rejects 皇上 in public register (inner-quarters address only — 陛下 required outside private/intimate)", () => {
    const publicCtx = buildTextGateContext(db, "huanghou", "public");
    expect(scanDialogueText("皇上圣明。", publicCtx).some((f) => f.gate === "rank_title" && f.matched === "皇上")).toBe(true);
  });

  it("allows 万岁 in court register (合法朝贺用词)", () => {
    const courtCtx = buildTextGateContext(db, "huanghou", "court");
    expect(scanDialogueText("皇上万岁。", courtCtx).filter((f) => f.gate === "rank_title" && f.matched === "万岁")).toHaveLength(0);
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
    expect(scanDialogueText("陛下驾临，臣侍有一事启奏。", buildTextGateContext(db, "huanghou", "private"))).toHaveLength(0);
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

describe("凤君 conditional gate — target × register × permission (via privateAllowedTerms)", () => {
  // privateAllowedTerms is set externally by the orchestrator from resolvedAddress.liftedForbiddenTerms.
  // These tests verify that the gate correctly honours/enforces those lifted terms.

  it("凤君 在 lexicon.forbiddenTerms 中（全局禁用）", () => {
    expect(db.lexicon.forbiddenTerms).toContain("凤君");
  });
  it("凤君 不在 lexicon.approvedTerms 中", () => {
    expect(db.lexicon.approvedTerms).not.toContain("凤君");
  });

  // ── gate honours lifted terms when privateAllowedTerms is set ─────────
  it("gate 允许凤君 当 privateAllowedTerms 包含凤君（resolver 已验证权限）", () => {
    const ctx = buildTextGateContext(db, "huanghou", "private");
    ctx.privateAllowedTerms = ["凤君"]; // simulates orchestrator setting from liftedForbiddenTerms
    expect(scanDialogueText("凤君今日心情不错。", ctx).every((f) => f.matched !== "凤君")).toBe(true);
  });

  it("gate 拒绝凤君 当 privateAllowedTerms 为空（无权限或 court register）", () => {
    const ctx = buildTextGateContext(db, "huanghou", "private");
    // privateAllowedTerms stays [] — resolver decided not to lift 凤君
    expect(scanDialogueText("凤君今日心情不错。", ctx).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });

  it("gate 在 court register 下拒绝凤君（即使 privateAllowedTerms 为空）", () => {
    const ctx = buildTextGateContext(db, "huanghou", "court");
    expect(scanDialogueText("凤君今日心情不错。", ctx).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });

  // ── player choice gate must not inherit NPC's privateAllowedTerms ─────
  it("player choice gate 不继承 NPC 的 privateAllowedTerms — 凤君仍被拒", () => {
    // Simulate orchestrator: NPC gets lifted terms, player choice gate gets none.
    const choiceCtx = buildTextGateContext(db, "huanghou", "private");
    // choiceCtx.privateAllowedTerms stays [] intentionally
    expect(scanDialogueText("凤君今日心情不错。", choiceCtx, { skipIdentityGates: true })
      .some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤君")).toBe(true);
  });

  // ── 凤后不受豁免 ────────────────────────────────────────────────────
  it("凤后 不能通过任何豁免", () => {
    const ctx = buildTextGateContext(db, "huanghou", "private");
    ctx.privateAllowedTerms = ["凤君"]; // only 凤君 is lifted, not 凤后
    expect(scanDialogueText("凤后驾到。", ctx).some((f) => f.gate === "forbidden_lexicon" && f.matched === "凤后")).toBe(true);
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
