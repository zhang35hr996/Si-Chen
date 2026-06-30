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
import { consortStandingExtras } from "../../src/engine/state/newGame";
import { characterSchema } from "../../src/engine/content/schemas";
import type { CharacterContent } from "../../src/engine/content/schemas";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameState, CharacterStanding } from "../../src/engine/state/types";
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

  // Evict any generated consort that occupies the same palace/chamber slot.
  // Generated consorts may have been randomly assigned to the story consort's home palace.
  // We move them to eviction palaces so the story consort's slot is unambiguously free.
  const targetResidence = standing.residence;
  const targetChamber = (standing.chamber ?? "main") as string;

  let patchedStanding = state.standing;
  let patchedGeneratedConsorts = state.generatedConsorts;

  if (targetResidence) {
    let evictionIdx = 0;
    for (const [id, gc] of Object.entries(state.generatedConsorts)) {
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

  return {
    ...state,
    standing: { ...patchedStanding, [charId]: standing },
    generatedConsorts: finalGeneratedConsorts,
    bedchamber: state.bedchamber[charId]
      ? state.bedchamber
      : { ...state.bedchamber, [charId]: { encounters: [] } },
    // Every consort needs a memory store (createNewGameState seeds one for each);
    // without it, memory-targeting effects (e.g. cold-palace) fail BAD_EFFECT_TARGET.
    memories: state.memories[charId]
      ? state.memories
      : { ...state.memories, [charId]: { entries: [], nextSeq: 1 } },
  };
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
