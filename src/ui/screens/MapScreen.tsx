import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { LocationContent, MapBoard, MapPortal } from "../../engine/content/schemas";
import { buildTravelBatch, checkTravel } from "../../engine/map/travel";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { GameShell } from "../components/GameShell";
import { HaremGrid } from "./HaremGrid";

/** Boards rendered as a symmetric grid (§四) instead of absolute nodes on art. */
const GRID_BOARDS = new Set(["hougong"]);

/** Legacy fallback when world.json predates the map graph (test/minimal content). */
const DEFAULT_BOARD: MapBoard = { id: "palace", name: "宫城图", art: { key: "map.palace", kind: "map" } };

/** 主图分区装饰标签（§三.1）：仅作空间分组提示，不可点。 */
const REGION_LABELS: Record<string, Array<{ text: string; x: number; y: number }>> = {
  palace: [
    { text: "皇嗣区域", x: 0.22, y: 0.19 },
    { text: "内廷区域", x: 0.78, y: 0.19 },
  ],
};

export function MapScreen({
  db,
  store,
  registry,
  atRoot,
  onTravelled,
  onEnterCurrent,
  onOpenView,
  onOpenSettings,
  onClose,
  onOpenResources,
  onOpenStorehouse,
  onOpenCourtyard,
  onEnterShop,
  onBoardChange,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  /** Open on the 皇城主地图 (root board) — true after 新游戏 / 事件结束 (hub return);
   *  false when opened from a location's 宫城图 button (start on that board). */
  atRoot: boolean;
  /** spentAp=false 表示宫内免行动点移动（不掷懿旨/敲打、不跑转旬）。
   *  sovereignDied=true 表示本次跨月 tick 皇帝崩逝，调用方须 short-circuit 回 title。 */
  onTravelled: (rolledOver: boolean, spentAp: boolean, sovereignDied?: boolean) => void;
  onEnterCurrent: () => void;
  onOpenView: (locationId: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  onOpenResources?: () => void;
  onOpenStorehouse?: () => void;
  onOpenCourtyard: (loc: LocationContent) => void;
  onEnterShop: (id: "wanbaolou" | "zuixianlou") => void;
  onBoardChange?: (boardId: string) => void;
}) {
  const state = useGameState(store);
  const boards = db.world.mapBoards ?? [DEFAULT_BOARD];
  const portals = db.world.mapPortals ?? [];
  const boardOf = (id: string): MapBoard => boards.find((b) => b.id === id) ?? boards[0]!;

  // Ancestor path (root → … → parent) of a board, walked back through portals.
  // Initializing 返回's breadcrumb with this is what makes 返回 climb to the
  // 主地图 instead of dropping straight back into the room you came from.
  const ancestorsOf = (target: string): string[] => {
    const path: string[] = [];
    let cur = target;
    const seen = new Set<string>([cur]);
    for (;;) {
      const parent = portals.find((p) => p.to === cur)?.from;
      if (!parent || seen.has(parent)) break;
      path.unshift(parent);
      seen.add(parent);
      cur = parent;
    }
    return path;
  };

  const startBoard = atRoot ? boards[0]!.id : boardOf(db.locations[state.playerLocation]?.zone ?? boards[0]!.id).id;
  // The board we are looking at, plus the breadcrumb stack used by 返回.
  const [board, setBoard] = useState<string>(startBoard);
  const [stack, setStack] = useState<string[]>(() => ancestorsOf(startBoard));

  const current = boardOf(board);
  const boardArt = registry.resolveVariant(current.art.key, timeOfDay(state.calendar), current.art.kind);
  const onBoard = Object.values(db.locations).filter((l) => l.zone === board);
  const boardPortals = portals.filter((p) => p.from === board);

  // Report board changes to parent (Task 4/6 integration).
  useEffect(() => { onBoardChange?.(board); }, [board]);

  const enterBoard = (to: string) => {
    setStack((s) => [...s, board]);
    setBoard(to);
  };
  const goBack = () => {
    if (stack.length === 0) {
      onClose();
      return;
    }
    setStack((s) => s.slice(0, -1));
    setBoard(stack[stack.length - 1]!);
  };
  const jumpToCrumb = (index: number) => {
    // crumbs = [...stack, board]; only ancestor crumbs (index < stack.length) jump.
    if (index >= stack.length) return;
    setBoard(stack[index]!);
    setStack((s) => s.slice(0, index));
  };

  const travel = (to: string) => {
    const batch = buildTravelBatch(db, state, to);
    if (!batch.ok) return; // button is disabled; backstop only
    const moveCommands = batch.value.filter((c) => c.type !== "SPEND_AP");
    const spend = batch.value.find(
      (c): c is { type: "SPEND_AP"; amount: number } => c.type === "SPEND_AP",
    );
    if (spend) {
      // 耗行动点旅行：经统一时间入口（移动 + 扣点 + 跨月健康 tick + gameOver）。
      const result = store.travelAndAdvance(db, moveCommands, spend);
      if (result.ok) onTravelled(result.value.rolledOver, true, result.value.healthOutcome?.sovereignDied === true);
    } else {
      const result = store.dispatchBatch(moveCommands);
      if (result.ok) onTravelled(result.value.rolledOver, false, false);
    }
  };

  // 出宫（前往京城）扣 1 行动力，并复用 travel 的转旬/懿旨/敲打结算；
  // 回宫与城内（进后宫等）导航免费，仅切换视图。
  const exitPalace = (to: string) => {
    if (state.calendar.ap < 1) return; // button is disabled; backstop only
    // 出宫扣点经统一时间入口（无 MOVE 命令，仅推进时间 + 跨月健康 tick + gameOver）。
    const result = store.travelAndAdvance(db, [], { type: "SPEND_AP", amount: 1 });
    if (!result.ok) return;
    enterBoard(to);
    onTravelled(result.value.rolledOver, true, result.value.healthOutcome?.sovereignDied === true);
  };

  // 点击节点直接执行动作（无信息栏中转）。
  const onNodeActivate = (loc: LocationContent) => {
    if (loc.id === state.playerLocation) { onEnterCurrent(); return; }
    if (loc.id === "wanbaolou" || loc.id === "zuixianlou") { onEnterShop(loc.id); return; }
    if (loc.entry === "free") { onOpenView(loc.id); return; }
    if (!checkTravel(db, state, loc.id).ok) return; // 不可达：点击无效
    travel(loc.id);
  };

  const renderNode = (loc: LocationContent) => {
    const here = loc.id === state.playerLocation;
    const blocked = !here && loc.entry !== "free" && !checkTravel(db, state, loc.id).ok;
    const classes = [
      "map-node",
      here && "map-node--here",
      loc.entry === "free" && "map-node--free",
      blocked && "map-node--locked",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        key={loc.id}
        type="button"
        className={classes}
        style={{ left: `${loc.position.x * 100}%`, top: `${loc.position.y * 100}%` }}
        onClick={() => onNodeActivate(loc)}
      >
        <span className="map-node__dot" aria-hidden="true" />
        <span className="map-node__name">{loc.name}</span>
      </button>
    );
  };

  const renderPortal = (portal: MapPortal) => {
    return (
      <button
        key={`${portal.from}->${portal.to}`}
        type="button"
        className="map-node map-node--portal"
        style={{ left: `${portal.position.x * 100}%`, top: `${portal.position.y * 100}%` }}
        onClick={() => (portal.to === "jingcheng" ? exitPalace(portal.to) : enterBoard(portal.to))}
      >
        <span className="map-node__dot map-node__dot--portal" aria-hidden="true" />
        <span className="map-node__name">{portal.name}</span>
      </button>
    );
  };

  const crumbs = [...stack.map((id) => boardOf(id).name), current.name];
  const playerLocName = db.locations[state.playerLocation]?.name;
  const regions = REGION_LABELS[board] ?? [];

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={crumbs}
      locationName={playerLocName}
      pregnant={state.resources.bloodline.gestations.some((g) => g.carrier === "sovereign")}
      onBack={goBack}
      onCrumb={jumpToCrumb}
      onOpenResources={onOpenResources}
      onOpenSettings={onOpenSettings}
      onOpenStorehouse={onOpenStorehouse}
      className="map-shell"
    >
      <div className="map-layout">
        {GRID_BOARDS.has(board) ? (
          <HaremGrid
            db={db}
            state={state}
            locations={onBoard}
            selectedId={null}
            onSelect={(loc) => onOpenCourtyard(loc)}
          />
        ) : (
          <section
            className="map-board"
            aria-label={current.name}
            style={{ backgroundImage: `url("${boardArt.url}")` }}
          >
            {regions.map((r) => (
              <span
                key={r.text}
                className="map-region-label"
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}
                aria-hidden="true"
              >
                {r.text}
              </span>
            ))}
            {onBoard.map(renderNode)}
            {boardPortals.map(renderPortal)}
          </section>
        )}
      </div>
    </GameShell>
  );
}
