/**
 * 孕情展示纯格式化（display-only）。唯一权威来源 = gestations + 引擎 gestationMonth；不 mock 月份结果，
 * 用真实 GestationState（含 conceivedAt）跑真实算术。覆盖：受孕月=1、跨年、多胎按 carrier 精确选取、
 * pending 帝王孕未披露不显示、lifecycle 残态退化无月、非孕 null。
 */
import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, GestationState } from "../../src/engine/state/types";
import { consortGestationDisplay, sovereignGestationDisplay } from "../../src/ui/format/gestationDisplay";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const consortId = Object.keys(db.characters).find((id) => db.characters[id]!.kind === "consort")!;

/** 把状态的「当前」日历设到指定 year/month，并注入若干胎息/lifecycle。 */
function stateAt(
  year: number,
  month: number,
  opts: { gestations?: GestationState[]; carryingLifecycle?: string; pendingPregnancy?: boolean } = {},
): GameState {
  const base = createNewGameState(db);
  const next: GameState = {
    ...base,
    calendar: { ...base.calendar, year, month },
    resources: {
      ...base.resources,
      bloodline: {
        ...base.resources.bloodline,
        gestations: opts.gestations ?? [],
        ...(opts.pendingPregnancy ? { pregnancy: { ...base.resources.bloodline.pregnancy, status: "pending" } } : {}),
      },
    },
  };
  if (opts.carryingLifecycle) {
    next.standing = {
      ...next.standing,
      [consortId]: { ...(next.standing[consortId] ?? ({} as never)), lifecycle: opts.carryingLifecycle } as never,
    };
  }
  return next;
}

const gest = (carrier: string, cy: number, cm: number): GestationState => ({
  carrier,
  conceivedAt: makeGameTime(cy, cm, "early"),
});

describe("sovereign/consort gestation display", () => {
  it("1. no gestation → null", () => {
    expect(sovereignGestationDisplay(stateAt(2, 5))).toBeNull();
    expect(consortGestationDisplay(stateAt(2, 5), consortId)).toBeNull();
  });

  it("2. sovereign gestation returns the correct month and label", () => {
    const s = stateAt(2, 5, { gestations: [gest("sovereign", 2, 3)] }); // 5-3+1 = 3
    expect(sovereignGestationDisplay(s)).toEqual({ month: 3, label: "怀胎 · 孕3月" });
  });

  it("3. consort gestation returns the correct month and label", () => {
    const s = stateAt(2, 5, { gestations: [gest(consortId, 2, 3)] });
    expect(consortGestationDisplay(s, consortId)).toEqual({ month: 3, label: "承嗣君 · 孕3月" });
  });

  it("4. conception month is month 1", () => {
    const s = stateAt(2, 7, { gestations: [gest("sovereign", 2, 7)] });
    expect(sovereignGestationDisplay(s)?.month).toBe(1);
  });

  it("5. year-boundary month calculation is correct", () => {
    // conceived year1 month11, now year2 month2 → ordinals 11 → 14, month = 14-11+1 = 4
    const s = stateAt(2, 2, { gestations: [gest(consortId, 1, 11)] });
    expect(consortGestationDisplay(s, consortId)?.month).toBe(4);
  });

  it("6. multiple simultaneous gestations select the exact requested carrier", () => {
    const other = Object.keys(db.characters).find((id) => db.characters[id]!.kind === "consort" && id !== consortId)!;
    const s = stateAt(2, 6, { gestations: [gest("sovereign", 2, 5), gest(consortId, 2, 2), gest(other, 2, 1)] });
    expect(sovereignGestationDisplay(s)?.month).toBe(2); // 6-5+1
    expect(consortGestationDisplay(s, consortId)?.month).toBe(5); // 6-2+1
    expect(consortGestationDisplay(s, other)?.month).toBe(6); // 6-1+1
  });

  it("7. pending sovereign pregnancy without a sovereign gestation is not displayed", () => {
    const s = stateAt(2, 5, { pendingPregnancy: true }); // pre-disclosure: no gestation yet
    expect(sovereignGestationDisplay(s)).toBeNull();
  });

  it("8. lifecycle carrying without a matching gestation → degraded no-month fallback", () => {
    const s = stateAt(2, 5, { carryingLifecycle: "carrying" });
    expect(consortGestationDisplay(s, consortId)).toEqual({ month: null, label: "怀胎" });
  });

  it("9. non-carrying consort without gestation → null", () => {
    const s = stateAt(2, 5, { carryingLifecycle: "normal" });
    expect(consortGestationDisplay(s, consortId)).toBeNull();
  });
});
