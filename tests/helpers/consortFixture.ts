/**
 * Helpers for tests that need consort fixtures.
 *
 * After the random-harem-init change, story consorts (lu_huaijin, xu_qinghuan,
 * wenya) are spawnMode="event_only" and do NOT appear in the initial standing.
 * Generated consorts live in state.generatedConsorts, not db.characters.
 *
 * This module provides two utilities:
 *   withConsort  – injects a specific story consort into the state
 *   firstNonEmpressConsortId – finds any alive non-empress consort across
 *                               both db.characters and state.generatedConsorts
 */
import { toGameTime } from "../../src/engine/calendar/time";
import { consortStandingExtras } from "../../src/engine/state/newGame";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameState, CharacterStanding } from "../../src/engine/state/types";

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
 * Returns a new state with the given story consort added to state.standing.
 * Uses the character's initialStanding + consortStandingExtras for the standing values.
 * The character must be in db.characters and must have initialStanding.
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
  const char = db.characters[charId];
  if (!char) throw new Error(`withConsort: character ${charId} not found in db`);
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

  return {
    ...state,
    standing: { ...patchedStanding, [charId]: standing },
    generatedConsorts: patchedGeneratedConsorts,
    bedchamber: state.bedchamber[charId]
      ? state.bedchamber
      : { ...state.bedchamber, [charId]: { encounters: [] } },
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
