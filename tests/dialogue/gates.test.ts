/**
 * Text-gate corpus (skeleton-plan §8 / PR 11). Every synthetic bad-output case
 * is rejected/flagged exactly as specced; authored content trivially passes.
 */
import { describe, expect, it } from "vitest";
import { buildTextGateContext, scanDialogueText } from "../../src/engine/dialogue/gates";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fenghouCtx = buildTextGateContext(db, "fenghou"); // selfRefs: 臣后/本宫
const chenghuiCtx = buildTextGateContext(db, "chenghui"); // selfRefs: 侍/侍身/我 (本宫 to-lower)
const siliCtx = buildTextGateContext(db, "sili_zhang"); // selfRefs: 臣/下官

describe("buildTextGateContext", () => {
  it("foreign selfRefs exclude the speaker's own and single-char refs", () => {
    // 凤后 may say 本宫; she may NOT borrow 臣侍 (君) or 下官 (司礼).
    expect(fenghouCtx.foreignSelfRefs).toContain("臣侍");
    expect(fenghouCtx.foreignSelfRefs).toContain("下官");
    // 本宫 is shared by 凤后/君/承徽 (their to-lower ref), so it is never "foreign".
    expect(fenghouCtx.foreignSelfRefs).not.toContain("本宫");
    // 「臣」 (司礼's toPlayer ref) is single-char — excluded to avoid 大臣/众臣.
    expect(fenghouCtx.foreignSelfRefs).not.toContain("臣");
  });

  it("forbidden player honorifics drop ones already in the forbidden lexicon", () => {
    // 皇上 is in forbiddenTerms → it fires under forbidden_lexicon, not rank_title.
    expect(fenghouCtx.wrongPlayerHonorifics).not.toContain("皇上");
    expect(fenghouCtx.wrongPlayerHonorifics).toContain("圣上");
  });
});

describe("forbidden_lexicon gate", () => {
  it("rejects forbidden terms anywhere in the text", () => {
    const findings = scanDialogueText("你这般作态，倒像个嫔妃。", fenghouCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ gate: "forbidden_lexicon", severity: "reject", matched: "嫔妃" });
  });

  it("rejects 皇上 (a forbidden player honorific)", () => {
    const findings = scanDialogueText("皇上圣明。", fenghouCtx);
    expect(findings.some((f) => f.gate === "forbidden_lexicon" && f.matched === "皇上")).toBe(true);
  });
});

describe("self_ref gate", () => {
  it("rejects a speaker borrowing another rank's selfRef", () => {
    const findings = scanDialogueText("臣后自有主张。", chenghuiCtx); // 承徽 using 凤后's 臣后
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ gate: "self_ref", matched: "臣后" });
  });

  it("allows a speaker using their OWN selfRef", () => {
    expect(scanDialogueText("侍身累了。", chenghuiCtx)).toHaveLength(0);
    expect(scanDialogueText("本宫累了。", fenghouCtx)).toHaveLength(0);
  });

  it("does not false-positive on compounds of single-char refs", () => {
    // 「臣」 is 司礼's ref but excluded; 「大臣」 must not trip the gate for 凤后.
    expect(scanDialogueText("满朝大臣皆知。", fenghouCtx)).toHaveLength(0);
  });
});

describe("rank_title gate", () => {
  it("rejects wrong honorifics for the 女帝", () => {
    const findings = scanDialogueText("圣上万安。", siliCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ gate: "rank_title", matched: "圣上" });
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
    const findings = scanDialogueText(text, fenghouCtx);
    expect(findings.some((f) => f.gate === "template_leak" && f.matched === matched)).toBe(true);
  });

  it("does not flag normal punctuation/CJK text", () => {
    expect(scanDialogueText("陛下驾临，臣后有一事启奏。", fenghouCtx)).toHaveLength(0);
  });
});

describe("choice text uses content gates only (skipIdentityGates)", () => {
  it("a player choice may name another rank's selfRef without tripping self_ref", () => {
    // The 女帝 quoting 「本宫」 in a choice is not impersonation.
    expect(scanDialogueText("你莫要再说本宫如何如何。", fenghouCtx, { skipIdentityGates: true })).toHaveLength(0);
  });

  it("but forbidden terms and template leaks still apply to choices", () => {
    const findings = scanDialogueText("传旨给那娘娘。", fenghouCtx, { skipIdentityGates: true });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ gate: "forbidden_lexicon", matched: "娘娘" });
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
            // Choices are scanned with the participants' contexts; any is fine
            // since identity gates are skipped for choices.
            const ctx = buildTextGateContext(db, "fenghou");
            expect(scanDialogueText(choice.text, ctx, { skipIdentityGates: true })).toEqual([]);
          }
        }
      }
    }
  });
});
