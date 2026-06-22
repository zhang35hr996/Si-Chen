/** 怀孕健康成本（设计 §5）：转胎 −10、生产 −5/−10，全经 planHealthChange 即时死亡不变量。 */
import type { GameTime } from "../engine/calendar/time";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";
import { planHealthChange } from "./health";

/** 转胎落到侍君：先 pregnancy_transfer 落库，再对该侍君扣 10 健康（cause pregnancy）。 */
export function planPregnancyTransfer(
  state: GameState,
  carrierId: string,
  atMonth: number,
  at: GameTime,
): EventEffect[] {
  const { effects: costFx } = planHealthChange(state, {
    subject: { kind: "consort", id: carrierId },
    healthDelta: -10,
    cause: "pregnancy",
    at,
  });
  return [{ type: "pregnancy_transfer", carrierId, atMonth }, ...costFx];
}

/** 生产母方健康成本：safe −5；child_dies −10；bearer_dies/both 0（已亡，不追加）。 */
export function childbirthCostDelta(
  bearerOutcome: "safe" | "child_dies" | "bearer_dies" | "both",
): number {
  if (bearerOutcome === "safe") return -5;
  if (bearerOutcome === "child_dies") return -10;
  return 0;
}
