/**
 * 事件返回上下文（scene-ui-narrative-refactor 设计规格 §3.4）。
 *
 * 纯导航/生命周期决策，独立于 1500 行的 App 组件，可在 Node + .test.ts 下直接测试
 * （无需 jsdom / App 渲染基座）。App 持有 navReducer 状态并据此恢复视图。
 *
 * 生命周期：玩家发起事件 → playerStart（覆盖旧 target、重置 chainDepth）；scene_end /
 * time_advance 自动续接 → chainAdvance（继承 target、chainDepth++，不重置不覆盖）；整条链
 * 结束（无后续事件或弃场）→ consume（快照后清空，恰好恢复一次）；新游戏/读档/驾崩 → clear。
 */

export type EventReturnTarget =
  // map：atRoot 区分「皇城主图根」与「恢复某个嵌套地图板（京城/郊外…）」。缺省 atRoot=true
  // 保持既有根图调用者行为；atRoot=false 时携带 boardId 以恢复被事件打断时所在的板。
  | { kind: "map"; atRoot?: boolean; boardId?: string }
  | { kind: "location"; locationId: string }
  | { kind: "zichendian" }
  | { kind: "garden"; subLocationId?: string }
  | { kind: "xuanzhengdian" };

/** 语义导航指令。App 据此落到当前可用视图（未建成的专用屏先用最近现有视图，字段不丢）。 */
export interface ReturnNavigation {
  view: "map" | "location" | "zichendian" | "garden" | "xuanzhengdian";
  locationId?: string;
  subLocationId?: string;
  /** map 专用：true=主图根（保留既有 goHome 行为）；false=恢复 boardId 指定的嵌套板。 */
  atRoot?: boolean;
  boardId?: string;
}

/** 御花园子地点宿主（garden target 不带 locationId，宿主固定为御花园）。 */
export const GARDEN_HOST_LOCATION_ID = "yuhuayuan";

/** 把语义 target 映射为导航指令（保留全部字段；恢复落点的具体视图由 App 决定）。 */
export function resolveReturnNavigation(target: EventReturnTarget): ReturnNavigation {
  switch (target.kind) {
    case "map":
      // 归一化 atRoot 默认 true（既有根图调用者行为不变）；boardId 仅在 atRoot=false 时有意义。
      return { view: "map", atRoot: target.atRoot ?? true, boardId: target.boardId };
    case "location":
      return { view: "location", locationId: target.locationId };
    case "zichendian":
      return { view: "zichendian", locationId: "zichendian" };
    case "garden":
      return { view: "garden", locationId: GARDEN_HOST_LOCATION_ID, subLocationId: target.subLocationId };
    case "xuanzhengdian":
      return { view: "xuanzhengdian", locationId: "xuanzhengdian" };
  }
}

/**
 * 自动 checkpoint 请求（§ separate-rollover-and-arrival）：把「跑哪些 checkpoint」显式化，取代
 * 重载的 rolledOver:boolean + 隐式 location_enter 兜底。
 *  - stationary_rollover：原地行动转旬 → 只跑 time_advance（玩家未进入新地点，绝不触发 location_enter）；
 *  - travel_rollover：移动并转旬 → 先 time_advance，无则 location_enter（保留既有优先级）；
 *  - arrival：普通移动到达（未转旬）→ 只跑 location_enter。
 * returnTarget 为完整语义返回上下文，原样用于所选事件与无事件恢复（不经 boardId 往返重建）。
 */
export type AutoCheckpointSource = "stationary_rollover" | "travel_rollover" | "arrival";
/**
 * 事件分发模式：new_chain=玩家发起/移动到达，自动启动的事件开新链（playerStart，重置 chainDepth）；
 * continue_chain=由已提交的事件场景转旬产生，自动启动的 time_advance 事件须留在当前链（chainAdvance，
 * 不重置 chainDepth，不消费返回上下文）。
 */
export type AutoCheckpointDispatch = "new_chain" | "continue_chain";
export interface AutoCheckpointRequest {
  source: AutoCheckpointSource;
  returnTarget: EventReturnTarget;
  dispatch: AutoCheckpointDispatch;
}

/** 该来源是否允许各 checkpoint（纯决策）。 */
export function autoCheckpointTriggers(source: AutoCheckpointSource): { timeAdvance: boolean; locationEnter: boolean } {
  return {
    timeAdvance: source !== "arrival",
    locationEnter: source !== "stationary_rollover",
  };
}

/**
 * 给定来源与各 checkpoint 当前命中的事件 id，决定自动启动哪个（time_advance 优先于 location_enter；
 * stationary_rollover 永不取 location_enter）。返回 null = 无事件，应做无事件恢复。
 */
export function autoCheckpointEventId(
  source: AutoCheckpointSource,
  timeEventId: string | null,
  locationEventId: string | null,
): string | null {
  const t = autoCheckpointTriggers(source);
  if (t.timeAdvance && timeEventId) return timeEventId;
  if (t.locationEnter && locationEventId) return locationEventId;
  return null;
}

/**
 * 反应队列结束后如何续接：arrival（未转旬，仅 location_enter）即时完成、不进全局结算排空；
 * 其余（转旬）须进结算先排空全局中断。纯决策，便于测试。
 */
export function deferredAutoCheckpointMode(request: AutoCheckpointRequest): "complete_now" | "settle" {
  return request.source === "arrival" ? "complete_now" : "settle";
}

/** scene_end→event 链上限（plan §10 #9 latent guard）。 */
export const MAX_EVENT_CHAIN = 3;

export interface NavState {
  target: EventReturnTarget | null;
  chainDepth: number;
}

export const initialNavState: NavState = { target: null, chainDepth: 0 };

export type NavAction =
  | { type: "playerStart"; target: EventReturnTarget } // 玩家发起：覆盖 target，重置 chainDepth
  | { type: "chainAdvance" } // 自动续接：继承 target，chainDepth++
  | { type: "consume" } // 最终恢复/弃场：清空 target
  | { type: "clear" }; // 新游戏/读档/驾崩：清空

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "playerStart":
      return { target: action.target, chainDepth: 0 };
    case "chainAdvance":
      return { target: state.target, chainDepth: state.chainDepth + 1 };
    case "consume":
    case "clear":
      return { target: null, chainDepth: 0 };
  }
}

/** 链预算是否仍有余（与既有 chainDepth.current < MAX_EVENT_CHAIN 语义一致）。 */
export function canChain(state: NavState): boolean {
  return state.chainDepth < MAX_EVENT_CHAIN;
}

/**
 * 事件提交后的完成决策（§ chained-settlement）。任一链内事件转旬都须保留待结算，直至整条 scene_end
 * 链走完才排空全局中断 + 补跑 time_advance + 恢复一次。
 *  - startSceneEnd：续接下一 scene_end 事件（chainAdvance）；
 *  - beginSettlement：登记/刷新 continue_chain 结算（本事件转旬 或 已有 pending → 保留，不丢转旬）；
 *  - restore：立即恢复（无续接、无转旬、无 pending）。
 * 三者关系：startSceneEnd 时不 restore（结算保留、由 activeEventId 守住不排空）；终端有结算则不 restore。
 */
export function eventSceneCompletionPlan(input: {
  committed: boolean;
  rolledOver: boolean;
  hasSceneEndEvent: boolean;
  canChain: boolean;
  hasPendingSettlement: boolean;
}): { startSceneEnd: boolean; beginSettlement: boolean; restore: boolean } {
  // 弃场：停止本事件，但绝不新建结算、也不在已有 pending 结算时消费/恢复导航上下文
  // （否则前序已提交事件 A 的转旬结算会在导航被提前消费后排空 → 落根/二次恢复）。
  if (!input.committed) return { startSceneEnd: false, beginSettlement: false, restore: !input.hasPendingSettlement };
  const startSceneEnd = input.hasSceneEndEvent && input.canChain;
  const beginSettlement = input.rolledOver || input.hasPendingSettlement; // 保留任何（本/链内先前）转旬
  const restore = !startSceneEnd && !beginSettlement; // 无续接且无待结算才立即恢复
  return { startSceneEnd, beginSettlement, restore };
}

/**
 * 延后补跑 checkpoint 的「待处理上下文」（§ deferred-reaction）。单一原子值，承载这段转旬反应结束后
 * 应执行的完整 AutoCheckpointRequest（来源 + 返回上下文）。null=无待补跑（含非转旬：覆盖式清空，杜绝
 * 「非转旬反应留下旧上下文 → 之后无关转旬反应误用」的串台）。
 */
export type PendingReactionCheckpoint = { request: AutoCheckpointRequest } | null;

export type PendingReactionAction =
  | { type: "begin"; request: AutoCheckpointRequest | null } // 转旬登记该请求；非转旬(null)覆盖清空
  | { type: "consume" } // 反应队列结束、转入结算后清空
  | { type: "clear" }; // 新游戏/读档/驾崩清空

export function pendingReactionReducer(
  _state: PendingReactionCheckpoint,
  action: PendingReactionAction,
): PendingReactionCheckpoint {
  switch (action.type) {
    case "begin":
      return action.request ? { request: action.request } : null;
    case "consume":
    case "clear":
      return null;
  }
}

/**
 * 位分管理会话来源（§ first-night-handoff）。把 origin 与 charId 绑成原子会话，避免 origin 独立于
 * 选中角色变陈旧。first_night：由初夜「晋升」进入——关闭/无变化/失败都须补跑被搁置的转旬 checkpoint；
 * 成功（生成反应）则交由该反应 onDone 补跑。normal：普通管理，关闭绝不因此补跑转旬。
 */
export type RankAdminOrigin = "normal" | "first_night";
export type RankAdminSession = { charId: string; origin: RankAdminOrigin } | null;
export type RankAdminOutcome = "close" | "no_op" | "failed" | "reaction_created";

/** 位分管理结束后如何处理待补跑的转旬 checkpoint（纯决策，App 据此调用 flush 或交给反应）。 */
export function rankAdminContinuation(
  origin: RankAdminOrigin,
  outcome: RankAdminOutcome,
): "flush_pending" | "defer_to_reaction" | "none" {
  if (origin !== "first_night") return "none"; // normal：关闭不补跑转旬
  return outcome === "reaction_created" ? "defer_to_reaction" : "flush_pending";
}

/**
 * runCheckpoints 自动启动事件时的返回上下文。**board ID 由发起动作（出宫 exitPalace 的目标板）
 * 显式传入**，不读异步镜像的父级 currentBoard——避免子组件先于 onBoardChange 生效就卸载导致捕获
 * 旧板（常为 "palace"）的时序耦合。board ID 在场 → 恢复该嵌套板；缺省 → 回事件所在地点。
 */
export function checkpointReturnTarget(
  stayOnMapBoardId: string | undefined,
  playerLocation: string,
): EventReturnTarget {
  return stayOnMapBoardId
    ? { kind: "map", atRoot: false, boardId: stayOnMapBoardId }
    : { kind: "location", locationId: playerLocation };
}
