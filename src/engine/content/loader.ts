/**
 * ContentLoader (skeleton-plan §3): Zod-validate every file, then run
 * cross-reference and graph checks over the whole set. Errors are COLLECTED,
 * not first-failed — a content author fixes one CI run, not ten. On success
 * the ContentDB is frozen; it is data, never mutated.
 */
import { contentError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import { resolveEntryMode } from "../events/entryMode";
import {
  characterSchema,
  gameEventSchema,
  itemsFileSchema,
  locationSchema,
  sceneSchema,
  worldLexiconSchema,
  worldSchema,
  type CharacterContent,
  type CharacterRank,
  type EventEffect,
  type GameEventContent,
  type ItemDef,
  type LocationContent,
  type OfficialPost,
  type SceneContent,
  type SceneNode,
  type TriggerCondition,
  type WorldContent,
  type WorldLexicon,
} from "./schemas";

export interface RawFile {
  /** Where the data came from — file path in error reports. */
  source: string;
  data: unknown;
}

export interface RawContent {
  world: RawFile;
  lexicon: RawFile;
  characters: RawFile[];
  locations: RawFile[];
  events: RawFile[];
  scenes: RawFile[];
  items?: RawFile;
}

export interface ContentDB {
  contentVersion: string;
  world: WorldContent;
  lexicon: WorldLexicon;
  ranks: Record<string, CharacterRank>;
  officialPosts: Record<string, OfficialPost>;
  characters: Record<string, CharacterContent>;
  locations: Record<string, LocationContent>;
  events: Record<string, GameEventContent>;
  scenes: Record<string, SceneContent>;
  items: Record<string, ItemDef>;
}

/** Runtime guard for scene execution (plan §10 #7) — exported for PR 8. */
export const MAX_NODE_STEPS = 100;

export function loadContent(raw: RawContent): Result<ContentDB, GameError[]> {
  const errors: GameError[] = [];

  const world = parseFile(worldSchema, raw.world, errors);
  const lexicon = parseFile(worldLexiconSchema, raw.lexicon, errors);
  const characters = parseCollection(characterSchema, raw.characters, errors);
  const locations = parseCollection(locationSchema, raw.locations, errors);
  const events = parseCollection(gameEventSchema, raw.events, errors);
  const scenes = parseCollection(sceneSchema, raw.scenes, errors);

  const items: Record<string, ItemDef> = {};
  if (raw.items) {
    const parsed = parseFile(itemsFileSchema, raw.items, errors);
    if (parsed) {
      for (const def of parsed.items) {
        if (items[def.id]) {
          errors.push(contentError("DUPLICATE_ID", `items.json: duplicate item id "${def.id}"`));
        }
        items[def.id] = def;
      }
    }
  }

  const ranks: Record<string, CharacterRank> = {};
  if (world) {
    for (const rank of world.ranks) {
      if (ranks[rank.id]) {
        errors.push(dup(raw.world.source, "rank", rank.id));
      }
      ranks[rank.id] = rank;
    }
  }

  const officialPosts: Record<string, OfficialPost> = {};
  if (world) {
    for (const post of world.officialPosts) {
      if (officialPosts[post.id]) {
        errors.push(contentError("DUPLICATE_ID", `world.json: duplicate official post id "${post.id}"`));
      }
      officialPosts[post.id] = post;
    }
  }

  // Cross-reference checks only make sense over schema-valid pieces; they run
  // on whatever parsed, so one broken file doesn't hide ref errors in others.
  if (world) checkWorldRefs(world, raw.world.source, locations.byId, errors);
  if (world) checkMapGraph(world, raw.world.source, locations, errors);
  checkCharacterRefs(characters, ranks, locations.byId, officialPosts, errors);
  checkLocationGraph(locations, errors);
  checkEventRefs(events, scenes.byId, errors);
  checkPresentationRefs(events, characters.byId, locations.byId, errors);
  for (const { value, source } of scenes.items) {
    checkSceneGraph(value, source, errors);
    checkSceneRefs(value, source, characters.byId, locations.byId, errors);
  }
  for (const { value, source } of events.items) {
    checkConditionRefs(value.condition, source, {
      characters: characters.byId,
      locations: locations.byId,
      events: events.byId,
      ranks,
    }, errors);
  }
  if (lexicon) checkLexicon(lexicon, raw.lexicon.source, ranks, errors);

  if (errors.length > 0 || !world || !lexicon) {
    return err(errors);
  }
  return ok(
    Object.freeze({
      contentVersion: world.contentVersion,
      world,
      lexicon,
      ranks,
      officialPosts,
      characters: characters.byId,
      locations: locations.byId,
      events: events.byId,
      scenes: scenes.byId,
      items,
    }),
  );
}

// ── schema parsing ────────────────────────────────────────────────────

function parseFile<T>(
  schema: { safeParse: (d: unknown) => { success: boolean; data?: T; error?: unknown } },
  file: RawFile,
  errors: GameError[],
): T | null {
  const result = schema.safeParse(file.data);
  if (!result.success) {
    errors.push(
      contentError("SCHEMA", `${file.source}: ${summarizeZodError(result.error)}`, {
        context: { file: file.source },
      }),
    );
    return null;
  }
  return result.data as T;
}

interface Parsed<T> {
  items: { value: T; source: string }[];
  byId: Record<string, T>;
}

function parseCollection<T extends { id: string }>(
  schema: { safeParse: (d: unknown) => { success: boolean; data?: T; error?: unknown } },
  files: RawFile[],
  errors: GameError[],
): Parsed<T> {
  const items: { value: T; source: string }[] = [];
  const byId: Record<string, T> = {};
  for (const file of files) {
    const value = parseFile(schema, file, errors);
    if (!value) continue;
    if (byId[value.id]) {
      errors.push(dup(file.source, "id", value.id));
      continue;
    }
    byId[value.id] = value;
    items.push({ value, source: file.source });
  }
  return { items, byId };
}

function summarizeZodError(error: unknown): string {
  const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  if (!issues || issues.length === 0) return "invalid";
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

const dup = (source: string, kind: string, id: string): GameError =>
  contentError("DUPLICATE_ID", `${source}: duplicate ${kind} "${id}"`, {
    context: { file: source, id },
  });

const missingRef = (source: string, what: string, id: string): GameError =>
  contentError("MISSING_REF", `${source}: references unknown ${what} "${id}"`, {
    context: { file: source, ref: id },
  });

// ── cross-reference checks ────────────────────────────────────────────

function checkWorldRefs(
  world: WorldContent,
  source: string,
  locations: Record<string, LocationContent>,
  errors: GameError[],
): void {
  if (Object.keys(locations).length > 0 && !locations[world.startingLocation]) {
    errors.push(missingRef(source, "location", world.startingLocation));
  }
}

/**
 * Map-board graph (when world.json declares mapBoards): every location.zone and
 * every portal endpoint must name a declared board; the starting location's
 * board must exist. Skipped entirely for minimal content with no map graph.
 */
function checkMapGraph(
  world: WorldContent,
  source: string,
  locations: Parsed<LocationContent>,
  errors: GameError[],
): void {
  if (!world.mapBoards) return;
  const boards = new Set<string>();
  for (const board of world.mapBoards) {
    if (boards.has(board.id)) {
      errors.push(dup(source, "mapBoard", board.id));
    }
    boards.add(board.id);
  }
  for (const { value: location, source: locSource } of locations.items) {
    if (!boards.has(location.zone)) {
      errors.push(missingRef(locSource, "mapBoard", location.zone));
    }
  }
  for (const portal of world.mapPortals ?? []) {
    if (!boards.has(portal.from)) errors.push(missingRef(source, "mapBoard", portal.from));
    if (!boards.has(portal.to)) errors.push(missingRef(source, "mapBoard", portal.to));
    if (portal.from === portal.to) {
      errors.push(
        contentError("BAD_MAP_GRAPH", `${source}: portal "${portal.name}" links board "${portal.from}" to itself`, {
          context: { file: source },
        }),
      );
    }
  }
  const start = locations.byId[world.startingLocation];
  if (start && !boards.has(start.zone)) {
    errors.push(missingRef(source, "mapBoard", start.zone));
  }
}

function checkCharacterRefs(
  characters: Parsed<CharacterContent>,
  ranks: Record<string, CharacterRank>,
  locations: Record<string, LocationContent>,
  officialPosts: Record<string, OfficialPost>,
  errors: GameError[],
): void {
  // familyId → first-seen {surname, postId}; a family is a stable explicit id, NOT a surname.
  // Different families may share a surname; within one familyId surname + head postId must agree.
  const familyDef = new Map<string, { surname: string; postId: string; source: string }>();

  for (const { value: character, source } of characters.items) {
    if (character.initialStanding) {
      const rank = ranks[character.initialStanding.rank];
      if (!rank) {
        errors.push(missingRef(source, "rank", character.initialStanding.rank));
      } else {
        // kind ⇄ domain match (plan §15.3): an official never holds a harem rank.
        // elders have no initialStanding and are excluded by the outer guard.
        // A stray elder-with-standing is not domain-checked (expected === null).
        const expected = character.kind === "consort" ? "harem" : character.kind === "official" ? "official" : null;
        if (rank && expected !== null && rank.domain !== expected) {
          errors.push(
            contentError(
              "BAD_RANK",
              `${source}: ${character.kind} "${character.id}" holds ${rank.domain}-domain rank "${rank.id}"`,
              { context: { file: source, characterId: character.id, rank: rank.id } },
            ),
          );
        }
      }
    }
    if (Object.keys(locations).length > 0 && !locations[character.defaultLocation]) {
      errors.push(missingRef(source, "location", character.defaultLocation));
    }
    for (const stance of character.stances ?? []) {
      if (!characters.byId[stance.charId]) {
        errors.push(missingRef(source, "character", stance.charId));
      }
    }
    for (const memory of character.initialMemories) {
      for (const subjectId of memory.subjectIds) {
        if (subjectId !== "player" && !characters.byId[subjectId]) {
          errors.push(missingRef(source, "character", subjectId));
        }
      }
    }
    if (character.maternalClan) {
      const { familyId, postId } = character.maternalClan;
      if (!officialPosts[postId]) {
        errors.push(missingRef(source, "officialPost", postId));
      }
      // 母家侍君须有姓（其家族 surname 由此确立）。
      const surname = character.profile.surname;
      if (!surname) {
        errors.push(
          contentError("BAD_REF", `${source}: 带 maternalClan 的侍君必须声明 profile.surname`, {
            context: { file: source, characterId: character.id },
          }),
        );
      } else {
        const prev = familyDef.get(familyId);
        if (prev === undefined) {
          familyDef.set(familyId, { surname, postId, source });
        } else {
          if (prev.surname !== surname) {
            errors.push(
              contentError(
                "BAD_REF",
                `${source}: 家族「${familyId}」surname 冲突（${prev.surname} @ ${prev.source} vs ${surname}）`,
                { context: { file: source, familyId } },
              ),
            );
          }
          if (prev.postId !== postId) {
            errors.push(
              contentError(
                "BAD_REF",
                `${source}: 家族「${familyId}」初始官职冲突（${prev.postId} @ ${prev.source} vs ${postId}）`,
                { context: { file: source, familyId } },
              ),
            );
          }
        }
      }
    }
  }
}

function checkLocationGraph(locations: Parsed<LocationContent>, errors: GameError[]): void {
  for (const { value: location, source } of locations.items) {
    // Free-view nodes (冷宫/朝会) carry no connections; only travel nodes form the graph.
    if (!location.connections) continue;
    for (const connection of location.connections) {
      if (connection === location.id) {
        errors.push(
          contentError("ASYMMETRIC_MAP", `${source}: "${location.id}" connects to itself`, {
            context: { file: source },
          }),
        );
        continue;
      }
      const target = locations.byId[connection];
      if (!target) {
        errors.push(missingRef(source, "location", connection));
      } else if (!target.connections || !target.connections.includes(location.id)) {
        errors.push(
          contentError(
            "ASYMMETRIC_MAP",
            `${source}: "${location.id}" → "${connection}" has no return edge`,
            { context: { file: source } },
          ),
        );
      }
    }
  }
}

function checkEventRefs(
  events: Parsed<GameEventContent>,
  scenes: Record<string, SceneContent>,
  errors: GameError[],
): void {
  for (const { value: event, source } of events.items) {
    if (!scenes[event.sceneId]) {
      errors.push(missingRef(source, "scene", event.sceneId));
    }
  }
}

const intersectSets = (a: Set<string>, b: Set<string>): Set<string> => {
  const out = new Set<string>();
  for (const l of a) if (b.has(l)) out.add(l);
  return out;
};

/**
 * Locations where the condition COULD be satisfied (conservative over-approximation; never under-claims).
 * Used so a presentation-less location_enter event merely *possibly* eligible at a request_audience/
 * exploration host is still flagged — closing the gap that `guaranteedLocations` (intersection-only `any`) left.
 *  - atLocation:x ⇒ {x};
 *  - all[...] ⇒ intersection of children;
 *  - any[...] ⇒ union of children;
 *  - not(c) ⇒ where c could be false (De Morgan; see `falseLocations`);
 *  - flagSet / eventFired / month / … ⇒ universe (location-unconstrained leaf).
 */
function possibleLocations(condition: TriggerCondition, allIds: string[]): Set<string> {
  if ("atLocation" in condition) return new Set<string>([condition.atLocation]);
  if ("all" in condition) {
    let acc = new Set<string>(allIds);
    for (const c of condition.all) acc = intersectSets(acc, possibleLocations(c, allIds));
    return acc;
  }
  if ("any" in condition) {
    const acc = new Set<string>();
    for (const c of condition.any) for (const l of possibleLocations(c, allIds)) acc.add(l);
    return acc;
  }
  if ("not" in condition) return falseLocations(condition.not, allIds);
  return new Set<string>(allIds); // location-unconstrained leaf
}

/** Locations where the condition could be FALSE (for `not`). De Morgan over all/any; complement of atLocation. */
function falseLocations(condition: TriggerCondition, allIds: string[]): Set<string> {
  if ("atLocation" in condition) {
    const s = new Set<string>(allIds);
    s.delete(condition.atLocation); // false at every location except x
    return s;
  }
  if ("all" in condition) {
    // ¬(c₁∧c₂…) = (¬c₁)∨(¬c₂)… ⇒ union of children's false-sets
    const acc = new Set<string>();
    for (const c of condition.all) for (const l of falseLocations(c, allIds)) acc.add(l);
    return acc;
  }
  if ("any" in condition) {
    // ¬(c₁∨c₂…) = (¬c₁)∧(¬c₂)… ⇒ intersection of children's false-sets
    let acc = new Set<string>(allIds);
    for (const c of condition.any) acc = intersectSets(acc, falseLocations(c, allIds));
    return acc;
  }
  if ("not" in condition) return possibleLocations(condition.not, allIds); // ¬¬c = c
  return new Set<string>(allIds); // non-location leaf can be false at any location
}

/**
 * Validate event `presentation` (scene-ui-narrative-refactor §3.5):
 *  - checkpoint compatibility: request_audience/exploration ⇒ location_enter;
 *    scheduled ⇒ court; a court event with presentation ⇒ scheduled (so it can never
 *    be silently unreachable by the router/queue);
 *  - declared refs (audienceCharacterId/hostLocationId/subLocationId) must resolve;
 *  - missing presentation on an event GUARANTEED to run at a request_audience/exploration
 *    host is an error (UI needs candidate/sub-location metadata).
 *  manual has no derivation path → not detectable, intentionally not checked.
 */
function checkPresentationRefs(
  events: Parsed<GameEventContent>,
  characters: Record<string, CharacterContent>,
  locations: Record<string, LocationContent>,
  errors: GameError[],
): void {
  const compat = (source: string, msg: string): void => {
    errors.push(contentError("PRESENTATION", `${source}: ${msg}`));
  };
  for (const { value: event, source } of events.items) {
    const p = event.presentation;
    // ── presentation ↔ checkpoint compatibility ──
    if (p) {
      const ck = event.checkpoint;
      if ((p.mode === "request_audience" || p.mode === "exploration") && ck !== "location_enter") {
        compat(source, `presentation mode "${p.mode}" requires checkpoint "location_enter" (got "${ck}")`);
      }
      if (p.mode === "scheduled" && ck !== "court") {
        compat(source, `presentation mode "scheduled" requires checkpoint "court" (got "${ck}")`);
      }
      if (ck === "court" && p.mode !== "scheduled") {
        compat(source, `court event presentation must be "scheduled" (got "${p.mode}")`);
      }
    }
    // ── reference validation + missing-presentation inference ──
    if (p?.mode === "request_audience") {
      if (!characters[p.audienceCharacterId]) errors.push(missingRef(source, "character", p.audienceCharacterId));
      if (!locations[p.hostLocationId]) errors.push(missingRef(source, "location", p.hostLocationId));
    } else if (p?.mode === "exploration") {
      const host = locations[p.hostLocationId];
      if (!host) {
        errors.push(missingRef(source, "location", p.hostLocationId));
      } else if (!(host.subLocations ?? []).some((s) => s.id === p.subLocationId)) {
        errors.push(
          contentError(
            "PRESENTATION",
            `${source}: exploration presentation references unknown subLocation "${p.subLocationId}" in location "${p.hostLocationId}"`,
            { context: { file: source, ref: p.subLocationId } },
          ),
        );
      }
    } else if (!p && event.checkpoint === "location_enter") {
      // 漏检闭合：不止「必然在场」的 host，凡「可能在场」于 request_audience/exploration host（含 any 含
      // flagSet 分支）的 presentation-less location_enter 事件都须报错——否则它既不自动启动也不入候见队列。
      const possible = possibleLocations(event.condition, Object.keys(locations));
      for (const locId of Object.keys(locations)) {
        if (!possible.has(locId)) continue; // 该 host 必不可能在场 → 跳过
        const mode = resolveEntryMode(event, locations[locId]);
        if (mode === "request_audience" || mode === "exploration") {
          errors.push(
            contentError(
              "PRESENTATION",
              `${source}: location_enter event possibly eligible at "${locId}" derives to ${mode} but declares no presentation`,
              { context: { file: source, id: event.id } },
            ),
          );
          break;
        }
      }
    }
  }
}

function checkSceneRefs(
  scene: SceneContent,
  source: string,
  characters: Record<string, CharacterContent>,
  locations: Record<string, LocationContent>,
  errors: GameError[],
): void {
  if (Object.keys(locations).length > 0 && !locations[scene.locationId]) {
    errors.push(missingRef(source, "location", scene.locationId));
  }
  for (const participant of scene.participants) {
    if (!characters[participant]) {
      errors.push(missingRef(source, "character", participant));
    }
  }
  for (const node of scene.nodes) {
    if (node.type === "line" && !scene.participants.includes(node.speaker)) {
      errors.push(
        contentError(
          "BAD_SCENE_GRAPH",
          `${source}: node "${node.id}" speaker "${node.speaker}" is not a scene participant`,
          { context: { file: source, nodeId: node.id } },
        ),
      );
    }
    if (node.type === "effect") {
      for (const effect of node.effects) {
        for (const charId of effectCharRefs(effect)) {
          if (!characters[charId]) {
            errors.push(missingRef(source, "character", charId));
          }
        }
      }
    }
  }
}

function effectCharRefs(effect: EventEffect): string[] {
  switch (effect.type) {
    case "favor":
    case "memory":
      return [effect.char];
    default:
      return [];
  }
}

function checkSceneGraph(scene: SceneContent, source: string, errors: GameError[]): void {
  const bad = (message: string, nodeId?: string) =>
    errors.push(
      contentError("BAD_SCENE_GRAPH", `${source}: ${message}`, {
        context: { file: source, ...(nodeId ? { nodeId } : {}) },
      }),
    );

  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  if (!nodes.has(scene.startNodeId)) {
    bad(`startNodeId "${scene.startNodeId}" does not exist`);
    return;
  }

  const targetsOf = (node: SceneNode): string[] => {
    switch (node.type) {
      case "line":
        return node.next ? [node.next] : [];
      case "choice":
        return node.choices.map((c) => c.next);
      case "branch":
        return [node.ifTrue, node.ifFalse];
      case "effect":
        return node.next ? [node.next] : [];
    }
  };

  // dangling targets
  for (const node of scene.nodes) {
    for (const target of targetsOf(node)) {
      if (!nodes.has(target)) {
        bad(`node "${node.id}" routes to unknown node "${target}"`, node.id);
      }
    }
  }

  // reachability from start
  const reachable = new Set<string>();
  const queue = [scene.startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    for (const target of targetsOf(node)) {
      if (nodes.has(target)) queue.push(target);
    }
  }
  for (const node of scene.nodes) {
    if (!reachable.has(node.id)) {
      bad(`node "${node.id}" is unreachable from startNodeId`, node.id);
    }
  }

  // at least one reachable terminal (line/effect without next)
  const hasTerminal = scene.nodes.some(
    (node) =>
      reachable.has(node.id) &&
      (node.type === "line" || node.type === "effect") &&
      node.next === undefined,
  );
  if (!hasTerminal) {
    bad("scene has no reachable terminal node (a line/effect without next)");
  }
}

interface RefUniverse {
  characters: Record<string, CharacterContent>;
  locations: Record<string, LocationContent>;
  events: Record<string, GameEventContent>;
  ranks: Record<string, CharacterRank>;
}

function checkConditionRefs(
  condition: TriggerCondition,
  source: string,
  universe: RefUniverse,
  errors: GameError[],
): void {
  if ("all" in condition) {
    for (const c of condition.all) checkConditionRefs(c, source, universe, errors);
  } else if ("any" in condition) {
    for (const c of condition.any) checkConditionRefs(c, source, universe, errors);
  } else if ("not" in condition) {
    checkConditionRefs(condition.not, source, universe, errors);
  } else if ("atLocation" in condition) {
    if (!universe.locations[condition.atLocation]) {
      errors.push(missingRef(source, "location", condition.atLocation));
    }
  } else if ("eventFired" in condition) {
    if (!universe.events[condition.eventFired]) {
      errors.push(missingRef(source, "event", condition.eventFired));
    }
  } else if ("favorAtLeast" in condition) {
    if (!universe.characters[condition.favorAtLeast.char]) {
      errors.push(missingRef(source, "character", condition.favorAtLeast.char));
    }
  } else if ("rankAtLeast" in condition) {
    if (!universe.characters[condition.rankAtLeast.char]) {
      errors.push(missingRef(source, "character", condition.rankAtLeast.char));
    }
    if (!universe.ranks[condition.rankAtLeast.rank]) {
      errors.push(missingRef(source, "rank", condition.rankAtLeast.rank));
    }
  } else if ("hasMemoryTag" in condition) {
    if (!universe.characters[condition.hasMemoryTag.char]) {
      errors.push(missingRef(source, "character", condition.hasMemoryTag.char));
    }
  }
}

function checkLexicon(
  lexicon: WorldLexicon,
  source: string,
  ranks: Record<string, CharacterRank>,
  errors: GameError[],
): void {
  const approved = new Set(lexicon.approvedTerms);
  for (const term of lexicon.forbiddenTerms) {
    if (approved.has(term)) {
      errors.push(
        contentError("LEXICON", `${source}: "${term}" is both approved and forbidden`, {
          context: { file: source, term },
        }),
      );
    }
  }

  const ruled = new Set<string>();
  for (const rule of lexicon.rankAddressRules) {
    ruled.add(rule.rank);
    const rank = ranks[rule.rank];
    if (!rank) {
      errors.push(missingRef(source, "rank", rule.rank));
      continue;
    }
    // The rank table is canonical; the lexicon must agree (plan §4 validation).
    if (JSON.stringify(rule.selfRefs) !== JSON.stringify(rank.selfRefs)) {
      errors.push(
        contentError(
          "LEXICON",
          `${source}: selfRefs for rank "${rule.rank}" disagree with world.json's rank table`,
          { context: { file: source, rank: rule.rank } },
        ),
      );
    }
  }
  for (const id of Object.keys(ranks)) {
    if (!ruled.has(id)) {
      errors.push(
        contentError("LEXICON", `${source}: rank "${id}" has no rankAddressRules entry`, {
          context: { file: source, rank: id },
        }),
      );
    }
  }
}
