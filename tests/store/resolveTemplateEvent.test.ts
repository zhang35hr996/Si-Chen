/**
 * Store 模板事件结算测试：
 *
 *   beginTemplateEvent    — seq 递增 + generated record 原子写入
 *   resolveTemplateEvent  — effects + AP + eventLog + record resolved 单次提交
 *   abandonTemplateEvent  — 删除 generated record，不动 resolved record，不回退 seq
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { planTemplateEventStart } from "../../src/engine/events/templateStart";
import type { ContentDB } from "../../src/engine/content/loader";
import type { EventTemplate } from "../../src/engine/content/schemas";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

function makeAutoTemplate(id: string): EventTemplate {
  return {
    id,
    title: `test:${id}`,
    category: "harem_admin",
    checkpoint: "time_advance",
    apCost: 0,
    triggerCondition: { all: [] },
    participantRoles: [
      { roleId: "protagonist", pool: "consort_alive_active", exclude: [], weightFactors: [] },
    ],
    participantConstraints: [],
    presentation: { mode: "auto_on_enter" },
    hiddenTruthCandidates: [{ id: "truth_a", description: "a", weight: 1 }],
    openingNarration: { mode: "narration", text: "test narration" },
    choices: [
      { id: "opt_a", text: "甲" },
      { id: "opt_b", text: "乙" },
    ],
    outcomes: [
      { choiceId: "opt_a", effects: [], memories: [] },
      { choiceId: "opt_b", effects: [], memories: [] },
    ],
    basePriority: 0,
  };
}

function setupStore(stateOverrides: Partial<GameState> = {}) {
  const store = createGameStore();
  const base = createNewGameState(db);
  const state = { ...base, ...stateOverrides };
  store["state"] = state;
  return store;
}

describe("beginTemplateEvent", () => {
  it("writes seq + generated record atomically", () => {
    const template = makeAutoTemplate("tpl_begin");
    const patchedDb: ContentDB = { ...db, templates: { tpl_begin: template } };
    const store = setupStore();
    const plan = planTemplateEventStart(patchedDb, store.getState(), "time_advance");
    expect(plan).not.toBeNull();
    if (!plan) return;

    store.beginTemplateEvent(plan.statePatch);
    const s = store.getState();
    expect(s.templateEventNextSeq).toBe(plan.statePatch.templateEventNextSeq);
    expect(s.templateEventRecords[plan.instanceId]).toBeDefined();
    expect(s.templateEventRecords[plan.instanceId]?.status).toBe("generated");
  });
});

describe("resolveTemplateEvent", () => {
  it("marks record as resolved with selectedChoiceId and applies effects", () => {
    const template = makeAutoTemplate("tpl_resolve");
    const patchedDb: ContentDB = { ...db, templates: { tpl_resolve: template } };
    const store = setupStore();
    const plan = planTemplateEventStart(patchedDb, store.getState(), "time_advance");
    expect(plan).not.toBeNull();
    if (!plan) return;

    store.beginTemplateEvent(plan.statePatch);
    const result = store.resolveTemplateEvent(plan.runtimeDb, plan.instanceId, "opt_a", []);
    expect(result.ok).toBe(true);
    const record = store.getState().templateEventRecords[plan.instanceId];
    expect(record?.status).toBe("resolved");
    expect(record?.selectedChoiceId).toBe("opt_a");
    expect(record?.resolvedAt).toBeDefined();
  });

  it("rejects if record does not exist", () => {
    const store = setupStore();
    const emptyDb = { ...db, events: { ...db.events } };
    const result = store.resolveTemplateEvent(emptyDb, "nonexistent_tei", "opt_a", []);
    expect(result.ok).toBe(false);
  });

  it("rejects if record is already resolved", () => {
    const template = makeAutoTemplate("tpl_double");
    const patchedDb: ContentDB = { ...db, templates: { tpl_double: template } };
    const store = setupStore();
    const plan = planTemplateEventStart(patchedDb, store.getState(), "time_advance");
    if (!plan) return;

    store.beginTemplateEvent(plan.statePatch);
    const r1 = store.resolveTemplateEvent(plan.runtimeDb, plan.instanceId, "opt_a", []);
    expect(r1.ok).toBe(true);
    const r2 = store.resolveTemplateEvent(plan.runtimeDb, plan.instanceId, "opt_a", []);
    expect(r2.ok).toBe(false);
  });

  it("does not add a second emit when called once (single state update)", () => {
    const template = makeAutoTemplate("tpl_single_emit");
    const patchedDb: ContentDB = { ...db, templates: { tpl_single_emit: template } };
    const store = setupStore();
    const plan = planTemplateEventStart(patchedDb, store.getState(), "time_advance");
    if (!plan) return;

    store.beginTemplateEvent(plan.statePatch);
    let emitCount = 0;
    store.subscribe(() => { emitCount++; });
    store.resolveTemplateEvent(plan.runtimeDb, plan.instanceId, "opt_a", []);
    expect(emitCount).toBe(1);
  });
});

describe("resolveTemplateEvent — strict trace mode", () => {
  it("does not throw in strict trace mode (template_record_resolution is tracked)", () => {
    const template = makeAutoTemplate("tpl_strict");
    const patchedDb: ContentDB = { ...db, templates: { tpl_strict: template } };
    const store = createGameStore({ traceMode: "strict" });
    const base = createNewGameState(db);
    store["state"] = { ...base };
    const plan = planTemplateEventStart(patchedDb, store.getState(), "time_advance");
    expect(plan).not.toBeNull();
    if (!plan) return;
    store.beginTemplateEvent(plan.statePatch);
    expect(() => store.resolveTemplateEvent(plan.runtimeDb, plan.instanceId, "opt_a", [])).not.toThrow();
  });
});

describe("abandonTemplateEvent", () => {
  it("removes generated record, does not revert seq", () => {
    const template = makeAutoTemplate("tpl_abandon");
    const patchedDb: ContentDB = { ...db, templates: { tpl_abandon: template } };
    const store = setupStore();
    const plan = planTemplateEventStart(patchedDb, store.getState(), "time_advance");
    if (!plan) return;

    store.beginTemplateEvent(plan.statePatch);
    const seqBefore = store.getState().templateEventNextSeq;
    store.abandonTemplateEvent(plan.instanceId);
    const s = store.getState();
    expect(s.templateEventRecords[plan.instanceId]).toBeUndefined();
    expect(s.templateEventNextSeq).toBe(seqBefore); // seq not reverted
  });

  it("does not remove a resolved record", () => {
    const template = makeAutoTemplate("tpl_no_rm_resolved");
    const patchedDb: ContentDB = { ...db, templates: { tpl_no_rm_resolved: template } };
    const store = setupStore();
    const plan = planTemplateEventStart(patchedDb, store.getState(), "time_advance");
    if (!plan) return;

    store.beginTemplateEvent(plan.statePatch);
    store.resolveTemplateEvent(plan.runtimeDb, plan.instanceId, "opt_a", []);
    store.abandonTemplateEvent(plan.instanceId); // should be a no-op
    expect(store.getState().templateEventRecords[plan.instanceId]?.status).toBe("resolved");
  });

  it("is a no-op for unknown instanceId", () => {
    const store = setupStore();
    const seqBefore = store.getState().templateEventNextSeq;
    store.abandonTemplateEvent("nonexistent");
    expect(store.getState().templateEventNextSeq).toBe(seqBefore);
  });
});
