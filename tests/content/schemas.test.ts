import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  characterRankSchema,
  characterSchema,
  characterStandingSchema,
  dialogueChoiceSchema,
  effectMemoryDraftSchema,
  eventEffectSchema,
  gameEventSchema,
  initialMemoryDraftSchema,
  sceneSchema,
  triggerConditionSchema,
  worldSchema,
} from "../../src/engine/content/schemas";

const accepts = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`expected accept, got: ${r.error.message}`);
};
const rejects = (schema: z.ZodType, value: unknown) => {
  expect(schema.safeParse(value).success).toBe(false);
};

// ── fixtures (documented minimal examples) ───────────────────────────
const validCharacter = {
  id: "char_a",
  kind: "consort",
  profile: {
    name: "测试侍君",
    age: 20,
    role: "侍君",
    appearance: "外貌。",
    personalityTraits: ["端肃"],
    coreFacts: ["入宫两年"],
    goals: ["承宠"],
    speechStyle: "克制。",
  },
  defaultLocation: "loc_a",
  portraitSet: "char_a",
  expressions: ["neutral", "smile"],
  voice: { register: "formal", quirks: [], tabooTopics: [] },
  initialStanding: { rank: "rank_a", favor: 10 },
  initialMemories: [],
  secrets: [],
};

const validEvent = {
  id: "ev_a",
  title: "测试事件",
  sceneId: "sc_a",
  checkpoint: "location_enter",
  condition: { atLocation: "loc_a" },
  priority: 1,
  once: true,
  apCost: 1,
};

const validScene = {
  id: "sc_a",
  locationId: "loc_a",
  participants: ["char_a"],
  startNodeId: "n1",
  nodes: [
    { type: "line", id: "n1", speaker: "char_a", text: "……", next: "n2" },
    { type: "effect", id: "n2", effects: [{ type: "flag", key: "k", value: true }] },
  ],
};

describe("characterSchema", () => {
  it("accepts the documented example", () => accepts(characterSchema, validCharacter));

  it("rejects targeted mutations", () => {
    rejects(characterSchema, { ...validCharacter, id: "CharA" }); // uppercase id
    rejects(characterSchema, { ...validCharacter, kind: "eunuch" }); // bad enum
    rejects(characterSchema, { ...validCharacter, expressions: ["smile"] }); // no neutral
    rejects(characterSchema, { ...validCharacter, secrets: [{ id: "s" }] }); // secrets must be empty
    rejects(characterSchema, {
      ...validCharacter,
      profile: { ...validCharacter.profile, name: undefined },
    }); // missing field
    rejects(characterSchema, { ...validCharacter, unknownKey: 1 }); // strict objects
  });
});

describe("memory drafts", () => {
  const draft = {
    kind: "episodic",
    summary: "一条记忆。",
    strength: 50,
    subjectIds: ["player", "char_a"],
    perspective: "witness",
    triggerTags: ["player"],
    unresolved: false,
    emotions: {},
  };

  it("initial drafts default retention to slow; effect drafts require explicit retention", () => {
    const parsed = initialMemoryDraftSchema.parse(draft);
    expect(parsed.retention).toBe("slow");
    // effect drafts require explicit retention
    rejects(effectMemoryDraftSchema, draft); // missing retention
    accepts(effectMemoryDraftSchema, { ...draft, retention: "fast" });
    accepts(effectMemoryDraftSchema, { ...draft, retention: "permanent" }); // permanent allowed for effects
  });

  it("rejects out-of-range strength, long summaries, too many / non-ascii triggerTags", () => {
    rejects(initialMemoryDraftSchema, { ...draft, strength: 200 });
    rejects(initialMemoryDraftSchema, { ...draft, summary: "长".repeat(241) });
    rejects(initialMemoryDraftSchema, { ...draft, triggerTags: ["a", "b", "c", "d", "e", "f"] });
    rejects(initialMemoryDraftSchema, { ...draft, triggerTags: ["御花园"] });
  });
});

describe("triggerConditionSchema (closed DSL — scaffold guard)", () => {
  it("accepts every documented predicate incl. nesting", () => {
    accepts(triggerConditionSchema, {
      all: [
        { atLocation: "loc_a" },
        { not: { eventFired: "ev_a" } },
        { any: [{ flagSet: "x" }, { monthAtLeast: 3 }, { periodIs: "late" }] },
        { favorAtLeast: { char: "char_a", value: 50 } },
        { rankAtLeast: { char: "char_a", rank: "rank_a" } },
        { hasMemoryTag: { char: "char_a", tag: "neglect" } },
      ],
    });
  });

  it("rejects scaffold-field predicates and unknown predicates outright", () => {
    rejects(triggerConditionSchema, { resourceAtLeast: { pillar: "bloodline", field: "legitimacy", value: 50 } });
    rejects(triggerConditionSchema, { bloodlineLegitimacyAtLeast: 50 });
    rejects(triggerConditionSchema, { hasMemoryTag: { char: "char_a", tag: "Bad Tag" } }); // tags are lowercase ascii
  });
});

describe("eventEffectSchema (discriminated pillar/field pairs)", () => {
  it("accepts legal pillar/field combinations", () => {
    accepts(eventEffectSchema, { type: "resource", pillar: "sovereign", field: "prestige", delta: 3 });
    accepts(eventEffectSchema, { type: "resource", pillar: "nation", field: "governance", delta: -3 });
    accepts(eventEffectSchema, { type: "set_bloodline_status", field: "menstrualStatus", value: "absent" });
    accepts(eventEffectSchema, { type: "favor", char: "char_a", delta: -10 });
  });

  it("rejects illegal pairs, oversized deltas, and bad enums", () => {
    rejects(eventEffectSchema, { type: "resource", pillar: "sovereign", field: "harmony", delta: 1 }); // wrong pair
    rejects(eventEffectSchema, { type: "resource", pillar: "bloodline", field: "menstrualStatus", delta: 1 });
    rejects(eventEffectSchema, { type: "favor", char: "char_a", delta: 40 }); // ±10 cap
    rejects(eventEffectSchema, { type: "set_bloodline_status", field: "menstrualStatus", value: "pregnant" });
  });
});

describe("gameEventSchema / sceneSchema / choices", () => {
  it("accepts the documented examples", () => {
    accepts(gameEventSchema, validEvent);
    accepts(sceneSchema, validScene);
  });

  it("rejects public events without headline, negative apCost, zero cooldown", () => {
    accepts(gameEventSchema, { ...validEvent, public: true, headline: "宫闱有事" });
    rejects(gameEventSchema, { ...validEvent, public: true });
    rejects(gameEventSchema, { ...validEvent, apCost: -1 });
    rejects(gameEventSchema, { ...validEvent, cooldown: { actionDays: 0 } });
  });

  it("rejects broken scenes: duplicate node ids, >4 choices, choice without next, long text", () => {
    rejects(sceneSchema, {
      ...validScene,
      nodes: [validScene.nodes[0], { ...validScene.nodes[1], id: "n1" }],
    });
    const choice = { id: "c1", text: "选项", next: "n2" };
    accepts(dialogueChoiceSchema, choice);
    rejects(dialogueChoiceSchema, { id: "c1", text: "选项" }); // next required (scripted)
    rejects(dialogueChoiceSchema, { ...choice, text: "字".repeat(121) });
    rejects(sceneSchema, {
      ...validScene,
      nodes: [
        { type: "choice", id: "n1", choices: [choice, choice, choice, choice, choice] },
        validScene.nodes[1],
      ],
    });
  });
});

describe("worldSchema / rankSchema", () => {
  const rank = {
    id: "rank_a",
    name: "妃",
    grade: "正一品",
    selfRefs: { toPlayer: ["本宫"], formal: ["本宫"] },
    order: 10,
    domain: "harem",
    favorTerm: "恩宠",
  };

  it("accepts a valid rank and rejects empty selfRefs", () => {
    accepts(characterRankSchema, rank);
    rejects(characterRankSchema, { ...rank, selfRefs: { toPlayer: [], formal: ["本宫"] } });
    rejects(characterRankSchema, { ...rank, domain: "eunuch" });
  });

  it("rejects impossible calendar starts", () => {
    const world = {
      contentVersion: "t",
      calendar: { apMax: 5, start: { year: 1, month: 1, period: "early" } },
      startingLocation: "loc_a",
      sovereign: { startingAge: 18 },
      startingResources: {
        sovereign: { health: 70, diligence: 50, prestige: 50, martial: 50, statecraft: 50, cruelty: 20, fatigue: 20, regimeSecurity: 60 },
        nation: { military: 50, treasury: 50, publicSupport: 50, productivity: 50, governance: 50, consortClanPower: 30, ministerLoyalty: 50, corruption: 20, clanDiscontent: 20, rumor: 10 },
        bloodline: { menstrualStatus: "normal" },
      },
      ranks: [rank],
      officialPosts: [{ id: "commoner", name: "平民", grade: "无", gradeOrder: 0 }],
    };
    accepts(worldSchema, world);
    rejects(worldSchema, { ...world, calendar: { apMax: 5, start: { year: 1, month: 13, period: "early" } } });
    rejects(worldSchema, { ...world, calendar: { apMax: 0, start: { year: 1, month: 1, period: "early" } } });
    rejects(worldSchema, { ...world, ranks: [] });
    rejects(worldSchema, { ...world, officialPosts: [] });
  });
});

describe("rank/title fields", () => {
  it("standing accepts an optional 封号 title", () => {
    expect(characterStandingSchema.safeParse({ rank: "chenghui", favor: 30, title: "婉" }).success).toBe(true);
    expect(characterStandingSchema.safeParse({ rank: "chenghui", favor: 30 }).success).toBe(true);
  });
});

describe("rank/title effects", () => {
  const sovereign = { kind: "sovereign" as const, actorId: "player" as const };
  it("accepts set_rank / set_title / remove_title", () => {
    expect(eventEffectSchema.safeParse({ type: "set_rank", char: "lu_huaijin", rank: "jun", authority: sovereign }).success).toBe(true);
    expect(eventEffectSchema.safeParse({ type: "set_title", char: "lu_huaijin", title: "婉", authority: sovereign }).success).toBe(true);
    expect(eventEffectSchema.safeParse({ type: "remove_title", char: "lu_huaijin", authority: sovereign }).success).toBe(true);
  });
  it("rejects a 封号 longer than 4 漢字", () => {
    expect(eventEffectSchema.safeParse({ type: "set_title", char: "lu_huaijin", title: "一二三四五" }).success).toBe(false);
  });
});

import worldJson from "../../content/world.json";

it("world.json carries rankChangeReactions for all four kinds", () => {
  const parsed = worldSchema.safeParse(worldJson);
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(Object.keys(parsed.data.rankChangeReactions ?? {}).sort()).toEqual(
      ["demote", "grant_title", "promote", "strip_title"],
    );
  }
});
