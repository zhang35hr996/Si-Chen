import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent } from "../../src/engine/state/types";

const heirBorn: CourtEvent = {
  id: "evt_000001",
  type: "heir_born",
  occurredAt: makeGameTime(1, 5, "mid"),
  participants: [
    { charId: "consort_gu", role: "birth_father" },
    { charId: "player", role: "sovereign_parent" },
    { charId: "heir_000007", role: "newborn" },
  ],
  payload: { birthOrder: 7 },
  publicity: { scope: "palace", persistence: "institutional" },
  publicSalience: 85,
  retention: "slow",
  tags: ["birth"],
};

describe("chronicle schema", () => {
  it("初始 state 带空 chronicle 且通过 schema", () => {
    const s = createInitialState();
    expect(s.chronicle).toEqual([]);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });

  it("合法 CourtEvent 通过 schema", () => {
    const s = createInitialState();
    s.chronicle.push(heirBorn);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });

  it("circle 必须带 circleIds", () => {
    const s = createInitialState();
    s.chronicle.push({
      ...heirBorn,
      // @ts-expect-error 故意缺 circleIds
      publicity: { scope: "circle" },
    });
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });

  it("realm + contemporaneous 被 schema 拒绝", () => {
    const s = createInitialState();
    s.chronicle.push({
      ...heirBorn,
      // @ts-expect-error 故意非法组合
      publicity: { scope: "realm", persistence: "contemporaneous" },
    });
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });

  it("非 evt_NNNNNN 格式的事件 id 被拒（落实不变量）", () => {
    const s = createInitialState();
    s.chronicle.push({ ...heirBorn, id: "legacy_999999" });
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });
});
