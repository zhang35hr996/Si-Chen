/**
 * 官员/家族成员的年度增龄（Phase 2 PR2A）。纯函数。由年度时间事务在「正月上旬进入」时
 * 统一调用一次——与玩家是否打开官员界面无关。dead 官员、deceased 成员不再增长。
 * 宫中侍君有自己的年龄系统（profile.age / ageAtEntry），此处绝不重复推进。
 */
import type { GameState } from "../state/types";

/** 运行期年龄硬上限（与 validator 的 1–120 持久不变量一致；增龄绝不越界）。 */
export const MAX_RUNTIME_AGE = 120;

const nextAge = (age: number): number => Math.min(age + 1, MAX_RUNTIME_AGE);

export function ageOfficialsOneYear(state: GameState): GameState {
  const officials: GameState["officials"] = {};
  for (const [id, o] of Object.entries(state.officials)) {
    officials[id] = o.status === "dead" ? o : { ...o, age: nextAge(o.age) };
  }
  const familyMembers: GameState["familyMembers"] = {};
  for (const [id, m] of Object.entries(state.familyMembers)) {
    familyMembers[id] = m.deceasedAt ? m : { ...m, age: nextAge(m.age) };
  }
  // 宗室青年（伴读来源）同步年度增龄；deceased 不再增长。
  const royalRelatives: GameState["royalRelatives"] = {};
  for (const [id, r] of Object.entries(state.royalRelatives)) {
    royalRelatives[id] = r.lifecycle === "deceased" ? r : { ...r, age: nextAge(r.age) };
  }
  return { ...state, officials, familyMembers, royalRelatives };
}
