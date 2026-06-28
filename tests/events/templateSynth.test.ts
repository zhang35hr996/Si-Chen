import { describe, expect, it } from "vitest";
import type { EventTemplate, TemplateOutcome } from "../../src/engine/content/schemas";
import {
  createRuntimeDB,
  injectTemplateContent,
  resolveOutcomeEffects,
  synthesizeEventContent,
  synthesizeSceneContent,
} from "../../src/engine/events/templateSynth";
import type { EventInstance } from "../../src/engine/events/templateEngine";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = () => createNewGameState(db);

const consortId = (): string => Object.keys(fresh().standing)[0]!;

const baseTemplate = (): EventTemplate => ({
  id: "tpl_synth_test",
  title: "合成测试模板",
  category: "garden_encounter",
  checkpoint: "location_enter",
  apCost: 1,
  triggerCondition: { atLocation: "yuhuayuan" },
  participantRoles: [
    { roleId: "protagonist", pool: "consort_alive_active", exclude: [], weightFactors: [] },
  ],
  participantConstraints: [],
  hiddenTruthCandidates: [{ id: "truth_a", description: "真相A", weight: 1 }],
  openingNarration: { mode: "narration" as const, text: "{protagonist}出现了。" },
  choices: [
    { id: "stay", text: "留下" },
    { id: "leave", text: "离开" },
  ],
  outcomes: [
    {
      choiceId: "stay",
      responseLine: { role: "protagonist", text: "臣侍留下。", expression: "smile" },
      effects: [{ type: "favor", role: "protagonist", delta: 2 }],
      memories: [],
    },
    { choiceId: "leave", effects: [], memories: [] },
  ],
  basePriority: 50,
});

const mkInstance = (charId: string): EventInstance => ({
  instanceId: "inst_tpl_synth_test_0_abcd",
  templateId: "tpl_synth_test",
  participants: { protagonist: charId },
  hiddenTruthId: "truth_a",
  generatedAtDayIndex: 0,
});

// ── createRuntimeDB ───────────────────────────────────────────────────

describe("createRuntimeDB", () => {
  it("starts with same events and scenes as base db", () => {
    const rdb = createRuntimeDB(db);
    expect(Object.keys(rdb.events)).toEqual(Object.keys(db.events));
    expect(Object.keys(rdb.scenes)).toEqual(Object.keys(db.scenes));
  });

  it("allows injection without modifying the original db", () => {
    const rdb = createRuntimeDB(db);
    const fakeEvent = {
      id: "ev_fake",
      title: "假事件",
      sceneId: "sc_fake",
      checkpoint: "location_enter" as const,
      condition: { atLocation: "yushufang" },
      priority: 50,
      once: false,
      apCost: 1,
    };
    injectTemplateContent(rdb, fakeEvent, {
      id: "sc_fake",
      locationId: "yushufang",
      participants: [],
      startNodeId: "n1",
      nodes: [{ type: "line", id: "n1", speaker: "player", text: "test" }],
    });
    expect(rdb.events["ev_fake"]).toBeDefined();
    expect((db.events as Record<string, unknown>)["ev_fake"]).toBeUndefined();
  });
});

// ── resolveOutcomeEffects ─────────────────────────────────────────────

describe("resolveOutcomeEffects", () => {
  it("resolves favor effect with actual charId", () => {
    const charId = consortId();
    const outcome: TemplateOutcome = {
      choiceId: "stay",
      effects: [{ type: "favor", role: "protagonist", delta: 3 }],
      memories: [],
    };
    const effects = resolveOutcomeEffects(outcome, { protagonist: charId });
    expect(effects).toHaveLength(1);
    const e = effects[0]!;
    expect(e.type).toBe("favor");
    if (e.type === "favor") {
      expect(e.char).toBe(charId);
      expect(e.delta).toBe(3);
    }
  });

  it("resolves adjust_consort_attr effect", () => {
    const charId = consortId();
    const outcome: TemplateOutcome = {
      choiceId: "x",
      effects: [
        {
          type: "adjust_consort_attr",
          role: "protagonist",
          field: "affection",
          delta: 5,
        },
      ],
      memories: [],
    };
    const effects = resolveOutcomeEffects(outcome, { protagonist: charId });
    expect(effects[0]).toMatchObject({ type: "adjust_consort_attr", char: charId, field: "affection", delta: 5 });
  });

  it("resolves memory entry with role substitution in subjectIds", () => {
    const charId = consortId();
    const outcome: TemplateOutcome = {
      choiceId: "x",
      effects: [],
      memories: [
        {
          forRole: "protagonist",
          entry: {
            kind: "episodic",
            summary: "一段记忆。",
            strength: 50,
            retention: "slow",
            subjectIds: ["player", "protagonist"],
            perspective: "witness",
            triggerTags: ["test"],
            unresolved: false,
            emotions: {},
          },
        },
      ],
    };
    const effects = resolveOutcomeEffects(outcome, { protagonist: charId });
    expect(effects).toHaveLength(1);
    const e = effects[0]!;
    expect(e.type).toBe("memory");
    if (e.type === "memory") {
      expect(e.char).toBe(charId);
      expect(e.entry.subjectIds).toContain("player");
      expect(e.entry.subjectIds).toContain(charId);
      expect(e.entry.subjectIds).not.toContain("protagonist");
    }
  });

  it("passes resource and flag effects through unchanged", () => {
    const outcome: TemplateOutcome = {
      choiceId: "x",
      effects: [
        { type: "resource", pillar: "nation", field: "rumor", delta: 2 },
        { type: "flag", key: "my_flag", value: true },
      ],
      memories: [],
    };
    const effects = resolveOutcomeEffects(outcome, {});
    expect(effects).toHaveLength(2);
    expect(effects[0]).toMatchObject({ type: "resource", pillar: "nation", field: "rumor", delta: 2 });
    expect(effects[1]).toMatchObject({ type: "flag", key: "my_flag", value: true });
  });

  it("returns empty array when outcome has no effects or memories", () => {
    const outcome: TemplateOutcome = { choiceId: "leave", effects: [], memories: [] };
    expect(resolveOutcomeEffects(outcome, {})).toHaveLength(0);
  });
});

// ── synthesizeEventContent ────────────────────────────────────────────

describe("synthesizeEventContent", () => {
  it("uses instanceId as both event id and sceneId", () => {
    const charId = consortId();
    const template = baseTemplate();
    const instance = mkInstance(charId);
    const event = synthesizeEventContent(template, instance);
    expect(event.id).toBe(instance.instanceId);
    expect(event.sceneId).toBe(instance.instanceId);
  });

  it("carries template checkpoint and apCost", () => {
    const charId = consortId();
    const template = baseTemplate();
    const event = synthesizeEventContent(template, mkInstance(charId));
    expect(event.checkpoint).toBe(template.checkpoint);
    expect(event.apCost).toBe(template.apCost);
  });

  it("includes exploration presentation when template has one", () => {
    const template: EventTemplate = {
      ...baseTemplate(),
      presentation: {
        mode: "exploration",
        hostLocationId: "yuhuayuan",
        subLocationId: "taiyechi",
        eventHint: "有人在此。",
      },
    };
    const event = synthesizeEventContent(template, mkInstance(consortId()));
    expect(event.presentation?.mode).toBe("exploration");
    if (event.presentation?.mode === "exploration") {
      expect(event.presentation.hostLocationId).toBe("yuhuayuan");
      expect(event.presentation.subLocationId).toBe("taiyechi");
    }
  });
});

// ── synthesizeSceneContent ────────────────────────────────────────────

describe("synthesizeSceneContent", () => {
  it("creates a scene with opening line, choice node, and outcome nodes", () => {
    const charId = consortId();
    const state = fresh();
    const template = baseTemplate();
    const instance = mkInstance(charId);
    const scene = synthesizeSceneContent(db, state, template, instance, "yuhuayuan");

    expect(scene.id).toBe(instance.instanceId);
    expect(scene.locationId).toBe("yuhuayuan");
    expect(scene.participants).toContain(charId);

    const nodeIds = scene.nodes.map((n) => n.id);
    expect(nodeIds).toContain("n_open");
    expect(nodeIds).toContain("n_choice");
    expect(nodeIds).toContain("n_fx_stay");
    expect(nodeIds).toContain("n_resp_stay"); // stay has responseLine
    expect(nodeIds).toContain("n_fx_leave");
  });

  it("substitutes {protagonist} token in opening narration", () => {
    const charId = consortId();
    const state = fresh();
    const template = baseTemplate();
    const instance = mkInstance(charId);
    const scene = synthesizeSceneContent(db, state, template, instance, "yuhuayuan");

    const openNode = scene.nodes.find((n) => n.id === "n_open");
    expect(openNode?.type).toBe("line");
    if (openNode?.type === "line") {
      // {protagonist} should be replaced with the character's actual name
      expect(openNode.text).not.toContain("{protagonist}");
    }
  });

  it("choice node routes each choice to its effect node", () => {
    const charId = consortId();
    const state = fresh();
    const template = baseTemplate();
    const scene = synthesizeSceneContent(db, state, template, mkInstance(charId), "yuhuayuan");

    const choiceNode = scene.nodes.find((n) => n.id === "n_choice");
    expect(choiceNode?.type).toBe("choice");
    if (choiceNode?.type === "choice") {
      const choiceIds = choiceNode.choices.map((c) => c.id);
      expect(choiceIds).toContain("stay");
      expect(choiceIds).toContain("leave");
      const stayChoice = choiceNode.choices.find((c) => c.id === "stay");
      expect(stayChoice?.next).toBe("n_fx_stay");
    }
  });

  it("effect node for choice with response line points to response line node", () => {
    const charId = consortId();
    const state = fresh();
    const scene = synthesizeSceneContent(db, state, baseTemplate(), mkInstance(charId), "yuhuayuan");

    const fxStay = scene.nodes.find((n) => n.id === "n_fx_stay");
    expect(fxStay?.type).toBe("effect");
    if (fxStay?.type === "effect") {
      expect(fxStay.next).toBe("n_resp_stay");
    }
  });

  it("effect node for choice without response line has no next (terminal after effects)", () => {
    const charId = consortId();
    const state = fresh();
    const scene = synthesizeSceneContent(db, state, baseTemplate(), mkInstance(charId), "yuhuayuan");

    const fxLeave = scene.nodes.find((n) => n.id === "n_fx_leave");
    expect(fxLeave?.type).toBe("effect");
    if (fxLeave?.type === "effect") {
      expect(fxLeave.next).toBeUndefined();
    }
  });

  it("resolves favor effect in scene effect node", () => {
    const charId = consortId();
    const state = fresh();
    const scene = synthesizeSceneContent(db, state, baseTemplate(), mkInstance(charId), "yuhuayuan");

    const fxStay = scene.nodes.find((n) => n.id === "n_fx_stay");
    if (fxStay?.type === "effect") {
      const favorEffect = fxStay.effects.find((e) => e.type === "favor");
      expect(favorEffect).toBeDefined();
      if (favorEffect?.type === "favor") {
        expect(favorEffect.char).toBe(charId);
        expect(favorEffect.delta).toBe(2);
      }
    }
  });
});
