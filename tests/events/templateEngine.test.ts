import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import type { EventTemplate } from "../../src/engine/content/schemas";
import {
  getEligibleTemplates,
  instantiateTemplate,
  pickTemplateEvent,
  weightedPick,
} from "../../src/engine/events/templateEngine";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db);

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const deterministicRng = seededRng(42);

// ── Template builder helpers ──────────────────────────────────────────

const baseTemplate = (): EventTemplate => ({
  id: "tpl_test",
  title: "测试模板",
  category: "garden_encounter",
  checkpoint: "location_enter",
  apCost: 1,
  triggerCondition: { atLocation: "yuhuayuan" },
  participantRoles: [
    {
      roleId: "protagonist",
      pool: "consort_alive_active",
      exclude: [],
      weightFactors: [],
    },
  ],
  participantConstraints: [],
  hiddenTruthCandidates: [
    { id: "truth_a", description: "真相A", weight: 1 },
    { id: "truth_b", description: "真相B", weight: 1 },
  ],
  openingNarration: { mode: "narration" as const, text: "{protagonist}出现了。" },
  choices: [
    { id: "stay", text: "留下" },
    { id: "leave", text: "离开" },
  ],
  outcomes: [
    { choiceId: "stay", effects: [], memories: [] },
    { choiceId: "leave", effects: [], memories: [] },
  ],
  basePriority: 50,
});

const withTemplate = (
  patch: Partial<EventTemplate>,
  existingTemplates: Record<string, EventTemplate> = {},
): ContentDB => {
  const t = { ...baseTemplate(), ...patch };
  return { ...db, templates: { ...existingTemplates, [t.id]: t } } as ContentDB;
};

const atLocation = (locationId: string): GameState => ({
  ...fresh(),
  playerLocation: locationId,
});

// ── weightedPick ──────────────────────────────────────────────────────

describe("weightedPick", () => {
  it("returns null for empty list", () => {
    expect(weightedPick([], deterministicRng)).toBeNull();
  });

  it("returns the only item when list has one element", () => {
    const result = weightedPick([{ item: "x", weight: 1 }], deterministicRng);
    expect(result).toBe("x");
  });

  it("distributes picks proportionally to weights", () => {
    const items = [
      { item: "heavy", weight: 9 },
      { item: "light", weight: 1 },
    ];
    const rng = seededRng(99);
    const picks = Array.from({ length: 100 }, () => weightedPick(items, rng));
    const heavyCount = picks.filter((p) => p === "heavy").length;
    // With 9:1 ratio, heavy should be picked ~90% of the time
    expect(heavyCount).toBeGreaterThan(70);
    expect(heavyCount).toBeLessThan(100);
  });
});

// ── getEligibleTemplates ──────────────────────────────────────────────

describe("getEligibleTemplates", () => {
  it("returns empty array when db has no templates", () => {
    const emptyDB = { ...db, templates: {} } as ContentDB;
    expect(getEligibleTemplates(emptyDB, fresh(), "location_enter")).toEqual([]);
  });

  it("matches template at correct checkpoint and location", () => {
    const testDB = withTemplate({ checkpoint: "location_enter" });
    const state = atLocation("yuhuayuan");
    const eligible = getEligibleTemplates(testDB, state, "location_enter");
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.template.id).toBe("tpl_test");
    expect(eligible[0]?.affordable).toBe(true);
  });

  it("rejects template at wrong checkpoint", () => {
    const testDB = withTemplate({ checkpoint: "time_advance" });
    const state = atLocation("yuhuayuan");
    expect(getEligibleTemplates(testDB, state, "location_enter")).toHaveLength(0);
  });

  it("rejects template when trigger condition not met", () => {
    const testDB = withTemplate({ triggerCondition: { atLocation: "yuhuayuan" } });
    const state = atLocation("yushufang"); // wrong location
    expect(getEligibleTemplates(testDB, state, "location_enter")).toHaveLength(0);
  });

  it("marks template unaffordable when AP is too low", () => {
    const testDB = withTemplate({ apCost: 3 });
    const broke: GameState = {
      ...atLocation("yuhuayuan"),
      calendar: { ...fresh().calendar, ap: 0 },
    };
    const eligible = getEligibleTemplates(testDB, broke, "location_enter");
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.affordable).toBe(false);
  });

  it("respects cooldown using templateEventRecords", () => {
    const testDB = withTemplate({ cooldown: { actionDays: 10 } });
    const state: GameState = {
      ...atLocation("yuhuayuan"),
      templateEventRecords: {
        "tei_000001": {
          id: "tei_000001",
          templateId: "tpl_test",
          participants: {},
          hiddenTruthId: "truth_a",
          generatedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
          status: "resolved",
        },
      },
      eventLog: [
        { eventId: "tei_000001", firedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } },
      ],
    };
    // dayIndex 0, cooldown 10, so still cooling
    expect(getEligibleTemplates(testDB, state, "location_enter")).toHaveLength(0);

    const later: GameState = {
      ...state,
      calendar: { ...state.calendar, dayIndex: 10, period: "late" },
    };
    expect(getEligibleTemplates(testDB, later, "location_enter")).toHaveLength(1);
  });

  it("sorts by basePriority descending, id ascending on tie", () => {
    const ta = { ...baseTemplate(), id: "tpl_a", basePriority: 50 };
    const tb = { ...baseTemplate(), id: "tpl_b", basePriority: 90 };
    const tc = { ...baseTemplate(), id: "tpl_c", basePriority: 50 };
    // Use only these three templates (no base tpl_test added)
    const testDB = { ...db, templates: { tpl_a: ta, tpl_b: tb, tpl_c: tc } } as ContentDB;
    const state = atLocation("yuhuayuan");
    const ids = getEligibleTemplates(testDB, state, "location_enter").map(
      (e) => e.template.id,
    );
    expect(ids).toEqual(["tpl_b", "tpl_a", "tpl_c"]);
  });

  it("loads real shipped templates into ContentDB", () => {
    expect(Object.keys(db.templates).length).toBeGreaterThanOrEqual(6);
    expect(db.templates["tpl_garden_deliberate_encounter"]).toBeDefined();
    expect(db.templates["tpl_ritual_birthday_scale"]).toBeDefined();
  });
});

// ── instantiateTemplate ───────────────────────────────────────────────

describe("instantiateTemplate", () => {
  it("returns null when no consorts in standing (empty game)", () => {
    const testDB = withTemplate({});
    const emptyState: GameState = { ...fresh(), standing: {} };
    const result = instantiateTemplate(testDB, emptyState, testDB.templates["tpl_test"]!, seededRng(1), 0);
    expect(result).toBeNull();
  });

  it("generates an instance with a participant from standing", () => {
    const testDB = withTemplate({});
    const state = atLocation("yuhuayuan");
    const consortIds = Object.keys(state.standing);
    expect(consortIds.length).toBeGreaterThan(0);

    const instance = instantiateTemplate(testDB, state, testDB.templates["tpl_test"]!, seededRng(1), 0);
    expect(instance).not.toBeNull();
    expect(consortIds).toContain(instance!.participants["protagonist"]);
  });

  it("assigns a hiddenTruthId from candidates", () => {
    const testDB = withTemplate({});
    const state = atLocation("yuhuayuan");
    const instance = instantiateTemplate(testDB, state, testDB.templates["tpl_test"]!, seededRng(1), 0);
    expect(instance).not.toBeNull();
    expect(["truth_a", "truth_b"]).toContain(instance!.hiddenTruthId);
  });

  it("generates a unique instanceId", () => {
    const testDB = withTemplate({});
    const state = atLocation("yuhuayuan");
    const rng = seededRng(1);
    const a = instantiateTemplate(testDB, state, testDB.templates["tpl_test"]!, rng, 0);
    const b = instantiateTemplate(testDB, state, testDB.templates["tpl_test"]!, rng, 1);
    expect(a?.instanceId).not.toBe(b?.instanceId);
  });

  it("does not reuse the same charId for two roles in one instance", () => {
    const twoRoleTemplate: EventTemplate = {
      ...baseTemplate(),
      participantRoles: [
        { roleId: "role_a", pool: "consort_alive_active", exclude: [], weightFactors: [] },
        { roleId: "role_b", pool: "consort_alive_active", exclude: [], weightFactors: [] },
      ],
    };
    const testDB = withTemplate({}, { tpl_test: twoRoleTemplate });
    const state = atLocation("yuhuayuan");

    // Need at least 2 consorts; skip if game state doesn't have them
    const consortIds = Object.keys(state.standing).filter(
      (id) => state.standing[id]!.lifecycle !== "deceased" && state.standing[id]!.lifecycle !== "candidate",
    );
    if (consortIds.length < 2) return;

    const instance = instantiateTemplate(testDB, state, twoRoleTemplate, seededRng(1), 0);
    expect(instance).not.toBeNull();
    const ids = Object.values(instance!.participants);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("excludes deceased consorts from consort_alive_active pool", () => {
    const testDB = withTemplate({});
    const state = atLocation("yuhuayuan");
    const consortId = Object.keys(state.standing)[0]!;

    const stateWithDead: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [consortId]: {
          ...state.standing[consortId]!,
          lifecycle: "deceased",
        },
      },
    };
    // Kill all consorts except one
    const allIds = Object.keys(state.standing);
    const deceased = allIds.slice(1);
    let s = stateWithDead;
    for (const id of deceased) {
      s = {
        ...s,
        standing: {
          ...s.standing,
          [id]: { ...s.standing[id]!, lifecycle: "deceased" },
        },
      };
    }
    // If all are dead, should return null
    const allDead: GameState = {
      ...s,
      standing: {
        ...s.standing,
        [allIds[0]!]: { ...s.standing[allIds[0]!]!, lifecycle: "deceased" },
      },
    };
    const result = instantiateTemplate(testDB, allDead, testDB.templates["tpl_test"]!, seededRng(1), 0);
    expect(result).toBeNull();
  });
});

// ── pickTemplateEvent ─────────────────────────────────────────────────

describe("pickTemplateEvent", () => {
  it("returns null when no eligible templates", () => {
    const emptyDB = { ...db, templates: {} } as ContentDB;
    const result = pickTemplateEvent(emptyDB, fresh(), "location_enter", deterministicRng);
    expect(result).toBeNull();
  });

  it("picks the highest priority affordable template that can be instantiated", () => {
    const low = { ...baseTemplate(), id: "tpl_low", basePriority: 30 };
    const high = { ...baseTemplate(), id: "tpl_high", basePriority: 80 };
    const testDB = { ...db, templates: { tpl_low: low, tpl_high: high } } as ContentDB;
    const state = atLocation("yuhuayuan");

    const result = pickTemplateEvent(testDB, state, "location_enter", seededRng(1));
    expect(result?.template.id).toBe("tpl_high");
    expect(result?.instance).toBeDefined();
  });

  it("skips unaffordable templates", () => {
    const expensive = { ...baseTemplate(), id: "tpl_exp", apCost: 9 };
    const cheap = { ...baseTemplate(), id: "tpl_cheap", apCost: 1, basePriority: 10 };
    const testDB = { ...db, templates: { tpl_exp: expensive, tpl_cheap: cheap } } as ContentDB;
    const broke: GameState = {
      ...atLocation("yuhuayuan"),
      calendar: { ...fresh().calendar, ap: 1 },
    };

    const result = pickTemplateEvent(testDB, broke, "location_enter", seededRng(1));
    expect(result?.template.id).toBe("tpl_cheap");
  });
});
