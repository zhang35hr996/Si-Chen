import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { LocationContent, MapBoard, MapPortal } from "../../engine/content/schemas";
import { getPresentAt } from "../../engine/characters/presence";
import { getEligibleEvents } from "../../engine/events/engine";
import { buildTravelBatch, checkTravel } from "../../engine/map/travel";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { GameShell } from "../components/GameShell";
import { LocationInfoPanel, type LocationInfo } from "../components/LocationInfoPanel";

const REASON_TEXT: Record<string, string> = {
  ALREADY_THERE: "当前所在",
  NOT_CONNECTED: "无路可达",
  AP_INSUFFICIENT: "行动点不足",
  UNKNOWN_LOCATION: "未知地点",
  NOT_TRAVELABLE: "免行动点",
};

/** Legacy fallback when world.json predates the map graph (test/minimal content). */
const DEFAULT_BOARD: MapBoard = { id: "palace", name: "宫城图", art: { key: "map.palace", kind: "map" } };

/** 主图分区装饰标签（§三.1）：仅作空间分组提示，不可点。 */
const REGION_LABELS: Record<string, Array<{ text: string; x: number; y: number }>> = {
  palace: [
    { text: "皇嗣区域", x: 0.22, y: 0.19 },
    { text: "内廷区域", x: 0.78, y: 0.19 },
  ],
};

type Selected = { kind: "loc"; loc: LocationContent } | { kind: "portal"; portal: MapPortal };

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
  onOpenResources,
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
  onOpenResources?: () => void;
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
  const [selected, setSelected] = useState<Selected | null>(null);

  const current = boardOf(board);
  const boardArt = registry.resolveVariant(current.art.key, timeOfDay(state.calendar), current.art.kind);
  const onBoard = Object.values(db.locations).filter((l) => l.zone === board);
  const boardPortals = portals.filter((p) => p.from === board);
  const currentHasEvent = getEligibleEvents(db, state, "location_enter").length > 0;

  // When the viewed board changes, preselect the player's current location node
  // if it lives here, so the info panel opens with meaningful content.
  useEffect(() => {
    const here = onBoard.find((l) => l.id === state.playerLocation);
    setSelected(here ? { kind: "loc", loc: here } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

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
    const result = store.dispatchBatch(batch.value);
    if (result.ok) onTravelled(result.value.rolledOver);
  };

  // ── Build the right-panel info for the current selection ──────────────
  const infoFor = (sel: Selected | null): LocationInfo | null => {
    if (!sel) return null;
    if (sel.kind === "portal") {
      const p = sel.portal;
      const label = p.to === "jingcheng" ? "出宫 · 前往京城" : `进入${boardOf(p.to).name}`;
      return {
        title: p.name,
        kind: "portal",
        description: `通往${boardOf(p.to).name}。`,
        actionLabel: label,
        onAction: () => enterBoard(p.to),
      };
    }
    const loc = sel.loc;
    const present = getPresentAt(db, state, loc.id).length;
    if (loc.id === state.playerLocation) {
      return {
        title: loc.name,
        kind: "here",
        description: loc.description,
        presentCount: present,
        hasEvent: currentHasEvent,
        actionLabel: "进入此处",
        onAction: onEnterCurrent,
      };
    }
    if (loc.entry === "free") {
      return {
        title: loc.name,
        kind: "free",
        description: loc.description,
        actionLabel: "进入",
        onAction: () => onOpenView(loc.id),
      };
    }
    const check = checkTravel(db, state, loc.id);
    if (!check.ok) {
      return {
        title: loc.name,
        kind: "blocked",
        description: loc.description,
        presentCount: present,
        reason: REASON_TEXT[check.error.code] ?? check.error.message,
        actionLabel: "无法前往",
        actionDisabled: true,
        onAction: () => {},
      };
    }
    const ap = loc.travelCost?.ap ?? 1;
    return {
      title: loc.name,
      kind: "travel",
      description: loc.description,
      presentCount: present,
      actionLabel: `前往（耗 ${ap} 行动力）`,
      onAction: () => travel(loc.id),
    };
  };

  const renderNode = (loc: LocationContent) => {
    const here = loc.id === state.playerLocation;
    const isSelected = selected?.kind === "loc" && selected.loc.id === loc.id;
    const blocked = !here && loc.entry !== "free" && !checkTravel(db, state, loc.id).ok;
    const showEvent = here && currentHasEvent;
    const classes = [
      "map-node",
      here && "map-node--here",
      loc.entry === "free" && "map-node--free",
      blocked && "map-node--locked",
      isSelected && "is-selected",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        key={loc.id}
        type="button"
        className={classes}
        style={{ left: `${loc.position.x * 100}%`, top: `${loc.position.y * 100}%` }}
        aria-pressed={isSelected}
        onClick={() => setSelected({ kind: "loc", loc })}
      >
        <span className="map-node__dot" aria-hidden="true" />
        <span className="map-node__name">{loc.name}</span>
        {here && <span className="map-node__seal">当前</span>}
        {showEvent && <span className="map-node__event" aria-label="有事件" />}
      </button>
    );
  };

  const renderPortal = (portal: MapPortal) => {
    const isSelected = selected?.kind === "portal" && selected.portal.to === portal.to;
    return (
      <button
        key={`${portal.from}->${portal.to}`}
        type="button"
        className={`map-node map-node--portal${isSelected ? " is-selected" : ""}`}
        style={{ left: `${portal.position.x * 100}%`, top: `${portal.position.y * 100}%` }}
        aria-pressed={isSelected}
        onClick={() => setSelected({ kind: "portal", portal })}
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
      onOpenSave={onOpenSave}
      className="map-shell"
    >
      <div className="map-layout">
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

        <LocationInfoPanel info={infoFor(selected)} />
      </div>
    </GameShell>
  );
}
