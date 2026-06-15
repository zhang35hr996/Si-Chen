import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { LocationContent, MapBoard } from "../../engine/content/schemas";
import { buildTravelBatch, checkTravel } from "../../engine/map/travel";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

const REASON_TEXT: Record<string, string> = {
  ALREADY_THERE: "当前所在",
  NOT_CONNECTED: "无路可达",
  AP_INSUFFICIENT: "行动点不足",
  UNKNOWN_LOCATION: "未知地点",
  NOT_TRAVELABLE: "免行动点",
};

/** Legacy fallback when world.json predates the map graph (test/minimal content). */
const DEFAULT_BOARD: MapBoard = { id: "palace", name: "宫城图", art: { key: "map.palace", kind: "map" } };

export function MapScreen({
  db,
  store,
  registry,
  atRoot,
  onTravelled,
  onEnterCurrent,
  onOpenView,
  onOpenSave,
  onClose,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  /** Open on the 皇城主地图 (root board) — true after 新游戏 / 事件结束 (hub return);
   *  false when opened from a location's 宫城图 button (start on that board). */
  atRoot: boolean;
  onTravelled: (rolledOver: boolean) => void;
  onEnterCurrent: () => void;
  onOpenView: (locationId: string) => void;
  onOpenSave: () => void;
  onClose: () => void;
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
  const backLabel = stack.length > 0 ? boardOf(stack[stack.length - 1]!).name : "返回";

  const travel = (to: string) => {
    const batch = buildTravelBatch(db, state, to);
    if (!batch.ok) return; // button is disabled; backstop only
    const result = store.dispatchBatch(batch.value);
    if (result.ok) onTravelled(result.value.rolledOver);
  };

  const renderTravelNode = (location: LocationContent) => {
    const here = location.id === state.playerLocation;
    // The node for the room you are already in re-opens it (免行动点); other
    // nodes fast-travel (the reducer spends AP).
    if (here) {
      return (
        <button
          key={location.id}
          type="button"
          className="map-node map-node--here"
          style={{ left: `${location.position.x * 100}%`, top: `${location.position.y * 100}%` }}
          title="进入此处"
          onClick={onEnterCurrent}
        >
          <span className="map-node__name">{location.name}</span>
          <span className="map-node__meta">当前所在</span>
        </button>
      );
    }
    const check = checkTravel(db, state, location.id);
    const reason = check.ok ? null : (REASON_TEXT[check.error.code] ?? check.error.message);
    return (
      <button
        key={location.id}
        type="button"
        className="map-node"
        style={{ left: `${location.position.x * 100}%`, top: `${location.position.y * 100}%` }}
        disabled={!check.ok}
        title={check.ok ? "前往" : (reason ?? "")}
        onClick={() => travel(location.id)}
      >
        <span className="map-node__name">{location.name}</span>
        {!check.ok && <span className="map-node__meta">{reason}</span>}
      </button>
    );
  };

  const renderFreeNode = (location: LocationContent) => (
    <button
      key={location.id}
      type="button"
      className="map-node map-node--portal"
      style={{ left: `${location.position.x * 100}%`, top: `${location.position.y * 100}%` }}
      title="进入"
      onClick={() => onOpenView(location.id)}
    >
      <span className="map-node__name">{location.name}</span>
    </button>
  );

  return (
    <main className="map-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatShichen(state.calendar)}
        </span>
        <span className="hud__group">
          <button type="button" className="hud__button" onClick={onOpenSave}>
            存档
          </button>
          <button type="button" className="hud__button" onClick={goBack}>
            {backLabel}
          </button>
        </span>
      </header>

      <section
        className="map-screen__board"
        aria-label={current.name}
        style={{ backgroundImage: `url("${boardArt.url}")` }}
      >
        <h2 className="map-screen__board-title">{current.name}</h2>

        {onBoard.map((location) => (location.entry === "free" ? renderFreeNode(location) : renderTravelNode(location)))}

        {boardPortals.map((portal) => (
          <button
            key={`${portal.from}->${portal.to}`}
            type="button"
            className="map-node map-node--portal"
            style={{ left: `${portal.position.x * 100}%`, top: `${portal.position.y * 100}%` }}
            title={portal.name}
            onClick={() => enterBoard(portal.to)}
          >
            <span className="map-node__name">{portal.name}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
