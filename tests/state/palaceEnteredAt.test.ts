import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { consortStandingExtras } from "../../src/engine/state/newGame";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import { firstNonEmpressConsortId } from "../helpers/consortFixture";

describe("palaceEnteredAt 播种", () => {
  const startTime = makeGameTime(1, 1, "early");

  it("无 authored 值 → 回退开局时刻", () => {
    const extras = consortStandingExtras(
      { kind: "consort", hidden: { affection: 40 }, initialStanding: { rank: "meiren", favor: 50 } },
      startTime,
    );
    expect(extras.palaceEnteredAt).toEqual(startTime);
    expect(extras.affection).toBe(40);
  });

  it("有 authored 值 → 不被覆盖", () => {
    const authored = makeGameTime(0 + 1, 3, "late"); // 元年三月下旬（authored 历史入宫）
    const extras = consortStandingExtras(
      { kind: "consort", initialStanding: { rank: "meiren", favor: 50, palaceEnteredAt: authored } },
      startTime,
    );
    expect(extras.palaceEnteredAt).toEqual(authored);
  });

  it("非侍君 → 不播种", () => {
    expect(consortStandingExtras({ kind: "official", initialStanding: { rank: "x", favor: 0 } }, startTime)).toEqual({});
  });

  it("真实内容：侍君 palaceEnteredAt = 开局时刻，通过 schema", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    const consortId = firstNonEmpressConsortId(db, s);
    expect(s.standing[consortId]!.palaceEnteredAt!.dayIndex).toBe(s.calendar.dayIndex);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });
});
