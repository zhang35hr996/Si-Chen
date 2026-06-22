import { describe, expect, it } from "vitest";
import { loadContent, type RawContent } from "../../src/engine/content/loader";
import type { GameError } from "../../src/engine/infra/errors";

/**
 * Cross-reference validation for event `presentation` (scene-ui-narrative-refactor §3.5):
 *  - location_enter events whose atLocation derives to request_audience/exploration MUST declare presentation;
 *  - presentation refs (audienceCharacterId / hostLocationId / subLocationId) must resolve;
 *  - exploration host must have subLocations containing the subLocationId.
 * manual has no derivation path and is intentionally NOT detectable.
 */
function makeRaw(): RawContent {
  const world = {
    contentVersion: "t1",
    calendar: { apMax: 5, start: { year: 1, month: 1, period: "early" } },
    startingLocation: "zichendian",
    sovereign: { startingAge: 18 },
    startingResources: {
      sovereign: { health: 70, diligence: 50, prestige: 50, martial: 50, statecraft: 50, cruelty: 20, fatigue: 20, regimeSecurity: 60 },
      nation: { military: 50, treasury: 50, publicSupport: 50, productivity: 50, governance: 50, consortClanPower: 30, ministerLoyalty: 50, corruption: 20, clanDiscontent: 20, rumor: 10 },
      bloodline: { menstrualStatus: "normal" },
    },
    ranks: [
      { id: "rank_o", name: "女官", grade: "正五品", selfRefs: { toPlayer: ["臣"], formal: ["下官"] }, order: 5, domain: "official", favorTerm: "圣眷" },
    ],
    officialPosts: [{ id: "commoner", name: "平民", grade: "无", gradeOrder: 0 }],
  };
  const lexicon = {
    approvedTerms: ["位分"],
    forbiddenTerms: ["父皇"],
    rankAddressRules: [{ rank: "rank_o", selfRefs: { toPlayer: ["臣"], formal: ["下官"] }, addressedAs: "司礼" }],
    kinshipTerms: [],
    styleRules: [],
  };
  const weiLing = {
    id: "wei_ling",
    kind: "official",
    profile: { name: "卫绫", age: 30, role: "司礼", appearance: "外貌。", personalityTraits: ["端肃"], coreFacts: ["掌宫务"], goals: ["尽职"], speechStyle: "克制。" },
    defaultLocation: "zichendian",
    portraitSet: "wei_ling",
    expressions: ["neutral"],
    voice: { register: "formal", quirks: [], tabooTopics: [] },
    initialStanding: { rank: "rank_o", favor: 10 },
    initialMemories: [],
    secrets: [],
  };
  const zichen = { id: "zichendian", name: "紫宸殿", description: "描述。", backgroundKey: "bg.zichendian", ambience: [], position: { x: 0.5, y: 0.46 }, connections: ["yuhuayuan"], travelCost: { ap: 0 } };
  const garden = {
    id: "yuhuayuan", name: "御花园", description: "描述。", backgroundKey: "bg.yuhuayuan", ambience: [], position: { x: 0.8, y: 0.46 }, connections: ["zichendian"], travelCost: { ap: 0 },
    subLocations: [{ id: "taiyechi", name: "太液池", backgroundKey: "bg.taiyechi", description: "池水。" }],
  };
  const scene = { id: "sc_a", locationId: "zichendian", participants: ["wei_ling"], startNodeId: "n1", nodes: [{ type: "line", id: "n1", speaker: "wei_ling", text: "……" }] };
  // valid baseline: a request_audience event at zichendian, fully specified
  const event = {
    id: "ev_a", title: "测试事件", sceneId: "sc_a", checkpoint: "location_enter",
    condition: { atLocation: "zichendian" }, priority: 1, once: true, apCost: 1,
    presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_ling", audiencePrompt: "卫绫候见。" },
  };
  return structuredClone({
    world: { source: "world.json", data: world },
    lexicon: { source: "lexicon.json", data: lexicon },
    characters: [{ source: "characters/wei_ling.json", data: weiLing }],
    locations: [
      { source: "locations/zichendian.json", data: zichen },
      { source: "locations/yuhuayuan.json", data: garden },
    ],
    events: [{ source: "events/ev_a.json", data: event }],
    scenes: [{ source: "scenes/sc_a.json", data: scene }],
  });
}

const eventData = (raw: RawContent) => raw.events[0]!.data as Record<string, unknown>;
const loadErrors = (raw: RawContent): GameError[] => {
  const r = loadContent(raw);
  return r.ok ? [] : r.error;
};
const expectError = (raw: RawContent, code: string, fragment: string) => {
  const errors = loadErrors(raw);
  const hit = errors.some((e) => e.code === code && e.message.includes(fragment));
  expect(hit, `expected ${code} containing "${fragment}" in: ${errors.map((e) => `${e.code}:${e.message}`).join(" | ")}`).toBe(true);
};

describe("presentation cross-reference validation", () => {
  it("baseline fixture (fully-specified request_audience) loads clean", () => {
    expect(loadContent(makeRaw()).ok).toBe(true);
  });

  it("location_enter at zichendian without presentation → PRESENTATION error", () => {
    const raw = makeRaw();
    delete eventData(raw).presentation;
    expectError(raw, "PRESENTATION", "presentation");
  });

  it("location_enter at yuhuayuan without presentation → PRESENTATION error", () => {
    const raw = makeRaw();
    const ev = eventData(raw);
    delete ev.presentation;
    ev.condition = { atLocation: "yuhuayuan" };
    expectError(raw, "PRESENTATION", "presentation");
  });

  it("unknown audienceCharacterId → MISSING_REF", () => {
    const raw = makeRaw();
    (eventData(raw).presentation as Record<string, unknown>).audienceCharacterId = "nobody";
    expectError(raw, "MISSING_REF", "nobody");
  });

  it("unknown hostLocationId → MISSING_REF", () => {
    const raw = makeRaw();
    (eventData(raw).presentation as Record<string, unknown>).hostLocationId = "nowhere";
    expectError(raw, "MISSING_REF", "nowhere");
  });

  it("exploration subLocationId not in host subLocations → PRESENTATION error", () => {
    const raw = makeRaw();
    eventData(raw).condition = { atLocation: "yuhuayuan" };
    eventData(raw).presentation = { mode: "exploration", hostLocationId: "yuhuayuan", subLocationId: "ghost_pavilion" };
    expectError(raw, "PRESENTATION", "ghost_pavilion");
  });

  it("explicit manual presentation is structurally valid (no false positive)", () => {
    const raw = makeRaw();
    eventData(raw).presentation = { mode: "manual" };
    eventData(raw).condition = { atLocation: "zichendian" };
    // manual overrides derivation → no PRESENTATION error
    expect(loadErrors(raw).some((e) => e.code === "PRESENTATION")).toBe(false);
  });
});

const noPresentationError = (raw: RawContent) =>
  expect(loadErrors(raw).some((e) => e.code === "PRESENTATION")).toBe(false);

describe("guaranteed-location inference (no over-claiming)", () => {
  it("all:[atLocation:zichendian, not:eventFired] without presentation → error (guaranteed host)", () => {
    const raw = makeRaw();
    delete eventData(raw).presentation;
    eventData(raw).condition = { all: [{ atLocation: "zichendian" }, { not: { eventFired: "ev_a" } }] };
    expectError(raw, "PRESENTATION", "no presentation");
  });

  it("not:atLocation:zichendian without presentation → no error (negation pins nothing)", () => {
    const raw = makeRaw();
    delete eventData(raw).presentation;
    eventData(raw).condition = { not: { atLocation: "zichendian" } };
    noPresentationError(raw);
  });

  it("any:[atLocation:zichendian, flagSet] without presentation → no error (not guaranteed)", () => {
    const raw = makeRaw();
    delete eventData(raw).presentation;
    eventData(raw).condition = { any: [{ atLocation: "zichendian" }, { flagSet: "some_flag" }] };
    noPresentationError(raw);
  });

  it("any whose every branch guarantees zichendian without presentation → error", () => {
    const raw = makeRaw();
    delete eventData(raw).presentation;
    eventData(raw).condition = {
      any: [{ atLocation: "zichendian" }, { all: [{ atLocation: "zichendian" }, { not: { eventFired: "ev_a" } }] }],
    };
    expectError(raw, "PRESENTATION", "no presentation");
  });
});

describe("presentation ↔ checkpoint compatibility", () => {
  it("request_audience on a non-location_enter checkpoint fails validation", () => {
    const raw = makeRaw();
    eventData(raw).checkpoint = "time_advance"; // presentation stays request_audience
    expectError(raw, "PRESENTATION", 'requires checkpoint "location_enter"');
  });

  it("scheduled requires court checkpoint", () => {
    const raw = makeRaw();
    eventData(raw).presentation = { mode: "scheduled" };
    eventData(raw).checkpoint = "location_enter";
    expectError(raw, "PRESENTATION", 'requires checkpoint "court"');
  });

  it("a court event with non-scheduled presentation fails validation", () => {
    const raw = makeRaw();
    eventData(raw).checkpoint = "court";
    eventData(raw).condition = { flagSet: "x" }; // court events don't gate on location
    eventData(raw).presentation = { mode: "auto_on_enter" };
    expectError(raw, "PRESENTATION", 'must be "scheduled"');
  });
});
