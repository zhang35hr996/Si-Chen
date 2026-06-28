/**
 * templateScheduler.ts 纯函数测试：频率计数、调度门、pending 短路。
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
import type { GameState, TemplateEventRecord } from "../../src/engine/state/types";

const db = loadRealContent();

function stateWithRecords(records: TemplateEventRecord[]): GameState {
  const base = createNewGameState(db);
  const templateEventRecords: Record<string, TemplateEventRecord> = {};
  for (const r of records) templateEventRecords[r.id] = r;
  return { ...base, templateEventRecords };
}

function resolvedRecord(id: string, year: number, month: number, period: "early" | "mid" | "late"): TemplateEventRecord {
  return {
    id,
    templateId: "t_x",
    participants: {},
    hiddenTruthId: "h",
    generatedAt: makeGameTime(year, month, period),
    status: "resolved",
    resolvedAt: makeGameTime(year, month, period),
  };
}

let seqCounter = 0;
const fakeRng = () => { seqCounter++; return 0.0; }; // always < triggerChance

describe("templateEventsResolvedOnDay", () => {
  it("counts only resolved records on the given dayIndex", () => {
    const at = makeGameTime(1, 1, "early"); // dayIndex = 0
    const records: TemplateEventRecord[] = [
      { id: "r1", templateId: "t", participants: {}, hiddenTruthId: "h", generatedAt: at, status: "resolved", resolvedAt: at },
      { id: "r2", templateId: "t", participants: {}, hiddenTruthId: "h", generatedAt: at, status: "resolved", resolvedAt: makeGameTime(1, 1, "mid") },
      { id: "r3", templateId: "t", participants: {}, hiddenTruthId: "h", generatedAt: at, status: "generated" },
    ];
    expect(templateEventsResolvedOnDay(stateWithRecords(records), at.dayIndex)).toBe(1);
  });
});

describe("templateEventsResolvedInMonth", () => {
  it("counts resolved records in the given year+month across all periods", () => {
    const records = [
      resolvedRecord("a", 1, 3, "early"),
      resolvedRecord("b", 1, 3, "mid"),
      resolvedRecord("c", 1, 3, "late"),
      resolvedRecord("d", 1, 4, "early"), // different month
      resolvedRecord("e", 2, 3, "early"), // different year
    ];
    expect(templateEventsResolvedInMonth(stateWithRecords(records), 1, 3)).toBe(3);
    expect(templateEventsResolvedInMonth(stateWithRecords(records), 1, 4)).toBe(1);
    expect(templateEventsResolvedInMonth(stateWithRecords(records), 2, 3)).toBe(1);
  });
});

describe("shouldTriggerTemplate — ambient time_advance", () => {
  it("passes when roll < triggerChance and no limits hit", () => {
    const { passed } = shouldTriggerTemplate(createNewGameState(db), "time_advance", "ambient", fakeRng);
    expect(passed).toBe(true);
  });

  it("blocks when daily limit (1) is already reached", () => {
    const state = stateWithRecords([
      { id: "r1", templateId: "t", participants: {}, hiddenTruthId: "h",
        generatedAt: makeGameTime(1, 1, "early"), status: "resolved",
        resolvedAt: makeGameTime(1, 1, "early") }, // same dayIndex as newGame
    ]);
    const { passed, diagnostic } = shouldTriggerTemplate(state, "time_advance", "ambient", fakeRng);
    expect(passed).toBe(false);
    expect(diagnostic.skippedReason).toBe("daily_limit");
  });

  it("blocks when monthly limit (3) is reached", () => {
    const state = stateWithRecords([
      resolvedRecord("a", 1, 1, "early"),
      resolvedRecord("b", 1, 1, "early"),
      resolvedRecord("c", 1, 1, "early"),
    ]);
    // Override calendar to month 1 year 1 but a different day
    const overrideState = { ...state, calendar: { ...state.calendar, month: 1, year: 1, period: "mid" as const, dayIndex: 1 } };
    const { passed, diagnostic } = shouldTriggerTemplate(overrideState, "time_advance", "ambient", fakeRng);
    expect(passed).toBe(false);
    expect(diagnostic.skippedReason).toBe("monthly_limit");
  });

  it("blocks when roll >= triggerChance (0.30)", () => {
    const failRng = () => 0.99;
    const { passed, diagnostic } = shouldTriggerTemplate(createNewGameState(db), "time_advance", "ambient", failRng);
    expect(passed).toBe(false);
    expect(diagnostic.skippedReason).toBe("ambient_roll_failed");
    expect(diagnostic.probabilityRoll).toBeCloseTo(0.99);
  });
});

describe("shouldTriggerTemplate — pending", () => {
  it("always passes regardless of roll or limits", () => {
    const state = stateWithRecords([
      resolvedRecord("a", 1, 1, "early"),
      resolvedRecord("b", 1, 1, "early"),
      resolvedRecord("c", 1, 1, "early"),
    ]);
    const failRng = () => 0.99;
    const { passed, diagnostic } = shouldTriggerTemplate(state, "time_advance", "pending", failRng);
    expect(passed).toBe(true);
    expect(diagnostic.skippedReason).toBe("pending_no_skip");
    expect(diagnostic.probabilityRoll).toBeNull();
  });
});

describe("shouldTriggerTemplate — location_enter", () => {
  it("always passes (100%) regardless of prior events", () => {
    const state = stateWithRecords([
      resolvedRecord("a", 1, 1, "early"),
      resolvedRecord("b", 1, 1, "early"),
      resolvedRecord("c", 1, 1, "early"),
    ]);
    const { passed } = shouldTriggerTemplate(state, "location_enter", "ambient", () => 0.99);
    expect(passed).toBe(true);
  });
});
