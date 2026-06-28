/**
 * 端到端集成测试：模板事件完整流水线。
 *
 * 覆盖：
 *   planTemplateEventMaterialization
 *   → injectTemplateContent (RuntimeContentDB)
 *   → SceneRunner.start     (含 narration 开场节点)
 *   → SceneRunner.advance   (选择选项)
 *   → SceneRunner.end       (返回 effects)
 *   → resolveTemplateEventRecord (结算持久化)
 */
import { describe, expect, it } from "vitest";
import type { EventTemplate } from "../../src/engine/content/schemas";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import { planTemplateEventMaterialization, resolveTemplateEventRecord } from "../../src/engine/events/templateMaterialization";
import { createRuntimeDB, injectTemplateContent } from "../../src/engine/events/templateSynth";
import { SceneRunner } from "../../src/engine/scenes/runner";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
};

const NARRATION_TEMPLATE: EventTemplate = {
  id: "tpl_integration_narration",
  title: "集成测试：旁白模板",
  category: "garden_encounter",
  checkpoint: "location_enter",
  apCost: 0,
  triggerCondition: { atLocation: "yuhuayuan" },
  participantRoles: [
    { roleId: "protagonist", pool: "consort_alive_active", exclude: [], weightFactors: [] },
  ],
  participantConstraints: [],
  hiddenTruthCandidates: [{ id: "truth_a", description: "真相A", weight: 1 }],
  openingNarration: { mode: "narration", text: "{protagonist}出现了。" },
  choices: [
    { id: "greet", text: "招呼" },
    { id: "ignore", text: "忽视" },
  ],
  outcomes: [
    {
      choiceId: "greet",
      responseLine: { role: "protagonist", text: "陛下万安。", expression: "smile" },
      effects: [{ type: "favor", role: "protagonist", delta: 1 }],
      memories: [],
    },
    {
      choiceId: "ignore",
      effects: [{ type: "favor", role: "protagonist", delta: -1 }],
      memories: [],
    },
  ],
  basePriority: 50,
};

describe("template event pipeline — narration opening", () => {
  it("SceneRunner 以 narration frame 开场，awaiting=choice，speakerId=narrator", async () => {
    const state = createNewGameState(db);
    const plan = planTemplateEventMaterialization(
      db, state, NARRATION_TEMPLATE, "yuhuayuan", seededRng(42),
      toGameTime(state.calendar),
    );
    expect(plan).not.toBeNull();
    if (!plan) return;

    const rdb = createRuntimeDB(db);
    injectTemplateContent(rdb, plan.event, plan.scene);

    // Apply the state patch (sequence increment + record persistence)
    const patchedState = {
      ...state,
      templateEventNextSeq: plan.nextStatePatch.templateEventNextSeq,
      templateEventRecords: {
        ...state.templateEventRecords,
        [plan.nextStatePatch.newRecord.id]: plan.nextStatePatch.newRecord,
      },
    };

    const runner = new SceneRunner(rdb, { provider: mockProvider });
    const first = await runner.start(patchedState, plan.instance.instanceId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.kind).toBe("frame");
    if (first.value.kind !== "frame") return;

    // 旁白帧：speakerId = "narrator"，text 不含占位符
    expect(first.value.frame.line.speakerId).toBe("narrator");
    expect(first.value.frame.line.text).not.toContain("{protagonist}");
    // 旁白帧附带了选项（n_open → n_choice 被合并到同一 frame）
    expect(first.value.frame.awaiting).toBe("choice");
    expect(first.value.frame.line.choices.map((c) => c.id)).toEqual(["greet", "ignore"]);
  });

  it("选择 greet 后得到 favor 效果，then SceneRunner ends", async () => {
    const state = createNewGameState(db);
    const plan = planTemplateEventMaterialization(
      db, state, NARRATION_TEMPLATE, "yuhuayuan", seededRng(42),
      toGameTime(state.calendar),
    );
    if (!plan) throw new Error("plan is null");

    const rdb = createRuntimeDB(db);
    injectTemplateContent(rdb, plan.event, plan.scene);

    const patchedState = {
      ...state,
      templateEventNextSeq: plan.nextStatePatch.templateEventNextSeq,
      templateEventRecords: {
        ...state.templateEventRecords,
        [plan.nextStatePatch.newRecord.id]: plan.nextStatePatch.newRecord,
      },
    };

    const runner = new SceneRunner(rdb, { provider: mockProvider });
    await runner.start(patchedState, plan.instance.instanceId);

    // greet → effect node → response line
    const afterChoice = await runner.advance("greet");
    expect(afterChoice.ok).toBe(true);
    if (!afterChoice.ok) return;
    // response line is a "continue" frame
    expect(afterChoice.value.kind).toBe("frame");
    if (afterChoice.value.kind !== "frame") return;
    expect(afterChoice.value.frame.awaiting).toBe("continue");
    expect(afterChoice.value.frame.line.text).toBe("陛下万安。");

    // terminal
    const end = await runner.advance();
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    expect(end.value.kind).toBe("end");
    if (end.value.kind !== "end") return;
    const favorEffect = end.value.effects.find((e) => e.type === "favor");
    expect(favorEffect).toBeDefined();
    if (favorEffect?.type === "favor") {
      expect(favorEffect.delta).toBe(1);
    }
  });

  it("resolveTemplateEventRecord 返回正确结算状态", () => {
    const state = createNewGameState(db);
    const now = toGameTime(state.calendar);
    const plan = planTemplateEventMaterialization(
      db, state, NARRATION_TEMPLATE, "yuhuayuan", seededRng(1), now,
    );
    if (!plan) throw new Error("plan is null");

    const record = plan.nextStatePatch.newRecord;
    expect(record.status).toBe("generated");
    expect(record.selectedChoiceId).toBeUndefined();

    const resolved = resolveTemplateEventRecord(record, "greet", now);
    expect(resolved.status).toBe("resolved");
    expect(resolved.selectedChoiceId).toBe("greet");
    expect(resolved.resolvedAt).toEqual(now);
    // 不可变：原 record 未被修改
    expect(record.status).toBe("generated");
  });

  it("planTemplateEventMaterialization nextStatePatch 递增 seq 并写入 record", () => {
    const state = createNewGameState(db);
    expect(state.templateEventNextSeq).toBe(0);
    const plan = planTemplateEventMaterialization(
      db, state, NARRATION_TEMPLATE, "yuhuayuan", seededRng(7),
      toGameTime(state.calendar),
    );
    if (!plan) throw new Error("plan is null");

    expect(plan.nextStatePatch.templateEventNextSeq).toBe(1);
    expect(plan.nextStatePatch.newRecord.id).toMatch(/^tei_\d{6}$/);
    expect(plan.nextStatePatch.newRecord.templateId).toBe("tpl_integration_narration");
    expect(plan.nextStatePatch.newRecord.status).toBe("generated");
    expect(plan.nextStatePatch.newRecord.participants).toHaveProperty("protagonist");
  });
});

describe("template event pipeline — dynamic consort (殿选侍君)", () => {
  it("所有静态侍君 deceased 时选人落到 generatedConsorts，SceneRunner 回应台词不崩溃", async () => {
    const baseState = createNewGameState(db);

    // 取第一个侍君的内容作为殿选侍君的内容底板（静态或 generated 均可）
    const staticId = Object.keys(baseState.standing).find(
      (id) => (db.characters[id] ?? baseState.generatedConsorts[id])?.kind === "consort",
    )!;
    const staticContent = (db.characters[staticId] ?? baseState.generatedConsorts[staticId])!;
    const staticStanding = baseState.standing[staticId]!;

    const dynId = "dyn_test_consort_01";
    // 殿选侍君只存在于 state.generatedConsorts，不在 db.characters
    const dynContent = {
      ...staticContent,
      id: dynId,
      profile: { ...staticContent.profile, name: "殿选侍君甲", surname: "甲" },
    };

    // 所有静态侍君标记 deceased，只留殿选侍君可选
    const deadStanding = Object.fromEntries(
      Object.entries(baseState.standing).map(([id, st]) => [id, { ...st, lifecycle: "deceased" as const }]),
    );

    const state = {
      ...baseState,
      standing: {
        ...deadStanding,
        [dynId]: { ...staticStanding, lifecycle: undefined },
      },
      generatedConsorts: { [dynId]: dynContent },
    };

    const plan = planTemplateEventMaterialization(
      db, state, NARRATION_TEMPLATE, "yuhuayuan", seededRng(11),
      toGameTime(state.calendar),
    );
    expect(plan).not.toBeNull();
    if (!plan) return;

    // 选出的参与者必须是殿选侍君
    expect(plan.instance.participants["protagonist"]).toBe(dynId);

    const rdb = createRuntimeDB(db);
    injectTemplateContent(rdb, plan.event, plan.scene);

    const patchedState = {
      ...state,
      templateEventNextSeq: plan.nextStatePatch.templateEventNextSeq,
      templateEventRecords: {
        ...state.templateEventRecords,
        [plan.nextStatePatch.newRecord.id]: plan.nextStatePatch.newRecord,
      },
    };

    const runner = new SceneRunner(rdb, { provider: mockProvider });
    const first = await runner.start(patchedState, plan.instance.instanceId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 选 greet → 触发 responseLine，走 finalizeLine(generatedConsorts) 路径
    const afterChoice = await runner.advance("greet");
    expect(afterChoice.ok).toBe(true);
    if (!afterChoice.ok) return;
    expect(afterChoice.value.kind).toBe("frame");
    if (afterChoice.value.kind !== "frame") return;
    // 回应台词 speakerId 应为殿选侍君 ID
    expect(afterChoice.value.frame.line.speakerId).toBe(dynId);
    expect(afterChoice.value.frame.line.text).toBe("陛下万安。");
  });
});

describe("template event pipeline — dialogue opening (via db.characters speaker)", () => {
  it("dialogue mode opening 产生 line 节点，speaker = 实际 charId", async () => {
    const dialogueTemplate: EventTemplate = {
      ...NARRATION_TEMPLATE,
      id: "tpl_integration_dialogue",
      openingNarration: { mode: "dialogue", speakerRole: "protagonist", text: "臣侍有事禀报。" },
    };

    const state = createNewGameState(db);
    const plan = planTemplateEventMaterialization(
      db, state, dialogueTemplate, "yuhuayuan", seededRng(99),
      toGameTime(state.calendar),
    );
    if (!plan) throw new Error("plan is null");

    const scene = plan.scene;
    const openNode = scene.nodes.find((n) => n.id === "n_open");
    expect(openNode?.type).toBe("line");
    if (openNode?.type === "line") {
      // speaker 是实际 charId，不是 roleId
      expect(openNode.speaker).not.toBe("protagonist");
      expect(db.characters[openNode.speaker] ?? state.generatedConsorts[openNode.speaker]).toBeDefined();
    }
  });
});
