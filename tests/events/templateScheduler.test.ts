/**
 * templateScheduler.ts 纯函数测试：频率计数、调度门、pending 短路。
 *
 * 计数器只统计 time_advance ambient 模板，其他类型不计入上限。
 */
import { describe, expect, it } from "vitest";
import {
  templateEventsResolvedOnDay,
  templateEventsResolvedInMonth,
  shouldTriggerTemplate,
} from "../../src/engine/events/templateScheduler";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { ContentDB } from "../../src/engine/content/loader";
import type { EventTemplate } from "../../src/engine/content/schemas";
import type { GameState, TemplateEventRecord } from "../../src/engine/state/types";

const db = loadRealContent();

function makeAmbientTimeAdvanceTemplate(id: string): EventTemplate {
  return {
    id,
    title: id,
    category: "garden_encounter",
    checkpoint: "time_advance",
    apCost: 1,
    triggerCondition: { all: [] },
    participantRoles: [{ roleId: "protagonist", pool: "consort_alive_active", exclude: [], weightFactors: [] }],
    participantConstraints: [],
    schedule: { kind: "ambient" },
    hiddenTruthCandidates: [{ id: "h", description: "d", weight: 1 }],
    openingNarration: { mode: "narration" as const, text: "test" },
    choices: [
      { id: "a", text: "甲" },
      { id: "b", text: "乙" },
    ],
    outcomes: [
      { choiceId: "a", effects: [], memories: [] },
      { choiceId: "b", effects: [], memories: [] },
    ],
    basePriority: 0,
  };
}

function makePendingTemplate(id: string): EventTemplate {
  return { ...makeAmbientTimeAdvanceTemplate(id), schedule: { kind: "pending" } };
}

function makeLocationEnterTemplate(id: string): EventTemplate {
  return {
    ...makeAmbientTimeAdvanceTemplate(id),
    checkpoint: "location_enter",
    schedule: { kind: "ambient" },
  };
}

function stateWithRecords(
  records: TemplateEventRecord[],
  templates: EventTemplate[] = [],
): { state: GameState; db: ContentDB } {
  const base = createNewGameState(db);
  const templateEventRecords: Record<string, TemplateEventRecord> = {};
  for (const r of records) templateEventRecords[r.id] = r;
  const state = { ...base, templateEventRecords };
  const patchedDb: ContentDB = {
    ...db,
    templates: Object.fromEntries(templates.map((t) => [t.id, t])),
  };
  return { state, db: patchedDb };
}

function resolvedRecord(
  id: string,
  templateId: string,
  year: number,
  month: number,
  period: "early" | "mid" | "late",
): TemplateEventRecord {
  return {
    id,
    templateId,
    participants: {},
    hiddenTruthId: "h",
    generatedAt: makeGameTime(year, month, period),
    status: "resolved",
    resolvedAt: makeGameTime(year, month, period),
  };
}

let seqCounter = 0;
const fakeRng = () => { seqCounter++; return 0.0; }; // always < triggerChance

describe("templateEventsResolvedOnDay — only counts time_advance ambient", () => {
  it("counts time_advance ambient resolved records on the given dayIndex", () => {
    const ambientTpl = makeAmbientTimeAdvanceTemplate("t_ambient");
    const at = makeGameTime(1, 1, "early");
    const records: TemplateEventRecord[] = [
      { id: "r1", templateId: "t_ambient", participants: {}, hiddenTruthId: "h", generatedAt: at, status: "resolved", resolvedAt: at },
      { id: "r2", templateId: "t_ambient", participants: {}, hiddenTruthId: "h", generatedAt: at, status: "resolved", resolvedAt: makeGameTime(1, 1, "mid") },
      { id: "r3", templateId: "t_ambient", participants: {}, hiddenTruthId: "h", generatedAt: at, status: "generated" },
    ];
    const { state, db: d } = stateWithRecords(records, [ambientTpl]);
    expect(templateEventsResolvedOnDay(d, state, at.dayIndex)).toBe(1);
  });

  it("does not count pending templates toward ambient day limit", () => {
    const pendingTpl = makePendingTemplate("t_pending");
    const at = makeGameTime(1, 1, "early");
    const records = [
      { id: "r1", templateId: "t_pending", participants: {}, hiddenTruthId: "h", generatedAt: at, status: "resolved" as const, resolvedAt: at },
    ];
    const { state, db: d } = stateWithRecords(records, [pendingTpl]);
    expect(templateEventsResolvedOnDay(d, state, at.dayIndex)).toBe(0);
  });

  it("does not count location_enter templates toward ambient day limit", () => {
    const leTpl = makeLocationEnterTemplate("t_le");
    const at = makeGameTime(1, 1, "early");
    const records = [
      { id: "r1", templateId: "t_le", participants: {}, hiddenTruthId: "h", generatedAt: at, status: "resolved" as const, resolvedAt: at },
    ];
    const { state, db: d } = stateWithRecords(records, [leTpl]);
    expect(templateEventsResolvedOnDay(d, state, at.dayIndex)).toBe(0);
  });
});

describe("templateEventsResolvedInMonth — only counts time_advance ambient", () => {
  it("counts time_advance ambient resolved records in the given year+month across all periods", () => {
    const ambientTpl = makeAmbientTimeAdvanceTemplate("t_a");
    const records = [
      resolvedRecord("a", "t_a", 1, 3, "early"),
      resolvedRecord("b", "t_a", 1, 3, "mid"),
      resolvedRecord("c", "t_a", 1, 3, "late"),
      resolvedRecord("d", "t_a", 1, 4, "early"),
      resolvedRecord("e", "t_a", 2, 3, "early"),
    ];
    const { state, db: d } = stateWithRecords(records, [ambientTpl]);
    expect(templateEventsResolvedInMonth(d, state, 1, 3)).toBe(3);
    expect(templateEventsResolvedInMonth(d, state, 1, 4)).toBe(1);
    expect(templateEventsResolvedInMonth(d, state, 2, 3)).toBe(1);
  });

  it("pending + location_enter records do not count toward monthly ambient limit", () => {
    const pendingTpl = makePendingTemplate("t_pending");
    const leTpl = makeLocationEnterTemplate("t_le");
    const records = [
      resolvedRecord("a", "t_pending", 1, 1, "early"),
      resolvedRecord("b", "t_le", 1, 1, "early"),
      resolvedRecord("c", "t_le", 1, 1, "mid"),
    ];
    const { state, db: d } = stateWithRecords(records, [pendingTpl, leTpl]);
    expect(templateEventsResolvedInMonth(d, state, 1, 1)).toBe(0);
  });
});

describe("shouldTriggerTemplate — ambient time_advance", () => {
  it("passes when roll < triggerChance and no limits hit", () => {
    const ambientTpl = makeAmbientTimeAdvanceTemplate("t_a");
    const { state, db: d } = stateWithRecords([], [ambientTpl]);
    const { passed } = shouldTriggerTemplate(d, state, "time_advance", "ambient", fakeRng);
    expect(passed).toBe(true);
  });

  it("blocks when daily limit (1) is already reached", () => {
    const ambientTpl = makeAmbientTimeAdvanceTemplate("t_a");
    const at = makeGameTime(1, 1, "early"); // dayIndex matches newGame
    const records: TemplateEventRecord[] = [
      { id: "r1", templateId: "t_a", participants: {}, hiddenTruthId: "h",
        generatedAt: at, status: "resolved", resolvedAt: at },
    ];
    const { state, db: d } = stateWithRecords(records, [ambientTpl]);
    const { passed, diagnostic } = shouldTriggerTemplate(d, state, "time_advance", "ambient", fakeRng);
    expect(passed).toBe(false);
    expect(diagnostic.skippedReason).toBe("daily_limit");
  });

  it("blocks when monthly limit (3) is reached", () => {
    const ambientTpl = makeAmbientTimeAdvanceTemplate("t_a");
    const records = [
      resolvedRecord("a", "t_a", 1, 1, "early"),
      resolvedRecord("b", "t_a", 1, 1, "early"),
      resolvedRecord("c", "t_a", 1, 1, "early"),
    ];
    const { state: s, db: d } = stateWithRecords(records, [ambientTpl]);
    const overrideState = { ...s, calendar: { ...s.calendar, month: 1, year: 1, period: "mid" as const, dayIndex: 1 } };
    const { passed, diagnostic } = shouldTriggerTemplate(d, overrideState, "time_advance", "ambient", fakeRng);
    expect(passed).toBe(false);
    expect(diagnostic.skippedReason).toBe("monthly_limit");
  });

  it("blocks when roll >= triggerChance (0.30)", () => {
    const { state, db: d } = stateWithRecords([], []);
    const failRng = () => 0.99;
    const { passed, diagnostic } = shouldTriggerTemplate(d, state, "time_advance", "ambient", failRng);
    expect(passed).toBe(false);
    expect(diagnostic.skippedReason).toBe("ambient_roll_failed");
    expect(diagnostic.probabilityRoll).toBeCloseTo(0.99);
  });

  it("pending records do not count toward monthly limit (limit still = 0)", () => {
    const pendingTpl = makePendingTemplate("t_pending");
    const ambientTpl = makeAmbientTimeAdvanceTemplate("t_a");
    const records = [
      resolvedRecord("a", "t_pending", 1, 1, "early"),
      resolvedRecord("b", "t_pending", 1, 1, "early"),
      resolvedRecord("c", "t_pending", 1, 1, "early"),
    ];
    const { state: s, db: d } = stateWithRecords(records, [pendingTpl, ambientTpl]);
    const overrideState = { ...s, calendar: { ...s.calendar, month: 1, year: 1, period: "mid" as const, dayIndex: 1 } };
    const { passed } = shouldTriggerTemplate(d, overrideState, "time_advance", "ambient", fakeRng);
    // pending records don't count, so monthly limit NOT reached → should pass (fakeRng = 0 < 0.30)
    expect(passed).toBe(true);
  });
});

describe("shouldTriggerTemplate — pending", () => {
  it("always passes regardless of roll or limits", () => {
    const ambientTpl = makeAmbientTimeAdvanceTemplate("t_a");
    const records = [
      resolvedRecord("a", "t_a", 1, 1, "early"),
      resolvedRecord("b", "t_a", 1, 1, "early"),
      resolvedRecord("c", "t_a", 1, 1, "early"),
    ];
    const { state, db: d } = stateWithRecords(records, [ambientTpl]);
    const failRng = () => 0.99;
    const { passed, diagnostic } = shouldTriggerTemplate(d, state, "time_advance", "pending", failRng);
    expect(passed).toBe(true);
    expect(diagnostic.skippedReason).toBe("pending_no_skip");
    expect(diagnostic.probabilityRoll).toBeNull();
  });
});

describe("shouldTriggerTemplate — location_enter", () => {
  it("always passes (100%) regardless of prior events", () => {
    const ambientTpl = makeAmbientTimeAdvanceTemplate("t_a");
    const records = [
      resolvedRecord("a", "t_a", 1, 1, "early"),
      resolvedRecord("b", "t_a", 1, 1, "early"),
      resolvedRecord("c", "t_a", 1, 1, "early"),
    ];
    const { state, db: d } = stateWithRecords(records, [ambientTpl]);
    const { passed } = shouldTriggerTemplate(d, state, "location_enter", "ambient", () => 0.99);
    expect(passed).toBe(true);
  });
});
