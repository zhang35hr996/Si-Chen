/**
 * ContentLoader (skeleton-plan §3): Zod-validate every file, then run
 * cross-reference and graph checks over the whole set. Errors are COLLECTED,
 * not first-failed — a content author fixes one CI run, not ten. On success
 * the ContentDB is frozen; it is data, never mutated.
 */
import { contentError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import {
  characterSchema,
  gameEventSchema,
  locationSchema,
  sceneSchema,
  worldLexiconSchema,
  worldSchema,
  type CharacterContent,
  type CharacterRank,
  type EventEffect,
  type GameEventContent,
  type LocationContent,
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
}

export interface ContentDB {
  contentVersion: string;
  world: WorldContent;
  lexicon: WorldLexicon;
  ranks: Record<string, CharacterRank>;
  characters: Record<string, CharacterContent>;
  locations: Record<string, LocationContent>;
  events: Record<string, GameEventContent>;
  scenes: Record<string, SceneContent>;
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

  const ranks: Record<string, CharacterRank> = {};
  if (world) {
    for (const rank of world.ranks) {
      if (ranks[rank.id]) {
        errors.push(dup(raw.world.source, "rank", rank.id));
      }
      ranks[rank.id] = rank;
    }
  }

  // Cross-reference checks only make sense over schema-valid pieces; they run
  // on whatever parsed, so one broken file doesn't hide ref errors in others.
  if (world) checkWorldRefs(world, raw.world.source, locations.byId, errors);
  checkCharacterRefs(characters, ranks, locations.byId, errors);
  checkLocationGraph(locations, errors);
  checkEventRefs(events, scenes.byId, errors);
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
      characters: characters.byId,
      locations: locations.byId,
      events: events.byId,
      scenes: scenes.byId,
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

function checkCharacterRefs(
  characters: Parsed<CharacterContent>,
  ranks: Record<string, CharacterRank>,
  locations: Record<string, LocationContent>,
  errors: GameError[],
): void {
  for (const { value: character, source } of characters.items) {
    const rank = ranks[character.initialStanding.rank];
    if (!rank) {
      errors.push(missingRef(source, "rank", character.initialStanding.rank));
    } else {
      // kind ⇄ domain match (plan §15.3): an official never holds a harem rank.
      const expected = character.kind === "consort" ? "harem" : "official";
      if (rank.domain !== expected) {
        errors.push(
          contentError(
            "BAD_RANK",
            `${source}: ${character.kind} "${character.id}" holds ${rank.domain}-domain rank "${rank.id}"`,
            { context: { file: source, characterId: character.id, rank: rank.id } },
          ),
        );
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
      for (const participant of memory.participants) {
        if (participant !== "player" && !characters.byId[participant]) {
          errors.push(missingRef(source, "character", participant));
        }
      }
    }
  }
}

function checkLocationGraph(locations: Parsed<LocationContent>, errors: GameError[]): void {
  for (const { value: location, source } of locations.items) {
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
      } else if (!target.connections.includes(location.id)) {
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
    case "relationship":
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
  } else if ("relationshipAtLeast" in condition) {
    if (!universe.characters[condition.relationshipAtLeast.char]) {
      errors.push(missingRef(source, "character", condition.relationshipAtLeast.char));
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
