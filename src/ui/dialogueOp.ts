/**
 * 生成式对话的异步操作所有权（§ async-dialogue-ownership）。纯状态机：每次会话分配唯一递增 token，
 * 同一时刻至多一个活动操作；只有「当前操作」能提交反应/清自身忙碌位；生命周期事件（新游戏/读档/驾崩/
 * 回标题）使所有进行中操作作废，且旧操作的收尾绝不能清掉新操作的忙碌位。
 */
export interface DialogueOpState {
  /** 单调递增的纪元；每次 start/invalidate 自增，保证 token 全局唯一。 */
  epoch: number;
  /** 当前活动操作 token；null=空闲。 */
  activeOp: number | null;
}

export const initialDialogueOpState: DialogueOpState = { epoch: 0, activeOp: null };

/** 开始一次对话操作：已有活动操作则拒绝（token=null）；否则分配唯一 token 并占用。 */
export function startDialogueOp(state: DialogueOpState): { state: DialogueOpState; token: number | null } {
  if (state.activeOp !== null) return { state, token: null }; // 已忙：拒绝（调用方不得扣行动点）
  const epoch = state.epoch + 1;
  return { state: { epoch, activeOp: epoch }, token: epoch };
}

/** token 是否仍是当前活动操作（await 结束后据此决定是否提交/串播）。 */
export function isCurrentDialogueOp(state: DialogueOpState, token: number): boolean {
  return state.activeOp === token;
}

/** 收尾：仅当 token 仍是当前操作才释放占用；否则原样返回（旧操作不得动新操作）。 */
export function finishDialogueOp(state: DialogueOpState, token: number): DialogueOpState {
  return state.activeOp === token ? { ...state, activeOp: null } : state;
}

/** 生命周期作废：纪元自增（使任何进行中 token 永不再 current）并清空活动操作。 */
export function invalidateDialogueOps(state: DialogueOpState): DialogueOpState {
  return { epoch: state.epoch + 1, activeOp: null };
}
