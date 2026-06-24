/**
 * Suite A: buildDialogueKnowledgeQuery — pure function, deterministic output.
 */
import { describe, it, expect } from "vitest";
import { buildDialogueKnowledgeQuery } from "../../../src/engine/dialogue/knowledge/queryBuilder";
import type { DialogueRequest } from "../../../src/engine/dialogue/types";
import type { GameTime } from "../../../src/engine/calendar/time";

const now: GameTime = { year: 1, month: 1, period: "early", dayIndex: 0 };

function fakeRequest(overrides?: Partial<Pick<DialogueRequest, "sceneDirective" | "topicTags">>): DialogueRequest {
  return {
    speakerId: "shen_zhibai",
    targetId: "player",
    locationId: "zichendian",
    time: now,
    speakerContext: {
      profile: { name: "沈芷白", surname: "沈", age: 20, role: "贵妃", appearance: "", personalityTraits: [], reactionTraits: [], coreFacts: [], goals: [], speechStyle: "formal" },
      voice: { register: "formal", quirks: [], tabooTopics: [] },
      standing: { rank: "guifei", favor: 50, selfRefs: { toPlayer: ["臣妾"], formal: ["臣妾"] } },
      relevantMemories: [],
      stances: [],
    },
    etiquette: { allowedTerms: [], forbiddenTerms: [], addressRules: [] },
    transcript: [],
    topicTags: overrides?.topicTags ?? [],
    sceneDirective: overrides?.sceneDirective,
    promptContext: {
      speakerDisplayName: "沈芷白",
      rankDisplay: { kind: "ranked", id: "guifei", name: "贵妃", grade: "二品", selfRefs: { toPlayer: ["臣妾"], formal: ["臣妾"] } },
      audience: { targetId: "player", targetRole: "sovereign", privacy: "semi_private", presentCharacterIds: [] },
      relevantMemories: [],
      knownEvents: [],
      allowedClaims: [],
      forbiddenClaims: [],
      choiceCandidates: [],
    },
  };
}

describe("buildDialogueKnowledgeQuery", () => {
  it("uses sceneDirective as query text when present", () => {
    const req = fakeRequest({ sceneDirective: "询问宫廷礼仪" });
    const q = buildDialogueKnowledgeQuery(req, now, "public");
    expect(q.text).toContain("询问宫廷礼仪");
  });

  it("uses topicTags as query text when no sceneDirective", () => {
    const req = fakeRequest({ topicTags: ["礼仪", "宫规"] });
    const q = buildDialogueKnowledgeQuery(req, now, "public");
    expect(q.text).toContain("礼仪");
    expect(q.text).toContain("宫规");
  });

  it("combines sceneDirective and topicTags", () => {
    const req = fakeRequest({ sceneDirective: "问宫务", topicTags: ["礼制"] });
    const q = buildDialogueKnowledgeQuery(req, now, "public");
    expect(q.text).toContain("问宫务");
    expect(q.text).toContain("礼制");
  });

  it("falls back to default query when both sceneDirective and topicTags are empty", () => {
    const req = fakeRequest();
    const q = buildDialogueKnowledgeQuery(req, now, "public");
    expect(q.text.length).toBeGreaterThan(0);
  });

  it("always sets currentTime", () => {
    const req = fakeRequest();
    const q = buildDialogueKnowledgeQuery(req, now, "public");
    expect(q.currentTime).toEqual(now);
  });

  it("always sets visibilityCeiling to the provided ceiling", () => {
    const req = fakeRequest();
    expect(buildDialogueKnowledgeQuery(req, now, "public").visibilityCeiling).toBe("public");
    expect(buildDialogueKnowledgeQuery(req, now, "restricted").visibilityCeiling).toBe("restricted");
    expect(buildDialogueKnowledgeQuery(req, now, "imperial").visibilityCeiling).toBe("imperial");
  });

  it("uses vectorFailureMode keyword_only (graceful degradation for dialogue)", () => {
    const req = fakeRequest();
    const q = buildDialogueKnowledgeQuery(req, now, "public");
    expect(q.vectorFailureMode).toBe("keyword_only");
  });

  it("is deterministic — same request produces same output", () => {
    const req = fakeRequest({ sceneDirective: "问礼", topicTags: ["宫规"] });
    const q1 = buildDialogueKnowledgeQuery(req, now, "public");
    const q2 = buildDialogueKnowledgeQuery(req, now, "public");
    expect(q1).toEqual(q2);
  });
});
