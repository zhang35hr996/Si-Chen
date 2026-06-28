/**
 * planTemplateEventStart / planSubLocationTemplateStart 纯函数测试。
 *
 * 覆盖：
 *  - 无可用模板时返回 null
 *  - AP 不足时跳过
 *  - 可用时返回合法计划
 *  - 同 state + checkpoint = 相同结果（确定性）
 *  - 不同 templateEventNextSeq → 不同 instanceId
 *  - exploration 模板不被 planTemplateEventStart 选取
 *  - planSubLocationTemplateStart 只选匹配 subLocationId 的模板
 */
import { describe, expect, it } from "vitest";
import { planTemplateEventStart, planSubLocationTemplateStart } from "../../src/engine/events/templateStart";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameState } from "../../src/engine/state/types";
import type { EventTemplate } from "../../src/engine/content/schemas";

const db = loadRealContent();

function makeState(overrides: Partial<GameState> = {}): GameState {
  return { ...createNewGameState(db), ...overrides };
}

/** Build a minimal auto_on_enter template that passes all eligibility checks. */
function makeAutoTemplate(id: string, priority = 0): EventTemplate {
  return {
    id,
    title: `test:${id}`,
    category: "harem_admin",
    checkpoint: "time_advance",
    apCost: 0,
    triggerCondition: { all: [] },
    participantRoles: [
      {
        roleId: "protagonist",
        pool: "consort_alive_active",
        exclude: [],
        weightFactors: [],
      },
    ],
    participantConstraints: [],
    presentation: { mode: "auto_on_enter" },
    hiddenTruthCandidates: [{ id: "truth_a", description: "a", weight: 1 }],
    openingNarration: { mode: "narration", text: "test narration" },
    choices: [
      { id: "opt_a", text: "选项甲" },
      { id: "opt_b", text: "选项乙" },
    ],
    outcomes: [
      { choiceId: "opt_a", effects: [], memories: [] },
      { choiceId: "opt_b", effects: [], memories: [] },
    ],
    basePriority: priority,
  };
}

/** Build an exploration template for a given subLocationId. */
function makeExplorationTemplate(id: string, subLocationId: string): EventTemplate {
  return {
    ...makeAutoTemplate(id),
    checkpoint: "location_enter",
    presentation: {
      mode: "exploration",
      hostLocationId: "yuhuayuan",
      subLocationId,
      eventHint: `${id} hint`,
    },
  };
}

describe("planTemplateEventStart", () => {
  it("returns null when db has no templates", () => {
    const emptyDb: ContentDB = { ...db, templates: {} };
    const state = makeState();
    expect(planTemplateEventStart(emptyDb, state, "time_advance")).toBeNull();
  });

  it("returns null when ap is 0 and template requires 1 AP", () => {
    const template: EventTemplate = { ...makeAutoTemplate("t_costly"), apCost: 1 };
    const patchedDb: ContentDB = { ...db, templates: { t_costly: template } };
    const state = makeState({ calendar: { ...makeState().calendar, ap: 0 } });
    expect(planTemplateEventStart(patchedDb, state, "time_advance")).toBeNull();
  });

  it("returns a valid plan when a template is eligible and affordable", () => {
    const template = makeAutoTemplate("t_auto");
    const patchedDb: ContentDB = { ...db, templates: { t_auto: template } };
    const state = makeState();
    const plan = planTemplateEventStart(patchedDb, state, "time_advance");
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.instanceId).toMatch(/^tei_/);
    expect(plan.templateId).toBe("t_auto");
    expect(Object.keys(plan.runtimeDb.events)).toContain(plan.eventId);
    expect(plan.statePatch.templateEventNextSeq).toBe(state.templateEventNextSeq + 1);
    expect(plan.statePatch.newRecord.status).toBe("generated");
  });

  it("is deterministic: same state + checkpoint → same instanceId", () => {
    const template = makeAutoTemplate("t_det");
    const patchedDb: ContentDB = { ...db, templates: { t_det: template } };
    const state = makeState();
    const plan1 = planTemplateEventStart(patchedDb, state, "time_advance");
    const plan2 = planTemplateEventStart(patchedDb, state, "time_advance");
    expect(plan1?.instanceId).toBe(plan2?.instanceId);
  });

  it("different templateEventNextSeq → different instanceId", () => {
    const template = makeAutoTemplate("t_seq");
    const patchedDb: ContentDB = { ...db, templates: { t_seq: template } };
    const state1 = makeState({ templateEventNextSeq: 0 });
    const state2 = makeState({ templateEventNextSeq: 5 });
    const plan1 = planTemplateEventStart(patchedDb, state1, "time_advance");
    const plan2 = planTemplateEventStart(patchedDb, state2, "time_advance");
    expect(plan1?.instanceId).not.toBe(plan2?.instanceId);
  });

  it("exploration templates are excluded from auto checkpoint", () => {
    const template = makeExplorationTemplate("t_expl", "taiyi_chi");
    const patchedDb: ContentDB = { ...db, templates: { t_expl: template } };
    const state = makeState();
    expect(planTemplateEventStart(patchedDb, state, "location_enter")).toBeNull();
  });
});

describe("planSubLocationTemplateStart", () => {
  it("returns null when no exploration template matches subLocationId", () => {
    const template = makeExplorationTemplate("t_wrong_sub", "duixiu_shan");
    const patchedDb: ContentDB = { ...db, templates: { t_wrong_sub: template } };
    const state = makeState({ playerLocation: "yuhuayuan" });
    expect(planSubLocationTemplateStart(patchedDb, state, "yuhuayuan", "taiyi_chi")).toBeNull();
  });

  it("returns a plan for the matching subLocationId", () => {
    const template = makeExplorationTemplate("t_taiyi", "taiyi_chi");
    const patchedDb: ContentDB = { ...db, templates: { t_taiyi: template } };
    const state = makeState({ playerLocation: "yuhuayuan" });
    const plan = planSubLocationTemplateStart(patchedDb, state, "yuhuayuan", "taiyi_chi");
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.templateId).toBe("t_taiyi");
    expect(plan.statePatch.newRecord.status).toBe("generated");
  });

  it("ignores auto_on_enter templates", () => {
    const template = makeAutoTemplate("t_auto_loc");
    const patchedDb: ContentDB = { ...db, templates: { t_auto_loc: { ...template, checkpoint: "location_enter" as const } } };
    const state = makeState({ playerLocation: "yuhuayuan" });
    expect(planSubLocationTemplateStart(patchedDb, state, "yuhuayuan", "taiyi_chi")).toBeNull();
  });

  it("is deterministic for same subLocationId", () => {
    const template = makeExplorationTemplate("t_det2", "taiyi_chi");
    const patchedDb: ContentDB = { ...db, templates: { t_det2: template } };
    const state = makeState({ playerLocation: "yuhuayuan" });
    const p1 = planSubLocationTemplateStart(patchedDb, state, "yuhuayuan", "taiyi_chi");
    const p2 = planSubLocationTemplateStart(patchedDb, state, "yuhuayuan", "taiyi_chi");
    expect(p1?.instanceId).toBe(p2?.instanceId);
  });
});
