/**
 * 「当前呈现场景」的 zone 推导与宫内门控（纯函数）。
 *
 * 为什么不能直接读 state.playerLocation：free-view 场景（如慈恩寺 simiao，entry:"free"）**不迁移**
 * state.playerLocation——玩家画面在慈恩寺，playerLocation 仍是进寺前的慈宁宫/紫宸殿等旧地点。
 * 若随机行动节拍按 playerLocation 判断「是否在宫中」，会把慈恩寺误判为旧的宫内地点。
 *
 * 因此按当前 UI 呈现态推导真正的场景 zone：
 *  - free-view：用 freeViewId 的 zone（慈恩寺→jingjiao、长门宫→hougong）；
 *  - 商铺：用 shopId 的 zone（京城）；
 *  - 主地图：用 currentBoard（看板 id 即 zone：palace/hougong/jingcheng/jingjiao）；
 *  - 专用宫殿屏 / 普通 location：playerLocation 在进入这些屏前已由 travel/enter 正确置位，直接用其 zone。
 */

/** 宫内 board/zone 集合：宫城(palace) + 后宫(hougong)。京城/郊外不算。 */
export function isImperialInteriorZone(zone: string | undefined | null): boolean {
  return zone === "palace" || zone === "hougong";
}

export interface PresentedSceneArgs {
  /** 当前 UI 视图（App 的 View；此处以 string 接收避免跨层耦合）。 */
  view: string;
  /** free-view 场景 id（view==="freeview" 时有效）。 */
  freeViewId: string | null;
  /** 商铺 id（view==="shop" 时有效）。 */
  shopId: string | null;
  /** 当前地图看板 id（palace/hougong/jingcheng/jingjiao）。 */
  currentBoard: string;
  /** 持久玩家位置（free-view 不迁移它）。 */
  playerLocation: string;
  /** location id → zone 解析（通常 `(id) => db.locations[id]?.zone`）。 */
  zoneOf: (locationId: string) => string | undefined;
}

/** 推导当前呈现场景的 zone。 */
export function derivePresentedZone(args: PresentedSceneArgs): string | undefined {
  const { view, freeViewId, shopId, currentBoard, playerLocation, zoneOf } = args;
  if (view === "freeview") return freeViewId ? zoneOf(freeViewId) : undefined;
  if (view === "shop") return shopId ? zoneOf(shopId) : undefined;
  if (view === "map") return currentBoard; // 看板 id 即 zone
  return zoneOf(playerLocation);
}

/** 当前呈现场景是否在宫中。 */
export function isPresentedSceneImperialInterior(args: PresentedSceneArgs): boolean {
  return isImperialInteriorZone(derivePresentedZone(args));
}
