import type { ContentDB } from "../../engine/content/loader";

/**
 * Breadcrumb trail for a location: 紫禁城 ＞ 后宫 ＞ 咸福宫.
 *
 * Walks the board graph from the location's zone back to the root board via
 * `mapPortals` (same parent-chain logic as MapScreen.ancestorsOf), then appends
 * the location's own name. The root board (紫禁城) is always the first crumb;
 * intermediate boards (e.g. 后宫) sit between root and the room.
 */
export function breadcrumbFor(db: ContentDB, locationId: string): string[] {
  const boards = db.world.mapBoards ?? [];
  const portals = db.world.mapPortals ?? [];
  const location = db.locations[locationId];
  if (!location) return [];
  const boardName = (id: string): string => boards.find((b) => b.id === id)?.name ?? id;

  // Ancestor board ids (root → … → zone), walked back through portals.
  const zone = location.zone;
  const chain: string[] = [zone];
  const seen = new Set<string>([zone]);
  let cur = zone;
  for (;;) {
    const parent = portals.find((p) => p.to === cur)?.from;
    if (!parent || seen.has(parent)) break;
    chain.unshift(parent);
    seen.add(parent);
    cur = parent;
  }

  const crumbs = chain.map(boardName);
  // The room itself, unless the location *is* the board (e.g. a board-level node).
  if (location.name !== crumbs[crumbs.length - 1]) crumbs.push(location.name);
  return crumbs;
}
