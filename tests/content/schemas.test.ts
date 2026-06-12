import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  characterRankSchema,
  characterSchema,
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
  initialRelationship: { trust: 10, affinity: 10, flags: [] },
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
    kind: "event",
    summary: "一条记忆。",
    salience: 50,
    tags: ["player"],
    participants: ["player", "char_a"],
  };

  it("initial drafts default protected to true; effect drafts may never be protected", () => {
    const parsed = initialMemoryDraftSchema.parse(draft);
    expect(parsed.protected).toBe(true);
    accepts(effectMemoryDraftSchema, draft);
    accepts(effectMemoryDraftSchema, { ...draft, protected: false });
    rejects(effectMemoryDraftSchema, { ...draft, protected: true }); // plan §6
  });

  it("rejects out-of-range salience, long summaries, too many / non-ascii tags", () => {
    rejects(initialMemoryDraftSchema, { ...draft, salience: 200 });
    rejects(initialMemoryDraftSchema, { ...draft, summary: "长".repeat(241) });
    rejects(initialMemoryDraftSchema, { ...draft, tags: ["a", "b", "c", "d", "e", "f"] });
    rejects(initialMemoryDraftSchema, { ...draft, tags: ["御花园"] });
  });
});

describe("triggerConditionSchema (closed DSL — scaffold guard)", () => {
  it("accepts every documented predicate incl. nesting", () => {
    accepts(triggerConditionSchema, {
      all: [
        { atLocation: "loc_a" },
        { not: { eventFired: "ev_a" } },
        { any: [{ flagSet: "x" }, { monthAtLeast: 3 }, { periodIs: "late" }] },
        { relationshipAtLeast: { char: "char_a", field: "affinity", value: 60 } },
        { favorAtLeast: { char: "char_a", value: 50 } },
        { rankAtLeast: { char: "char_a", rank: "rank_a" } },
      ],
    });
  });

  it("rejects scaffold-field predicates and unknown predicates outright", () => {
    rejects(triggerConditionSchema, { resourceAtLeast: { pillar: "bloodline", field: "legitimacy", value: 50 } });
    rejects(triggerConditionSchema, { bloodlineLegitimacyAtLeast: 50 });
    rejects(triggerConditionSchema, { relationshipAtLeast: { char: "char_a", field: "favor", value: 1 } });
  });
});

describe("eventEffectSchema (discriminated pillar/field pairs)", () => {
  it("accepts legal pillar/field combinations", () => {
    accepts(eventEffectSchema, { type: "resource", pillar: "court", field: "authority", delta: 3 });
    accepts(eventEffectSchema, { type: "resource", pillar: "harem", field: "jealousy", delta: -3 });
    accepts(eventEffectSchema, { type: "resource", pillar: "bloodline", field: "legitimacy", delta: 5 });
    accepts(eventEffectSchema, { type: "set_bloodline_status", field: "menstrualStatus", value: "absent" });
    accepts(eventEffectSchema, { type: "relationship", char: "char_a", field: "affinity", delta: -10 });
  });

  it("rejects illegal pairs, oversized deltas, and bad enums", () => {
    rejects(eventEffectSchema, { type: "resource", pillar: "court", field: "harmony", delta: 1 }); // wrong pair
    rejects(eventEffectSchema, { type: "resource", pillar: "bloodline", field: "menstrualStatus", delta: 1 });
    rejects(eventEffectSchema, { type: "relationship", char: "char_a", field: "trust", delta: 40 }); // ±10 cap
    rejects(eventEffectSchema, { type: "set_bloodline_status", field: "menstrualStatus", value: "pregnant" });
    rejects(eventEffectSchema, { type: "set_rank", char: "char_a", rank: "rank_a" }); // not an effect
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
      startingResources: {
        court: { authority: 50, publicSupport: 50, factionPressure: 20 },
        harem: { harmony: 60, jealousy: 20 },
        bloodline: { legitimacy: 60, menstrualStatus: "normal" },
      },
      ranks: [rank],
    };
    accepts(worldSchema, world);
    rejects(worldSchema, { ...world, calendar: { apMax: 5, start: { year: 1, month: 13, period: "early" } } });
    rejects(worldSchema, { ...world, calendar: { apMax: 0, start: { year: 1, month: 1, period: "early" } } });
    rejects(worldSchema, { ...world, ranks: [] });
  });
});
