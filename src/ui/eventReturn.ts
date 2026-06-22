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
