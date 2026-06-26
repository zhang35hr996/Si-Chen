/**
 * Text-gate corpus (skeleton-plan §8 / PR 11). Every synthetic bad-output case
 * is rejected/flagged exactly as specced; authored content trivially passes.
 */
import { describe, expect, it } from "vitest";
import { buildTextGateContext, scanDialogueText } from "../../src/engine/dialogue/gates";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const huanghouCtx = buildTextGateContext(db, "huanghou"); // selfRefs: 臣侍/本宫
const chenghuiCtx = buildTextGateContext(db, "chenghui"); // selfRefs: 侍/侍身/本宫/我
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
    // chenghui does not use 臣侍; 臣侍 belongs to 驸-tier and above
    const findings = scanDialogueText("臣侍自有主张。", chenghuiCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ gate: "self_ref", matched: "臣侍" });
  });

  it("allows a speaker using their OWN selfRef", () => {
    expect(scanDialogueText("侍身累了。", chenghuiCtx)).toHaveLength(0);
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
