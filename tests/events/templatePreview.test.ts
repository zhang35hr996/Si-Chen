/**
 * previewSubLocationTemplate 纯函数测试：只读预览，不写 state。
 */
import { describe, expect, it } from "vitest";
import { previewSubLocationTemplate } from "../../src/engine/events/templatePreview";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { ContentDB } from "../../src/engine/content/loader";
import type { EventTemplate } from "../../src/engine/content/schemas";

const db = loadRealContent();

function makeExplorationTemplate(id: string, subLocationId: string): EventTemplate {
  return {
    id,
    title: `preview:${id}`,
    category: "garden_encounter",
    checkpoint: "location_enter",
    apCost: 0,
    triggerCondition: { all: [] },
    participantRoles: [
      { roleId: "protagonist", pool: "consort_alive_active", exclude: [], weightFactors: [] },
    ],
    participantConstraints: [],
    schedule: { kind: "ambient" },
    presentation: {
      mode: "exploration",
      hostLocationId: "yuhuayuan",
      subLocationId,
      eventHint: `${id}_hint`,
    },
    hiddenTruthCandidates: [{ id: "truth_a", description: "a", weight: 1 }],
    openingNarration: { mode: "narration", text: "test" },
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

describe("previewSubLocationTemplate", () => {
  it("returns null when no template matches subLocationId", () => {
    const template = makeExplorationTemplate("t_wrong", "duixiu_shan");
    const patchedDb: ContentDB = { ...db, templates: { t_wrong: template } };
    const state = createNewGameState(db);
    expect(previewSubLocationTemplate(patchedDb, state, "yuhuayuan", "taiyi_chi")).toBeNull();
  });

  it("returns preview with eventHint for matching template", () => {
    const template = makeExplorationTemplate("t_taiyi", "taiyi_chi");
    const patchedDb: ContentDB = { ...db, templates: { t_taiyi: template } };
    const state = createNewGameState(db);
    const preview = previewSubLocationTemplate(patchedDb, state, "yuhuayuan", "taiyi_chi");
    expect(preview).not.toBeNull();
    expect(preview?.templateId).toBe("t_taiyi");
    expect(preview?.eventHint).toBe("t_taiyi_hint");
  });

  it("does not mutate state (pure read-only)", () => {
    const template = makeExplorationTemplate("t_pure", "taiyi_chi");
    const patchedDb: ContentDB = { ...db, templates: { t_pure: template } };
    const state = createNewGameState(db);
    const seqBefore = state.templateEventNextSeq;
    const recsBefore = Object.keys(state.templateEventRecords).length;
    previewSubLocationTemplate(patchedDb, state, "yuhuayuan", "taiyi_chi");
    expect(state.templateEventNextSeq).toBe(seqBefore);
    expect(Object.keys(state.templateEventRecords).length).toBe(recsBefore);
  });

  it("returns affordable=true when apCost=0", () => {
    const template = makeExplorationTemplate("t_free", "taiyi_chi");
    const patchedDb: ContentDB = { ...db, templates: { t_free: template } };
    const state = createNewGameState(db);
    const preview = previewSubLocationTemplate(patchedDb, state, "yuhuayuan", "taiyi_chi");
    expect(preview?.affordable).toBe(true);
  });

  it("returns affordable=false when ap is insufficient", () => {
    const template: EventTemplate = { ...makeExplorationTemplate("t_costly", "taiyi_chi"), apCost: 5 };
    const patchedDb: ContentDB = { ...db, templates: { t_costly: template } };
    const state = { ...createNewGameState(db), calendar: { ...createNewGameState(db).calendar, ap: 0 } };
    const preview = previewSubLocationTemplate(patchedDb, state, "yuhuayuan", "taiyi_chi");
    expect(preview?.affordable).toBe(false);
  });
});
