/**
 * 官员/家族成员的年度增龄（Phase 2 PR2A）。纯函数。由年度时间事务在「正月上旬进入」时
 * 统一调用一次——与玩家是否打开官员界面无关。dead 官员、deceased 成员不再增长。
 * 宫中侍君有自己的年龄系统（profile.age / ageAtEntry），此处绝不重复推进。
 */
import type { GameState } from "../state/types";

export function ageOfficialsOneYear(state: GameState): GameState {
  const officials: GameState["officials"] = {};
  for (const [id, o] of Object.entries(state.officials)) {
    officials[id] = o.status === "dead" ? o : { ...o, age: o.age + 1 };
  }
  const familyMembers: GameState["familyMembers"] = {};
  for (const [id, m] of Object.entries(state.familyMembers)) {
    familyMembers[id] = m.deceasedAt ? m : { ...m, age: m.age + 1 };
  }
  return { ...state, officials, familyMembers };
}
