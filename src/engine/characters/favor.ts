import type { CharacterStanding } from "../state/types";

const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

/** Compute updated favor + peakFavor after a delta. peakFavor never decreases. */
export function applyFavorDelta(
  st: CharacterStanding,
  delta: number,
): { favor: number; peakFavor: number } {
  const favor = clampPct(st.favor + delta);
  const peakFavor = Math.max(st.peakFavor, favor);
  return { favor, peakFavor };
}
