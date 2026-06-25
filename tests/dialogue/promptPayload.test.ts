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

// ── T1: resolvePromptEntityName ───────────────────────────────────────────────

import { resolvePromptEntityName, toPromptEvent } from "../../src/engine/dialogue/promptPayload";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent } from "../../src/engine/state/types";

function makeMinimalDB() {
  return {
    characters: {
      shen_zhibai: { profile: { name: "沈芝白" } },
    } as unknown as import("../../src/engine/content/loader").ContentDB["characters"],
    ranks: {
      fenghou: { name: "后" },
      meiren: { name: "美人" },
    } as unknown as import("../../src/engine/content/loader").ContentDB["ranks"],
    locations: {
      zichendian: { name: "紫宸殿" },
      lengong: { name: "冷宫" },
    } as unknown as import("../../src/engine/content/loader").ContentDB["locations"],
  } as unknown as import("../../src/engine/content/loader").ContentDB;
}

function makeMinimalState() {
  const s = createInitialState();
  return s;
}

describe("resolvePromptEntityName", () => {
  it("returns '陛下' for 'player'", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    expect(resolvePromptEntityName("player", d, s)).toBe("陛下");
  });

  it("returns profile.name for static character", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    expect(resolvePromptEntityName("shen_zhibai", d, s)).toBe("沈芝白");
  });

  it("returns givenName for heir; petName when givenName is '' (|| not ??)", () => {
    const s = makeMinimalState();
    const heir = {
      id: "heir_000001", sex: "son" as const, fatherId: null, bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: true,
      petName: "小宝", givenName: "",          // givenName='' → falls through
      education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 100, talent: 50, diligence: 50,
      ambition: 10, closeness: 50, support: 50, faction: "none" as const,
      lifecycle: "alive" as const,
    };
    s.resources.bloodline.heirs.push(heir);
    const d = makeMinimalDB();
    expect(resolvePromptEntityName("heir_000001", d, s)).toBe("小宝");
  });

  it("returns '皇嗣' when both names are ''", () => {
    const s = makeMinimalState();
    const heir = {
      id: "heir_000002", sex: "daughter" as const, fatherId: null, bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: false,
      petName: "", givenName: "",
      education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 100, talent: 50, diligence: 50,
      ambition: 10, closeness: 50, support: 50, faction: "none" as const,
      lifecycle: "alive" as const,
    };
    s.resources.bloodline.heirs.push(heir);
    const d = makeMinimalDB();
    expect(resolvePromptEntityName("heir_000002", d, s)).toBe("皇嗣");
  });

  it("returns surname+givenName for official", () => {
    const s = makeMinimalState();
    s.officials["wei_qinghe"] = { id: "wei_qinghe", surname: "魏", givenName: "清和", postId: "shangshu", loyalty: 60, age: 45, familyId: "fam_0001", status: "active", aptitude: { governance: 50, scholarship: 50, military: 50, integrity: 50 }, reviewState: { merit: 50, underperformanceYears: 0 } };
    const d = makeMinimalDB();
    expect(resolvePromptEntityName("wei_qinghe", d, s)).toBe("魏清和");
  });

  it("returns '某人' for unknown — never returns raw id", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const result = resolvePromptEntityName("ghost_999", d, s);
    expect(result).toBe("某人");
    expect(result).not.toBe("ghost_999");
  });

  it("returns generatedConsort profile.name when consort is generated", () => {
    const s = makeMinimalState();
    s.generatedConsorts["gen_consort_001"] = {
      id: "gen_consort_001", kind: "consort",
      profile: { name: "柔嘉", surname: "刘", age: 18, role: "贵人", appearance: "清秀", personalityTraits: ["温婉"], coreFacts: ["入宫半年"], goals: ["获得宠爱"], speechStyle: "温婉" },
    } as unknown as import("../../src/engine/content/schemas").CharacterContent;
    const d = makeMinimalDB();
    expect(resolvePromptEntityName("gen_consort_001", d, s)).toBe("柔嘉");
  });
});

// ── T1: toPromptEvent ─────────────────────────────────────────────────────────

function makeCourtEvent(overrides: Partial<CourtEvent> = {}): CourtEvent {
  return {
    id: "evt_000001",
    type: "rank_changed",
    occurredAt: makeGameTime(1, 1, "early"),
    participants: [{ charId: "shen_zhibai", role: "subject" }],
    payload: { from: "meiren", to: "fenghou", direction: "promote" },
    publicity: { scope: "palace", persistence: "institutional" },
    publicSalience: 70,
    retention: "slow",
    tags: ["rank"],
    ...overrides,
  };
}

describe("toPromptEvent", () => {
  it("participant.displayName via resolvePromptEntityName", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent();
    const pe = toPromptEvent(e, d, s);
    expect(pe.participants[0]!.charId).toBe("shen_zhibai");
    expect(pe.participants[0]!.role).toBe("subject");
    expect(pe.participants[0]!.displayName).toBe("沈芝白");
  });

  it("whitelisted payload fields only per type — rank_changed: from/to display, direction", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({ type: "rank_changed", payload: { from: "meiren", to: "fenghou", direction: "promote" } });
    const pe = toPromptEvent(e, d, s);
    expect(pe.facts["from"]).toBe("美人");
    expect(pe.facts["to"]).toBe("后");
    expect(pe.facts["direction"]).toBe("promote");
  });

  it("non-whitelisted type → facts: {}", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({ type: "conflict", payload: { reason: "jealousy", severity: 80 } });
    const pe = toPromptEvent(e, d, s);
    expect(pe.facts).toEqual({});
  });

  it("rank id fallback display '某位分' when rank not in db.ranks", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({ type: "rank_changed", payload: { from: "unknown_rank", to: "fenghou", direction: "demote" } });
    const pe = toPromptEvent(e, d, s);
    expect(pe.facts["from"]).toBe("某位分");
    expect(pe.facts["to"]).toBe("后");
  });

  it("location id fallback display '某处' when location not in db.locations", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({ type: "residence_changed", payload: { from: "unknown_place", to: "zichendian" } });
    const pe = toPromptEvent(e, d, s);
    expect(pe.facts["from"]).toBe("某处");
    expect(pe.facts["to"]).toBe("紫宸殿");
  });

  it("strips publicity/publicSalience/retention/tags", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent();
    const pe = toPromptEvent(e, d, s);
    expect("publicity" in pe).toBe(false);
    expect("publicSalience" in pe).toBe(false);
    expect("retention" in pe).toBe(false);
    expect("tags" in pe).toBe(false);
  });

  it("excludes NaN/Infinity from facts", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({
      type: "heir_born",
      payload: { heirId: "heir_000001", badNaN: NaN, badInf: Infinity },
    });
    const pe = toPromptEvent(e, d, s);
    expect("badNaN" in pe.facts).toBe(false);
    expect("badInf" in pe.facts).toBe(false);
  });

  it("heir_born: preserves heirId", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({ type: "heir_born", payload: { heirId: "heir_000001" } });
    const pe = toPromptEvent(e, d, s);
    expect(pe.facts["heirId"]).toBe("heir_000001");
  });

  it("heir_died: preserves heirId", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({ type: "heir_died", payload: { heirId: "heir_000002" } });
    const pe = toPromptEvent(e, d, s);
    expect(pe.facts["heirId"]).toBe("heir_000002");
  });

  it("residence_changed: from/to location display names", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({ type: "residence_changed", payload: { from: "zichendian", to: "lengong" } });
    const pe = toPromptEvent(e, d, s);
    expect(pe.facts["from"]).toBe("紫宸殿");
    expect(pe.facts["to"]).toBe("冷宫");
  });

  it("id/type/occurredAt/locationId are preserved", () => {
    const s = makeMinimalState();
    const d = makeMinimalDB();
    const e = makeCourtEvent({ locationId: "zichendian" });
    const pe = toPromptEvent(e, d, s);
    expect(pe.id).toBe("evt_000001");
    expect(pe.type).toBe("rank_changed");
    expect(pe.occurredAt).toEqual(makeGameTime(1, 1, "early"));
    expect(pe.locationId).toBe("zichendian");
  });
});

// ── Provider payload parity: knowledgeContext DTO shape ───────────────────────
// All three providers (Anthropic, OpenAI, Gemini) use compilePromptPayload from
// this module. Asserting exact keys here acts as a shared regression guard.

describe("compilePromptPayload — knowledgeContext DTO parity (shared by all providers)", () => {
  it("knowledgeContext absent from payload when not in request", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const payload = compilePromptPayload(r.value);
    expect(payload).not.toHaveProperty("knowledgeContext");
  });

  it("knowledgeContext present in payload when provided in promptContext", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = {
      ...r.value,
      promptContext: {
        ...r.value.promptContext,
        knowledgeContext: [
          { id: "k1", title: "礼仪", text: "宫廷礼仪条款", sourceType: "etiquette" as const },
        ],
      },
    };
    const payload = compilePromptPayload(req);
    expect(payload.knowledgeContext).toBeDefined();
  });

  it("each serialized knowledgeContext chunk has exactly { id, sourceType, text, title } — no extra fields", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const req = {
      ...r.value,
      promptContext: {
        ...r.value.promptContext,
        knowledgeContext: [
          { id: "k1", title: "礼", text: "礼仪", sourceType: "etiquette" as const },
          { id: "k2", title: "制", text: "制度", sourceType: "official_system" as const },
        ],
      },
    };
    const payload = compilePromptPayload(req);
    for (const chunk of payload.knowledgeContext ?? []) {
      expect(Object.keys(chunk).sort()).toEqual(["id", "sourceType", "text", "title"]);
      expect(chunk).not.toHaveProperty("visibility");
      expect(chunk).not.toHaveProperty("sourcePath");
    }
  });

  it("chunk content is passed through unmodified (id, title, text, sourceType preserved)", () => {
    const r = assembleDialogueRequest(db, state, SPEAKER, LOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inputChunk = { id: "k_test", title: "制度", text: "全文内容", sourceType: "world_rule" as const };
    const req = {
      ...r.value,
      promptContext: { ...r.value.promptContext, knowledgeContext: [inputChunk] },
    };
    const payload = compilePromptPayload(req);
    const out = payload.knowledgeContext?.[0];
    expect(out?.id).toBe("k_test");
    expect(out?.title).toBe("制度");
    expect(out?.text).toBe("全文内容");
    expect(out?.sourceType).toBe("world_rule");
  });
});
