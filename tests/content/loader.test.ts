import { describe, expect, it } from "vitest";
import { loadContent, type RawContent } from "../../src/engine/content/loader";
import type { GameError } from "../../src/engine/infra/errors";

/** Minimal valid content set; tests structuredClone + mutate it. */
function makeRaw(): RawContent {
  const world = {
    contentVersion: "t1",
    calendar: { apMax: 5, start: { year: 1, month: 1, period: "early" } },
    startingLocation: "loc_a",
    sovereign: { startingAge: 18 },
    startingResources: {
      sovereign: { health: 70, diligence: 50, prestige: 50, martial: 50, statecraft: 50, cruelty: 20, fatigue: 20, regimeSecurity: 60 },
      nation: { military: 50, treasury: 50, publicSupport: 50, productivity: 50, governance: 50, consortClanPower: 30, ministerLoyalty: 50, corruption: 20, clanDiscontent: 20, rumor: 10 },
      bloodline: { menstrualStatus: "normal" },
    },
    ranks: [
      {
        id: "rank_a",
        name: "妃",
        grade: "正一品",
        selfRefs: { toPlayer: ["本宫"], formal: ["本宫"] },
        order: 10,
        domain: "harem",
        favorTerm: "恩宠",
      },
      {
        id: "rank_o",
        name: "女官",
        grade: "正五品",
        selfRefs: { toPlayer: ["臣"], formal: ["下官"] },
        order: 5,
        domain: "official",
        favorTerm: "圣眷",
      },
    ],
    officialPosts: [
      { id: "commoner", name: "平民", grade: "无", gradeOrder: 0 },
    ],
  };
  const lexicon = {
    approvedTerms: ["位分"],
    forbiddenTerms: ["父皇"],
    rankAddressRules: [
      { rank: "rank_a", selfRefs: { toPlayer: ["本宫"], formal: ["本宫"] }, addressedAs: "妃" },
      { rank: "rank_o", selfRefs: { toPlayer: ["臣"], formal: ["下官"] }, addressedAs: "司礼" },
    ],
    kinshipTerms: [],
    styleRules: [],
  };
  const character = {
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
    expressions: ["neutral"],
    voice: { register: "formal", quirks: [], tabooTopics: [] },
    initialStanding: { rank: "rank_a", favor: 10 },
    initialMemories: [],
    secrets: [],
  };
  const locA = {
    id: "loc_a",
    name: "甲殿",
    description: "描述。",
    backgroundKey: "bg.loc_a",
    ambience: [],
    position: { x: 0.2, y: 0.2 },
    connections: ["loc_b"],
    travelCost: { ap: 1 },
  };
  const locB = { ...locA, id: "loc_b", name: "乙殿", backgroundKey: "bg.loc_b", connections: ["loc_a"] };
  const event = {
    id: "ev_a",
    title: "测试事件",
    sceneId: "sc_a",
    checkpoint: "location_enter",
    condition: { all: [{ atLocation: "loc_a" }, { rankAtLeast: { char: "char_a", rank: "rank_a" } }] },
    priority: 1,
    once: true,
    apCost: 1,
  };
  const scene = {
    id: "sc_a",
    locationId: "loc_a",
    participants: ["char_a"],
    startNodeId: "n1",
    nodes: [
      { type: "line", id: "n1", speaker: "char_a", text: "……", next: "n2" },
      {
        type: "effect",
        id: "n2",
        effects: [
          { type: "memory", char: "char_a", entry: { kind: "episodic", summary: "记。", strength: 10, retention: "fast", subjectIds: ["char_a"], perspective: "witness", triggerTags: [], unresolved: false, emotions: {} } },
        ],
      },
    ],
  };
  return structuredClone({
    world: { source: "world.json", data: world },
    lexicon: { source: "lexicon.json", data: lexicon },
    characters: [{ source: "characters/char_a.json", data: character }],
    locations: [
      { source: "locations/loc_a.json", data: locA },
      { source: "locations/loc_b.json", data: locB },
    ],
    events: [{ source: "events/ev_a.json", data: event }],
    scenes: [{ source: "scenes/sc_a.json", data: scene }],
  });
}

const expectErrors = (raw: RawContent, code: string, fragment?: string): GameError[] => {
  const result = loadContent(raw);
  expect(result.ok).toBe(false);
  const errors = result.ok ? [] : result.error;
  const matching = errors.filter((e) => e.code === code);
  expect(matching.length, `expected ${code} in: ${errors.map((e) => `${e.code}:${e.message}`).join(" | ")}`).toBeGreaterThan(0);
  if (fragment) expect(matching.some((e) => e.message.includes(fragment))).toBe(true);
  return errors;
};

// helpers to reach into the raw fixture with sanity
const sceneData = (raw: RawContent) => raw.scenes[0]!.data as Record<string, unknown>;
const charData = (raw: RawContent) => raw.characters[0]!.data as Record<string, unknown>;

describe("loadContent success", () => {
  it("loads the minimal set into a frozen ContentDB", () => {
    const result = loadContent(makeRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const db = result.value;
    expect(db.contentVersion).toBe("t1");
    expect(Object.keys(db.characters)).toEqual(["char_a"]);
    expect(db.ranks["rank_a"]?.domain).toBe("harem");
    expect(Object.isFrozen(db)).toBe(true);
  });
});

describe("cross-reference checks", () => {
  it("unknown rank on a character", () => {
    const raw = makeRaw();
    (charData(raw)["initialStanding"] as Record<string, unknown>)["rank"] = "rank_ghost";
    expectErrors(raw, "MISSING_REF", "rank_ghost");
  });

  it("kind⇄domain mismatch: consort holding an official rank", () => {
    const raw = makeRaw();
    (charData(raw)["initialStanding"] as Record<string, unknown>)["rank"] = "rank_o";
    expectErrors(raw, "BAD_RANK", "official-domain");
  });

  it("event referencing a nonexistent scene", () => {
    const raw = makeRaw();
    (raw.events[0]!.data as Record<string, unknown>)["sceneId"] = "sc_ghost";
    expectErrors(raw, "MISSING_REF", "sc_ghost");
  });

  it("condition referencing unknown rank/character/location/event", () => {
    const raw = makeRaw();
    (raw.events[0]!.data as Record<string, unknown>)["condition"] = {
      all: [
        { atLocation: "loc_ghost" },
        { eventFired: "ev_ghost" },
        { rankAtLeast: { char: "char_ghost", rank: "rank_ghost" } },
      ],
    };
    const errors = expectErrors(raw, "MISSING_REF", "loc_ghost");
    expect(errors.filter((e) => e.code === "MISSING_REF")).toHaveLength(4);
  });

  it("hasMemoryTag condition referencing an unknown character", () => {
    const raw = makeRaw();
    (raw.events[0]!.data as Record<string, unknown>)["condition"] = {
      hasMemoryTag: { char: "char_ghost", tag: "neglect" },
    };
    expectErrors(raw, "MISSING_REF", "char_ghost");
  });

  it("memory effect targeting an unknown character", () => {
    const raw = makeRaw();
    const nodes = sceneData(raw)["nodes"] as Record<string, unknown>[];
    (nodes[1]!["effects"] as Record<string, unknown>[])[0]!["char"] = "char_ghost";
    expectErrors(raw, "MISSING_REF", "char_ghost");
  });

  it("duplicate ids across files", () => {
    const raw = makeRaw();
    raw.characters.push(structuredClone(raw.characters[0]!));
    expectErrors(raw, "DUPLICATE_ID", "char_a");
  });

  it("asymmetric and self map connections", () => {
    const raw = makeRaw();
    (raw.locations[1]!.data as Record<string, unknown>)["connections"] = ["loc_b"];
    const errors = expectErrors(raw, "ASYMMETRIC_MAP", "no return edge");
    expect(errors.some((e) => e.message.includes("connects to itself"))).toBe(true);
  });

  it("maternalClan referencing an unknown post is reported", () => {
    const raw = makeRaw();
    (charData(raw) as Record<string, unknown>)["profile"] = {
      ...(charData(raw)["profile"] as Record<string, unknown>),
      surname: "林",
    };
    (charData(raw) as Record<string, unknown>)["maternalClan"] = {
      familyId: "fam_test",
      postId: "post_ghost",
      legitimate: true,
      birthOrder: 1,
    };
    expectErrors(raw, "MISSING_REF", "post_ghost");
  });

  it("same familyId with conflicting postId is reported", () => {
    const raw = makeRaw();
    (raw.world.data as Record<string, unknown>)["officialPosts"] = [
      { id: "commoner", name: "平民", grade: "无", gradeOrder: 0 },
      { id: "post_b", name: "侍郎", grade: "正四品", gradeOrder: 4 },
    ];
    (charData(raw) as Record<string, unknown>)["profile"] = {
      ...(charData(raw)["profile"] as Record<string, unknown>),
      surname: "林",
    };
    (charData(raw) as Record<string, unknown>)["maternalClan"] = {
      familyId: "fam_lin",
      postId: "commoner",
      legitimate: true,
      birthOrder: 1,
    };
    // 第二位侍君同 familyId，但官职不同 → 冲突。
    const char2 = structuredClone(raw.characters[0]!);
    (char2.data as Record<string, unknown>)["id"] = "char_b";
    (char2.data as Record<string, unknown>)["maternalClan"] = {
      familyId: "fam_lin",
      postId: "post_b",
      legitimate: false,
      birthOrder: 2,
    };
    char2.source = "characters/char_b.json";
    raw.characters.push(char2);
    expectErrors(raw, "BAD_REF", "fam_lin");
  });

  it("same familyId with conflicting surname is reported", () => {
    const raw = makeRaw();
    (charData(raw) as Record<string, unknown>)["profile"] = {
      ...(charData(raw)["profile"] as Record<string, unknown>),
      surname: "林",
    };
    (charData(raw) as Record<string, unknown>)["maternalClan"] = {
      familyId: "fam_lin",
      postId: "commoner",
      legitimate: true,
      birthOrder: 1,
    };
    const char2 = structuredClone(raw.characters[0]!);
    (char2.data as Record<string, unknown>)["id"] = "char_b";
    (char2.data as Record<string, unknown>)["profile"] = {
      ...(char2.data as { profile: Record<string, unknown> }).profile,
      surname: "陈",
    };
    (char2.data as Record<string, unknown>)["maternalClan"] = {
      familyId: "fam_lin",
      postId: "commoner",
      legitimate: false,
      birthOrder: 2,
    };
    char2.source = "characters/char_b.json";
    raw.characters.push(char2);
    expectErrors(raw, "BAD_REF", "fam_lin");
  });

  it("different familyId may share a surname (no error)", () => {
    const raw = makeRaw();
    (charData(raw) as Record<string, unknown>)["profile"] = {
      ...(charData(raw)["profile"] as Record<string, unknown>),
      surname: "林",
    };
    (charData(raw) as Record<string, unknown>)["maternalClan"] = {
      familyId: "fam_lin_a",
      postId: "commoner",
      legitimate: true,
      birthOrder: 1,
    };
    const char2 = structuredClone(raw.characters[0]!);
    (char2.data as Record<string, unknown>)["id"] = "char_b";
    (char2.data as Record<string, unknown>)["maternalClan"] = {
      familyId: "fam_lin_b",
      postId: "commoner",
      legitimate: false,
      birthOrder: 2,
    };
    char2.source = "characters/char_b.json";
    raw.characters.push(char2);
    const result = loadContent(raw);
    expect(result.ok).toBe(true);
  });
});

describe("map board graph checks", () => {
  const withBoards = (raw: RawContent): Record<string, unknown> => {
    const world = raw.world.data as Record<string, unknown>;
    world["mapBoards"] = [
      { id: "palace", name: "宫城图", art: { key: "map.palace", kind: "map" } },
      { id: "jingcheng", name: "京城", art: { key: "bg.jingcheng", kind: "background" } },
    ];
    world["mapPortals"] = [
      { from: "palace", to: "jingcheng", name: "出宫", position: { x: 0.1, y: 0.8 } },
    ];
    return world;
  };

  it("accepts locations and portals on declared boards", () => {
    const raw = makeRaw();
    withBoards(raw);
    // loc_a/loc_b default to zone "palace" which is declared → no map errors.
    expect(loadContent(raw).ok).toBe(true);
  });

  it("rejects a location on an undeclared board", () => {
    const raw = makeRaw();
    withBoards(raw);
    (raw.locations[0]!.data as Record<string, unknown>)["zone"] = "atlantis";
    expectErrors(raw, "MISSING_REF", "atlantis");
  });

  it("rejects a portal to an undeclared board", () => {
    const raw = makeRaw();
    const world = withBoards(raw);
    (world["mapPortals"] as Record<string, unknown>[]).push({
      from: "palace",
      to: "moon",
      name: "登月",
      position: { x: 0.5, y: 0.5 },
    });
    expectErrors(raw, "MISSING_REF", "moon");
  });

  it("rejects a self-linking portal", () => {
    const raw = makeRaw();
    const world = withBoards(raw);
    (world["mapPortals"] as Record<string, unknown>[])[0]!["to"] = "palace";
    expectErrors(raw, "BAD_MAP_GRAPH", "itself");
  });

  it("skips map-graph checks when no boards are declared", () => {
    const raw = makeRaw();
    (raw.locations[0]!.data as Record<string, unknown>)["zone"] = "anything_goes";
    expect(loadContent(raw).ok).toBe(true); // legacy content: zone is free
  });
});

describe("scene graph checks", () => {
  it("bad startNodeId", () => {
    const raw = makeRaw();
    sceneData(raw)["startNodeId"] = "n_ghost";
    expectErrors(raw, "BAD_SCENE_GRAPH", "startNodeId");
  });

  it("dangling next target", () => {
    const raw = makeRaw();
    const nodes = sceneData(raw)["nodes"] as Record<string, unknown>[];
    nodes[0]!["next"] = "n_ghost";
    expectErrors(raw, "BAD_SCENE_GRAPH", "unknown node");
  });

  it("unreachable node", () => {
    const raw = makeRaw();
    const nodes = sceneData(raw)["nodes"] as Record<string, unknown>[];
    nodes.push({ type: "line", id: "n_orphan", speaker: "char_a", text: "……" });
    expectErrors(raw, "BAD_SCENE_GRAPH", "unreachable");
  });

  it("cycle with no terminal", () => {
    const raw = makeRaw();
    const nodes = sceneData(raw)["nodes"] as Record<string, unknown>[];
    nodes[1]!["next"] = "n1"; // n1 → n2 → n1
    expectErrors(raw, "BAD_SCENE_GRAPH", "no reachable terminal");
  });

  it("speaker who is not a participant", () => {
    const raw = makeRaw();
    const nodes = sceneData(raw)["nodes"] as Record<string, unknown>[];
    nodes[0]!["speaker"] = "char_ghost";
    expectErrors(raw, "BAD_SCENE_GRAPH", "not a scene participant");
  });
});

describe("lexicon checks", () => {
  it("approved ∩ forbidden must be empty", () => {
    const raw = makeRaw();
    (raw.lexicon.data as Record<string, unknown>)["forbiddenTerms"] = ["位分"];
    expectErrors(raw, "LEXICON", "both approved and forbidden");
  });

  it("every rank needs an address rule; selfRefs must match the rank table", () => {
    const raw = makeRaw();
    const lex = raw.lexicon.data as { rankAddressRules: { rank: string; selfRefs: unknown }[] };
    lex.rankAddressRules = [lex.rankAddressRules[0]!]; // drop rank_o
    lex.rankAddressRules[0]!.selfRefs = { toPlayer: ["臣妾"], formal: ["本宫"] }; // disagree
    const errors = expectErrors(raw, "LEXICON", "disagree");
    expect(errors.some((e) => e.message.includes("no rankAddressRules entry"))).toBe(true);
  });
});

describe("error collection", () => {
  it("reports ALL problems in one pass, each tagged with its file", () => {
    const raw = makeRaw();
    (charData(raw)["initialStanding"] as Record<string, unknown>)["rank"] = "rank_ghost";
    sceneData(raw)["startNodeId"] = "n_ghost";
    (raw.lexicon.data as Record<string, unknown>)["forbiddenTerms"] = ["位分"];
    const result = loadContent(raw);
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.error;
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(new Set(errors.map((e) => e.code))).toEqual(new Set(["MISSING_REF", "BAD_SCENE_GRAPH", "LEXICON"]));
    for (const error of errors) {
      expect(error.context?.["file"]).toBeTruthy();
    }
  });

  it("a schema-invalid file is reported but does not hide other files' errors", () => {
    const raw = makeRaw();
    raw.characters[0]!.data = { not: "a character" };
    (raw.events[0]!.data as Record<string, unknown>)["sceneId"] = "sc_ghost";
    const result = loadContent(raw);
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.error;
    expect(errors.some((e) => e.code === "SCHEMA")).toBe(true);
    expect(errors.some((e) => e.code === "MISSING_REF" && e.message.includes("sc_ghost"))).toBe(true);
  });
});
