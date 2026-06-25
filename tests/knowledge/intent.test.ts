/**
 * Unit tests for classifyQueryIntent.
 *
 * The classifier must distinguish runtime-state lookups (who is currently X)
 * from static-lore questions (what is the rule about X).
 */
import { describe, expect, it } from "vitest";
import { classifyQueryIntent } from "../../src/engine/knowledge/intent";

describe("classifyQueryIntent — runtime_state", () => {
  it.each([
    ["当前谁最受宠", "current favourite — person + temporal"],
    ["谁现在怀孕了", "who is pregnant now — person + temporal"],
    ["后宫里谁暗恋着谁", "who has a crush — person + dynamic vocab"],
    ["昨天谁被禁足了", "who was confined yesterday — person + temporal"],
    ["最近谁请病假身体不好", "who took sick leave recently — person + temporal"],
    ["目前哪位皇嗣最有望继承大统", "which heir is most likely — person + temporal"],
  ])("classifies '%s' as runtime_state (%s)", (query) => {
    expect(classifyQueryIntent(query)).toBe("runtime_state");
  });
});

describe("classifyQueryIntent — static_lore", () => {
  it.each([
    ["目前正式使用的后宫位分有哪些", "rank-order question: 位分 overrides 目前"],
    ["现在的承养制度是怎样的", "institution question: 制度 overrides 现在"],
    ["禁足在礼制中属于什么处罚", "punishment classification: 礼制 overrides 禁足"],
    ["怀孕期间是否照常视事", "rule about duty during pregnancy: 期间 overrides 怀孕"],
    ["宣召臣下应遵循什么礼仪", "etiquette for summons: no person+temporal conjunction"],
    ["贵人对皇帝如何自称", "self-reference etiquette: 如何称 triggers static"],
    ["男子可以入仕做官吗", "general rule — no temporal or dynamic markers"],
    ["皇帝的男性子嗣叫什么", "title question — no markers"],
    ["谁可以自称本宫", "rule about who may use title — 谁 present but no temporal/dynamic"],
    ["高侧和低侧谁地位更高", "status question — 谁 present but no temporal/dynamic vocab"],
  ])("classifies '%s' as static_lore (%s)", (query) => {
    expect(classifyQueryIntent(query)).toBe("static_lore");
  });
});
