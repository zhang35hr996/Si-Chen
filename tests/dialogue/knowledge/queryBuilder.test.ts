/**
 * Suite A: buildDialogueKnowledgeQuery — deterministic output, field order,
 * whitespace normalization, length bounding, transcript selection.
 */
import { describe, it, expect } from "vitest";
import {
  buildDialogueKnowledgeQuery,
  getLatestTargetUtterance,
} from "../../../src/engine/dialogue/knowledge/queryBuilder";
import type { DialogueRequest } from "../../../src/engine/dialogue/types";
import type { GameTime } from "../../../src/engine/calendar/time";

const now: GameTime = { year: 1, month: 1, period: "early", dayIndex: 0 };

function fakeRequest(
  overrides: Partial<Pick<DialogueRequest, "sceneDirective" | "topicTags" | "transcript">> = {},
): DialogueRequest {
  return {
    speakerId: "shen_zhibai",
    targetId: "player",
    locationId: "zichendian",
    time: now,
    speakerContext: {
      profile: {
        name: "沈芷白",
        surname: "沈",
        age: 20,
        role: "贵妃",
        appearance: "",
        personalityTraits: [],
        reactionTraits: [],
        coreFacts: [],
        goals: [],
        speechStyle: "formal",
      },
      voice: { register: "formal", quirks: [], tabooTopics: [] },
      standing: {
        rank: "guifei",
        favor: 50,
        selfRefs: { toPlayer: ["臣妾"], formal: ["臣妾"] },
      },
      relevantMemories: [],
      stances: [],
    },
    etiquette: { allowedTerms: [], forbiddenTerms: [], addressRules: [] },
    register: "private",
    transcript: overrides.transcript ?? [],
    topicTags: overrides.topicTags ?? [],
    sceneDirective: overrides.sceneDirective,
    promptContext: {
      speakerDisplayName: "沈芷白",
      rankDisplay: {
        kind: "ranked",
        id: "guifei",
        name: "贵妃",
        grade: "二品",
        selfRefs: { toPlayer: ["臣妾"], formal: ["臣妾"] },
      },
      audience: {
        targetId: "player",
        targetRole: "sovereign",
        privacy: "semi_private",
        presentCharacterIds: [],
      },
      relevantMemories: [],
      knownEvents: [],
      allowedClaims: [],
      forbiddenClaims: [],
      choiceCandidates: [],
    },
  };
}

describe("buildDialogueKnowledgeQuery", () => {
  it("includes sceneDirective in fixed field order", () => {
    const req = fakeRequest({ sceneDirective: "询问宫廷礼仪" });
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.text).toContain("directive: 询问宫廷礼仪");
  });

  it("includes topicTags in fixed field order", () => {
    const req = fakeRequest({ topicTags: ["礼仪", "宫规"] });
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.text).toContain("topics: 礼仪 宫规");
  });

  it("field order is fixed: directive before topics", () => {
    const req = fakeRequest({ sceneDirective: "DIRECTIVE", topicTags: ["TOPIC"] });
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.text.indexOf("directive:")).toBeLessThan(q.text.indexOf("topics:"));
  });

  it("includes latest target (player) line from transcript", () => {
    const req = fakeRequest({
      transcript: [
        { speaker: "player", text: "早先那件事" },
        { speaker: "shen_zhibai", text: "此乃臣妾职责" },
        { speaker: "player", text: "礼仪规矩如何" },
      ],
    });
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.text).toContain("target: 礼仪规矩如何");
    // Earlier player line is not included
    expect(q.text).not.toContain("早先那件事");
  });

  it("speaker NPC lines are never included (no feedback loop)", () => {
    const req = fakeRequest({
      transcript: [{ speaker: "shen_zhibai", text: "speaker output text" }],
    });
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.text).not.toContain("speaker output text");
  });

  it("normalizes internal whitespace to single spaces", () => {
    const req = fakeRequest({ sceneDirective: "问   宫规\t礼仪" });
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.text).not.toMatch(/\s{2,}/);
    expect(q.text).toContain("问 宫规 礼仪");
  });

  it("falls back to default query when directive, topics, and transcript all empty", () => {
    const req = fakeRequest();
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.text).toBe("宫廷礼仪");
  });

  it("query does not exceed MAX_QUERY_CHARS (300)", () => {
    const longDirective = "A".repeat(200);
    const longTopics = ["B".repeat(200)];
    const req = fakeRequest({ sceneDirective: longDirective, topicTags: longTopics });
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.text.length).toBeLessThanOrEqual(300);
  });

  it("currentTime equals request.time exactly (single source of truth)", () => {
    const req = fakeRequest();
    const q = buildDialogueKnowledgeQuery(req, "public");
    expect(q.currentTime).toBe(req.time); // reference-equal, not just deep-equal
  });

  it("sets visibilityCeiling to the provided ceiling", () => {
    const req = fakeRequest();
    expect(buildDialogueKnowledgeQuery(req, "public").visibilityCeiling).toBe("public");
    expect(buildDialogueKnowledgeQuery(req, "restricted").visibilityCeiling).toBe("restricted");
    expect(buildDialogueKnowledgeQuery(req, "imperial").visibilityCeiling).toBe("imperial");
  });

  it("uses vectorFailureMode keyword_only (graceful degradation for dialogue)", () => {
    const req = fakeRequest();
    expect(buildDialogueKnowledgeQuery(req, "public").vectorFailureMode).toBe("keyword_only");
  });

  it("is deterministic — same request produces identical output", () => {
    const req = fakeRequest({ sceneDirective: "问礼", topicTags: ["宫规"] });
    const q1 = buildDialogueKnowledgeQuery(req, "public");
    const q2 = buildDialogueKnowledgeQuery(req, "public");
    expect(q1).toEqual(q2);
  });

  it("does not mutate the input request", () => {
    const req = fakeRequest({ sceneDirective: "test", topicTags: ["t1"] });
    const transcriptBefore = req.transcript.length;
    buildDialogueKnowledgeQuery(req, "public");
    expect(req.transcript.length).toBe(transcriptBefore);
    expect(req.sceneDirective).toBe("test");
    expect(req.topicTags).toEqual(["t1"]);
  });
});

/**
 * Suite B: getLatestTargetUtterance — direct unit tests for the helper used by
 * the intent classifier to isolate the user's utterance from retrieval context.
 */
describe("getLatestTargetUtterance", () => {
  it("returns undefined when transcript is empty", () => {
    const req = fakeRequest({ transcript: [] });
    expect(getLatestTargetUtterance(req)).toBeUndefined();
  });

  it("returns the text when there is exactly one target line", () => {
    const req = fakeRequest({
      transcript: [{ speaker: "player", text: "宫中礼仪如何" }],
    });
    expect(getLatestTargetUtterance(req)).toBe("宫中礼仪如何");
  });

  it("returns the latest target line when multiple exist", () => {
    const req = fakeRequest({
      transcript: [
        { speaker: "player", text: "第一句" },
        { speaker: "player", text: "第二句" },
        { speaker: "player", text: "最后一句" },
      ],
    });
    expect(getLatestTargetUtterance(req)).toBe("最后一句");
  });

  it("ignores speaker lines interleaved between target lines", () => {
    const req = fakeRequest({
      transcript: [
        { speaker: "player", text: "早先那件事" },
        { speaker: "shen_zhibai", text: "臣妾遵命" },
        { speaker: "player", text: "谁现在怀孕了" },
        { speaker: "shen_zhibai", text: "容臣妾想想" },
      ],
    });
    // Latest TARGET line is the third entry, not the last overall
    expect(getLatestTargetUtterance(req)).toBe("谁现在怀孕了");
  });

  it("uses targetId — works correctly when targetId is a non-player NPC", () => {
    // Override the default fakeRequest targetId by constructing a modified request
    const base = fakeRequest({
      transcript: [
        { speaker: "player", text: "player says something" },
        { speaker: "npc_a", text: "npc 第一句" },
        { speaker: "player", text: "player says more" },
        { speaker: "npc_a", text: "npc 最后一句" },
      ],
    });
    const req = { ...base, targetId: "npc_a" } as typeof base;
    // With targetId="npc_a", should return npc's latest line, NOT player's
    expect(getLatestTargetUtterance(req)).toBe("npc 最后一句");
  });

  it("speaker's later line does not shadow an earlier target line", () => {
    const req = fakeRequest({
      transcript: [
        { speaker: "player", text: "谁最受宠" },
        // Speaker responds after player — this must not be returned
        { speaker: "shen_zhibai", text: "这是说话人的台词" },
      ],
    });
    expect(getLatestTargetUtterance(req)).toBe("谁最受宠");
  });

  it("returns undefined when transcript has only non-target lines", () => {
    const req = fakeRequest({
      transcript: [
        { speaker: "shen_zhibai", text: "臣妾问安" },
        { speaker: "shen_zhibai", text: "请陛下明鉴" },
      ],
    });
    expect(getLatestTargetUtterance(req)).toBeUndefined();
  });
});
