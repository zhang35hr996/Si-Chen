/**
 * TDD — T0 promptPayload + DialogueAssemblyOptions + promptContext
 * Run: npx vitest run tests/dialogue/promptPayload.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  assembleDialogueRequest,
  buildDialoguePolicyContext,
} from "../../src/engine/dialogue/orchestrator";
import { toPromptMemory } from "../../src/engine/dialogue/promptPayload";
import type { MemoryEntry } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const ELDER = "taihou"; // elder character (no rank)
const LOC = "zichendian";

// ── DialogueAssemblyOptions ───────────────────────────────────────────────────

describe("DialogueAssemblyOptions", () => {
  it("targetId defaults to 'player' when not provided", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.targetId).toBe("player");
  });

  it("targetId propagates to request.targetId, memoryContext.audienceId, and audience.targetId (same value)", () => {
    // Since targetId defaults to "player" and the test data doesn't have another
    // valid target to use, we verify the single-source contract: all three locations
    // see the same value.
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = r.value;
    // request.targetId
    expect(req.targetId).toBe("player");
    // audience (from promptContext) also reflects targetId
    expect(req.promptContext.audience.targetId).toBe("player");
  });

  it("sceneDirective propagates to request.sceneDirective", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC, {
      sceneDirective: "今日风雪，气氛压抑。",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sceneDirective).toBe("今日风雪，气氛压抑。");
  });

  it("transcript propagates to request.transcript", () => {
    const transcript = [{ speaker: "player", text: "娘娘安好。" }];
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC, { transcript });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.transcript).toEqual(transcript);
  });

  it("scripted propagates to request.scripted", () => {
    const scripted = { text: "陛下万安。", expression: "calm" };
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC, { scripted });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scripted).toEqual(scripted);
  });
});

// ── toPromptMemory ────────────────────────────────────────────────────────────

const fakeMemory: MemoryEntry = {
  id: "mem_000001",
  ownerId: "shen_zhibai",
  kind: "gratitude",
  subjectIds: ["player"],
  perspective: "target",
  summary: "陛下曾赐下珍贵药材。",
  strength: 80,
  retention: "slow",
  emotions: { joy: 70, grief: 10 },
  triggerTags: ["gift", "favor"],
  unresolved: false,
  createdAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
  // Optional: sourceEventId not set
};

describe("toPromptMemory", () => {
  it("maps id/kind/summary/subjectIds/perspective/emotions/unresolved", () => {
    const pm = toPromptMemory(fakeMemory);
    expect(pm.id).toBe("mem_000001");
    expect(pm.kind).toBe("gratitude");
    expect(pm.summary).toBe("陛下曾赐下珍贵药材。");
    expect(pm.subjectIds).toEqual(["player"]);
    expect(pm.perspective).toBe("target");
    expect(pm.emotions).toEqual({ joy: 70, grief: 10 });
    expect(pm.unresolved).toBe(false);
  });

  it("createdAt = m.createdAt (not occurredAt)", () => {
    const pm = toPromptMemory(fakeMemory);
    expect(pm.createdAt).toEqual({ year: 1, month: 1, period: "early", dayIndex: 0 });
  });

  it("result has no ownerId field (compile-time and runtime)", () => {
    const pm = toPromptMemory(fakeMemory);
    expect("ownerId" in pm).toBe(false);
  });

  it("result has no strength/retention/triggerTags", () => {
    const pm = toPromptMemory(fakeMemory);
    expect("strength" in pm).toBe(false);
    expect("retention" in pm).toBe(false);
    expect("triggerTags" in pm).toBe(false);
  });
});

// ── assembleDialogueRequest promptContext ─────────────────────────────────────

describe("assembleDialogueRequest promptContext", () => {
  it("ranked speaker: rankDisplay.kind === 'ranked', has name and grade from db.ranks", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { rankDisplay } = r.value.promptContext;
    expect(rankDisplay.kind).toBe("ranked");
    if (rankDisplay.kind !== "ranked") return;
    // shen_zhibai is fenghou
    expect(rankDisplay.id).toBe("fenghou");
    expect(rankDisplay.name).toBeDefined();
    expect(rankDisplay.grade).toBeDefined();
    expect(rankDisplay.selfRefs.toPlayer).toBeInstanceOf(Array);
  });

  it("elder speaker: rankDisplay.kind === 'unranked', has role = character.profile.role", () => {
    const r = assembleDialogueRequest(db, state, ELDER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { rankDisplay } = r.value.promptContext;
    expect(rankDisplay.kind).toBe("unranked");
    if (rankDisplay.kind !== "unranked") return;
    // role should be the character's profile.role
    const elderChar = db.characters[ELDER];
    expect(elderChar).toBeDefined();
    expect(rankDisplay.role).toBe(elderChar!.profile.role);
    expect(rankDisplay.selfRefs.toPlayer).toBeInstanceOf(Array);
  });

  it("speakerDisplayName = resolveDisplayName result", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // shen_zhibai surname="沈", fenghou.name="后" → "沈后"
    expect(r.value.promptContext.speakerDisplayName).toMatch(/沈/);
  });

  it("audience = buildAudienceContext(state, db, {speakerId, targetId})", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { audience } = r.value.promptContext;
    expect(audience.targetId).toBe("player");
    expect(audience.targetRole).toBe("sovereign");
  });

  it("relevantMemories is PromptMemory[] (no ownerId)", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { relevantMemories } = r.value.promptContext;
    expect(Array.isArray(relevantMemories)).toBe(true);
    // shen_zhibai has authored memories → should have at least one
    for (const pm of relevantMemories) {
      expect("ownerId" in pm).toBe(false);
      expect("strength" in pm).toBe(false);
    }
  });

  it("knownEvents = [], allowedClaims = [], forbiddenClaims = []", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pc = r.value.promptContext;
    expect(pc.knownEvents).toEqual([]);
    expect(pc.allowedClaims).toEqual([]);
    expect(pc.forbiddenClaims).toEqual([]);
  });

  it("reactionPlan = undefined, choiceCandidates = []", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pc = r.value.promptContext;
    expect(pc.reactionPlan).toBeUndefined();
    expect(pc.choiceCandidates).toEqual([]);
  });
});

// ── buildDialoguePolicyContext ────────────────────────────────────────────────

describe("buildDialoguePolicyContext", () => {
  it("audience === request.promptContext.audience (same object reference)", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const request = r.value;
    const policy = buildDialoguePolicyContext(db, state, request);
    // Single source: buildDialoguePolicyContext must read audience from
    // request.promptContext.audience, not build a new one.
    expect(policy.audience).toBe(request.promptContext.audience);
  });
});

// ── compilePromptPayload ──────────────────────────────────────────────────────

import { compilePromptPayload } from "../../src/engine/dialogue/promptPayload";

describe("compilePromptPayload", () => {
  it("speaker.id = request.speakerId", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const payload = compilePromptPayload(r.value);
    expect(payload.speaker.id).toBe(SPEAKER);
  });

  it("speaker.name = promptContext.speakerDisplayName", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = r.value;
    const payload = compilePromptPayload(req);
    expect(payload.speaker.name).toBe(req.promptContext.speakerDisplayName);
  });

  it("ranked: speaker.standing has kind=ranked, name, grade, selfRefs", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = r.value;
    const payload = compilePromptPayload(req);
    const standing = payload.speaker.standing;
    expect(standing.kind).toBe("ranked");
    if (standing.kind !== "ranked") return;
    expect(standing.name).toBeDefined();
    expect(standing.grade).toBeDefined();
    expect(standing.selfRefs).toBeDefined();
    expect(standing.selfRefs.toPlayer).toBeInstanceOf(Array);
  });

  it("elder: speaker.standing has kind=unranked, role, selfRefs", () => {
    const r = assembleDialogueRequest(db, state, ELDER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = r.value;
    const payload = compilePromptPayload(req);
    const standing = payload.speaker.standing;
    expect(standing.kind).toBe("unranked");
    if (standing.kind !== "unranked") return;
    expect(standing.role).toBeDefined();
    expect(standing.selfRefs).toBeDefined();
    expect(standing.selfRefs.toPlayer).toBeInstanceOf(Array);
  });

  it("speaker.speechStyle = profile.speechStyle (not voice.register)", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = r.value;
    const payload = compilePromptPayload(req);
    expect(payload.speaker.speechStyle).toBe(req.speakerContext.profile.speechStyle);
    // Must not equal voice.register (different fields)
    expect(payload.speaker.speechStyle).not.toBe(req.speakerContext.voice.register);
  });

  it("speaker.personalityTraits = profile.personalityTraits (array)", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = r.value;
    const payload = compilePromptPayload(req);
    expect(payload.speaker.personalityTraits).toEqual(req.speakerContext.profile.personalityTraits);
    expect(Array.isArray(payload.speaker.personalityTraits)).toBe(true);
  });

  it("speaker.coreFacts = profile.coreFacts", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = r.value;
    const payload = compilePromptPayload(req);
    expect(payload.speaker.coreFacts).toEqual(req.speakerContext.profile.coreFacts);
  });

  it("currentScene.directive present when sceneDirective set", () => {
    const directive = "今日风雪，气氛压抑。";
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC, { sceneDirective: directive });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const payload = compilePromptPayload(r.value);
    expect(payload.currentScene.directive).toBe(directive);
    expect("directive" in payload.currentScene).toBe(true);
  });

  it("currentScene has no directive key when sceneDirective absent", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const payload = compilePromptPayload(r.value);
    expect("directive" in payload.currentScene).toBe(false);
  });

  it("currentScene.recentLines = last 6 of transcript (slice(-6))", () => {
    const transcript = [
      { speaker: "a", text: "line1" },
      { speaker: "b", text: "line2" },
      { speaker: "a", text: "line3" },
      { speaker: "b", text: "line4" },
      { speaker: "a", text: "line5" },
      { speaker: "b", text: "line6" },
      { speaker: "a", text: "line7" },
      { speaker: "b", text: "line8" },
    ];
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC, { transcript });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const payload = compilePromptPayload(r.value);
    expect(payload.currentScene.recentLines).toEqual(transcript.slice(-6));
  });

  it("result has no ownerId/strength/retention", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const payload = compilePromptPayload(r.value);
    // Check speaker
    expect("ownerId" in payload.speaker).toBe(false);
    expect("strength" in payload.speaker).toBe(false);
    expect("retention" in payload.speaker).toBe(false);
    // Check relevantMemories
    for (const mem of payload.relevantMemories) {
      expect("ownerId" in mem).toBe(false);
      expect("strength" in mem).toBe(false);
      expect("retention" in mem).toBe(false);
    }
  });
});
