/**
 * Helpers for tests that need consort fixtures.
 *
 * After the random-harem-init change, consorts are no longer authored in
 * content/ — they are generated procedurally into state.generatedConsorts at
 * new-game time, and db.characters contains zero consorts. The four legacy
 * story consorts (lu_huaijin, xu_qinghuan, shen_zhibai, wenya) were deleted
 * from production content.
 *
 * Tests that still need those specific authored identities use synthetic
 * test-only fixtures recovered under tests/helpers/legacyConsorts/*.json
 * (NOT restored to production content/). withConsort injects them into
 * state.generatedConsorts so name/standing/presence lookups resolve.
 *
 * This module provides two utilities:
 *   withConsort  – injects a specific consort (db or legacy-test) into the state
 *   firstNonEmpressConsortId – finds any alive non-empress consort across
 *                               both db.characters and state.generatedConsorts
 */
import { toGameTime } from "../../src/engine/calendar/time";
import { consortStandingExtras, memoryEntryId } from "../../src/engine/state/newGame";
import { generateOfficialWorld } from "../../src/engine/officials/worldgen";
import { characterSchema } from "../../src/engine/content/schemas";
import type { CharacterContent } from "../../src/engine/content/schemas";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameState, CharacterStanding, Official } from "../../src/engine/state/types";
import luHuaijinRaw from "./legacyConsorts/lu_huaijin.json";
import xuQinghuanRaw from "./legacyConsorts/xu_qinghuan.json";
import shenZhibaiRaw from "./legacyConsorts/shen_zhibai.json";
import wenyaRaw from "./legacyConsorts/wenya.json";

/**
 * Synthetic, test-only reconstructions of the four story consorts deleted from
 * production content. Parsed through the live characterSchema so any schema
 * drift fails loudly here rather than silently degrading dependent tests.
 * These are NOT in db.characters; withConsort injects them into generatedConsorts.
 */
const LEGACY_TEST_CONSORTS: Record<string, CharacterContent> = Object.fromEntries(
  [luHuaijinRaw, xuQinghuanRaw, shenZhibaiRaw, wenyaRaw].map((raw) => {
    const c = characterSchema.parse(raw);
    return [c.id, c];
  }),
);

/** The synthetic CharacterContent for a deleted story consort (for tests asserting its authored identity). */
export function legacyConsortContent(id: string): CharacterContent {
  const c = LEGACY_TEST_CONSORTS[id];
  if (!c) throw new Error(`legacyConsortContent: no legacy test consort "${id}"`);
  return c;
}

/**
 * Returns a copy of the content DB with the given deleted story consorts re-registered
 * into db.characters. For test-only tooling that derives from db.characters directly
 * (e.g. the eval speaker-profile builder), NOT for gameplay state — production consorts
 * live in state.generatedConsorts. Unknown IDs throw.
 */
export function dbWithLegacyConsorts(db: ContentDB, ...ids: string[]): ContentDB {
  const extra: Record<string, CharacterContent> = {};
  for (const id of ids) extra[id] = legacyConsortContent(id);
  return { ...db, characters: { ...db.characters, ...extra } };
}

/**
 * Palaces that are valid location IDs but NOT in the generated-consort palace pool.
 * Used as eviction targets when a generated consort occupies a story consort's slot.
 */
const EVICTION_PALACES = [
  "cining_gong",
  "kunninggong",
  "fengxiandian",
  "yuqing_gong",
  "zichendian",
  "zuixianlou",
];

/** Builds a memory store from a character's authored initialMemories (mirrors createNewGameState). */
function seedMemoryStore(char: CharacterContent, startTime: ReturnType<typeof toGameTime>) {
  return {
    entries: char.initialMemories.map((draft, index) => ({
      id: memoryEntryId(char.id, index + 1),
      ownerId: char.id,
      kind: draft.kind,
      ...(draft.sourceEventId !== undefined ? { sourceEventId: draft.sourceEventId } : {}),
      subjectIds: [...draft.subjectIds],
      perspective: draft.perspective,
      summary: draft.summary,
      strength: draft.strength,
      retention: draft.retention,
      emotions: { ...draft.emotions },
      triggerTags: [...draft.triggerTags],
      unresolved: draft.unresolved,
      createdAt: startTime,
    })),
    nextSeq: char.initialMemories.length + 1,
  };
}

/** Posts the legacy story consorts' maternal clans claim; never evict an incumbent onto one. */
const LEGACY_AUTHORED_POSTS = new Set(
  Object.values(LEGACY_TEST_CONSORTS)
    .map((c) => c.maternalClan?.postId)
    .filter((p): p is string => p !== undefined),
);

/** First non-commoner post with a free seat (excluding legacy authored posts). null = unseated. */
function findVacantPost(db: ContentDB, officials: Record<string, Official>): string | null {
  const occ: Record<string, number> = {};
  for (const o of Object.values(officials)) {
    if (o.postId && o.status === "active") occ[o.postId] = (occ[o.postId] ?? 0) + 1;
  }
  const posts = Object.values(db.officialPosts)
    .filter((p) => p.gradeOrder > 0 && !LEGACY_AUTHORED_POSTS.has(p.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of posts) if ((occ[p.id] ?? 0) < p.seatCount) return p.id;
  return null;
}

/**
 * The four deleted story consorts each carry a `maternalClan` (familyId + postId).
 * The save-integrity validator (validateOfficialWorld) requires that clan to exist
 * as a real officialFamily with a seated official and a consort→official `mother`
 * kinship edge. Production worldgen builds those from db.characters, but these
 * consorts are no longer authored, so no family/official/edge is generated.
 *
 * We MERGE only this consort's maternal family (official + members + kinship), leaving
 * the rest of the official world (including prior appointments/retirements/kin edits)
 * untouched. The family is generated with `state.rngSeed` (not a hardcoded seed) so it
 * is consistent with the state it is merged into. If an incumbent already holds the
 * family official's post, it is relocated to a vacant post so seatCount is never exceeded.
 * Idempotent: if the family is already present, the state is returned unchanged.
 */
function injectLegacyMaternalFamily(state: GameState, db: ContentDB, char: CharacterContent): GameState {
  const clan = char.maternalClan;
  if (!clan) return state;
  const famId = clan.familyId;
  if (state.officialFamilies[famId]) return state; // already injected

  // Generate a scratch world containing ONLY this consort as authored, seeded by the
  // state's own rngSeed, then extract just this family's slices.
  const miniDb: ContentDB = { ...db, characters: { [char.id]: char } };
  const world = generateOfficialWorld(miniDb, state.rngSeed, toGameTime(state.calendar));

  const famOfficials = Object.fromEntries(
    Object.entries(world.officials).filter(([, o]) => o.familyId === famId),
  );
  const famMembers = Object.fromEntries(
    Object.entries(world.familyMembers).filter(([, m]) => m.familyId === famId),
  );
  const personIds = new Set<string>([char.id, ...Object.keys(famOfficials), ...Object.keys(famMembers)]);
  const famKinship = world.kinship.filter(
    (k) => personIds.has(k.fromPersonId) && personIds.has(k.toPersonId),
  );

  // Relocate incumbents so the family official's post never exceeds seatCount.
  let officials = { ...state.officials };
  for (const newOfficial of Object.values(famOfficials)) {
    const post = newOfficial.postId;
    if (!post) continue;
    const cap = db.officialPosts[post]?.seatCount ?? 1;
    const holders = Object.values(officials).filter((o) => o.postId === post && o.status === "active");
    const overflow = holders.length - (cap - 1); // keep cap-1 incumbents; new official takes one seat
    for (let i = 0; i < overflow; i++) {
      const victim = holders[i]!;
      officials = { ...officials, [victim.id]: { ...victim, postId: findVacantPost(db, officials) } };
    }
  }
  officials = { ...officials, ...famOfficials };

  return {
    ...state,
    officials,
    officialFamilies: { ...state.officialFamilies, [famId]: world.officialFamilies[famId]! },
    familyMembers: { ...state.familyMembers, ...famMembers },
    kinship: [...state.kinship, ...famKinship],
    standing: { ...state.standing, [char.id]: { ...state.standing[char.id]!, birthFamilyId: famId } },
  };
}

/**
 * Removes any living generated empress (rank huanghou) other than `keepId` from every
 * per-character map. New games seed exactly one empress (generated_empress_<seed>);
 * injecting an empress fixture (shen_zhibai) must REPLACE it, not add a second huanghou.
 */
function removeExistingEmpress(state: GameState, keepId: string): GameState {
  const empressId = Object.keys(state.standing).find(
    (id) => id !== keepId && state.standing[id]?.rank === "huanghou" && state.standing[id]?.lifecycle !== "deceased",
  );
  if (!empressId) return state;
  const drop = <T,>(m: Record<string, T>): Record<string, T> => {
    const { [empressId]: _omit, ...rest } = m;
    return rest;
  };
  return {
    ...state,
    standing: drop(state.standing),
    generatedConsorts: drop(state.generatedConsorts),
    memories: drop(state.memories),
    bedchamber: drop(state.bedchamber),
  };
}

/**
 * Returns a new state with the given consort added to state.standing.
 * Uses the character's initialStanding + consortStandingExtras for the standing values.
 *
 * Source resolution:
 * - db.characters[charId] (authored consort, if any survive in content), or
 * - LEGACY_TEST_CONSORTS[charId] (synthetic reconstruction of a deleted story
 *   consort) — in which case the synthetic CharacterContent is also registered
 *   into state.generatedConsorts so downstream name/presence lookups resolve.
 * Unknown IDs still throw, so a typo is never silently masked.
 *
 * Also:
 * - Sets residence from char.defaultLocation when not already in initialStanding.
 * - Evicts any generated consort occupying the same palace slot to avoid restore conflicts.
 */
export function withConsort(
  state: GameState,
  db: ContentDB,
  charId: string,
  overrides?: Partial<CharacterStanding>,
): GameState {
  const fromDb = db.characters[charId];
  const legacy = LEGACY_TEST_CONSORTS[charId];
  const char = fromDb ?? legacy;
  if (!char) throw new Error(`withConsort: character ${charId} not found in db or legacy test consorts`);
  if (char.kind !== "consort") throw new Error(`withConsort: ${charId} is not a consort`);
  if (!char.initialStanding) throw new Error(`withConsort: ${charId} has no initialStanding`);

  const startTime = toGameTime(state.calendar);

  // Derive residence: prefer initialStanding.residence, fall back to char.defaultLocation.
  const inheritedResidence = (char.initialStanding as Partial<CharacterStanding>).residence;
  const derivedResidence = inheritedResidence ?? char.defaultLocation;

  const standing: CharacterStanding = {
    ...(char.initialStanding as CharacterStanding),
    ...consortStandingExtras(char, startTime),
    // Set birthFamilyId from maternalClan so readSlot integrity checks pass.
    ...(char.maternalClan?.familyId ? { birthFamilyId: char.maternalClan.familyId } : {}),
    // Set residence from defaultLocation when not explicitly in initialStanding.
    ...(derivedResidence !== undefined ? { residence: derivedResidence } : {}),
    ...overrides,
  };

  // An empress fixture must replace the generated empress, not create a second huanghou.
  const base = standing.rank === "huanghou" ? removeExistingEmpress(state, charId) : state;

  // Evict any generated consort that occupies the same palace/chamber slot.
  // Generated consorts may have been randomly assigned to the story consort's home palace.
  // We move them to eviction palaces so the story consort's slot is unambiguously free.
  const targetResidence = standing.residence;
  const targetChamber = (standing.chamber ?? "main") as string;

  let patchedStanding = base.standing;
  let patchedGeneratedConsorts = base.generatedConsorts;

  if (targetResidence) {
    let evictionIdx = 0;
    for (const [id, gc] of Object.entries(base.generatedConsorts)) {
      const st = patchedStanding[id];
      if (!st || st.lifecycle === "deceased") continue;

      // getCharacterLocation logic: standing.residence ?? content.defaultLocation
      const gcLocation = st.residence ?? gc.defaultLocation;
      const gcChamber = (st.chamber ?? "main") as string;

      if (gcLocation === targetResidence && gcChamber === targetChamber) {
        const evictTo = EVICTION_PALACES[evictionIdx % EVICTION_PALACES.length]!;
        evictionIdx++;
        patchedStanding = {
          ...patchedStanding,
          [id]: { ...st, residence: evictTo },
        };
        patchedGeneratedConsorts = {
          ...patchedGeneratedConsorts,
          [id]: { ...gc, defaultLocation: evictTo },
        };
      }
    }
  }

  // A legacy-test consort is not in db.characters; register its synthetic
  // CharacterContent into generatedConsorts so name/presence/standing lookups
  // (which fall back to generatedConsorts) resolve it.
  const finalGeneratedConsorts =
    legacy && !fromDb
      ? { ...patchedGeneratedConsorts, [charId]: char }
      : patchedGeneratedConsorts;

  const next: GameState = {
    ...base,
    standing: { ...patchedStanding, [charId]: standing },
    generatedConsorts: finalGeneratedConsorts,
    bedchamber: base.bedchamber[charId]
      ? base.bedchamber
      : { ...base.bedchamber, [charId]: { encounters: [] } },
    // Every consort needs a memory store (createNewGameState seeds one for each);
    // without it, memory-targeting effects (e.g. cold-palace) fail BAD_EFFECT_TARGET.
    // Seed the consort's authored initialMemories (mirrors createNewGameState) so
    // memory-dependent tests see the same entries production would.
    memories: base.memories[charId]
      ? base.memories
      : { ...base.memories, [charId]: seedMemoryStore(char, startTime) },
  };

  // Legacy story consorts carry a maternalClan; merge only their maternal family so the
  // family/official/mother-edge exist and pass save-integrity validation (no world clobber).
  return legacy && !fromDb ? injectLegacyMaternalFamily(next, db, char) : next;
}

/**
 * Finds the first alive non-empress consort ID in state.standing.
 * Checks both db.characters and state.generatedConsorts so generated consorts
 * are included alongside any story consorts that were injected.
 */
export function firstNonEmpressConsortId(db: ContentDB, state: GameState): string {
  const id = Object.keys(state.standing).find((id) => {
    const c = db.characters[id] ?? state.generatedConsorts[id];
    const st = state.standing[id];
    return c?.kind === "consort" && st?.rank !== "huanghou" && st?.lifecycle !== "deceased";
  });
  if (!id) throw new Error("firstNonEmpressConsortId: no non-empress consort in state");
  return id;
}
