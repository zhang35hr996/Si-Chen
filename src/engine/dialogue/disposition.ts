/** 长期性格三轴（spec 第 5 类，MVP）。中性基线 50，机器 trait 增量叠加，clamp 0–100。 */
import type { CanonicalReactionTrait } from "../content/schemas";

export interface SocialDisposition {
  statusConsciousness: number; // 门第/位分/礼序敏感度
  compassion: number;          // 同情/宽厚/顾念他人
  discretion: number;          // 克制/谨慎/看场合说话
}
export const DEFAULT_DISPOSITION: SocialDisposition = {
  statusConsciousness: 50, compassion: 50, discretion: 50,
};

type DispositionDelta = Partial<SocialDisposition>;

/**
 * Canonical reaction-trait → three-axis deltas. Keyed by stable enum IDs (NOT
 * display words), so the mapping never drifts with narrative copy. Content is
 * Zod-validated against the enum, so there is no free-text guessing at runtime.
 */
export const REACTION_TRAIT_DELTAS: Record<CanonicalReactionTrait, DispositionDelta> = {
  status_conscious: { statusConsciousness: 25, discretion: 10 },
  compassionate: { compassion: 25 },
  cold: { compassion: -20, discretion: 15 },
  discreet: { discretion: 25 },
  blunt: { discretion: -25 },
  impulsive: { discretion: -30 },
  calculating: { discretion: 20, statusConsciousness: 10 },
  proud: { statusConsciousness: 20, compassion: -5 },
};

const clamp = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * Derive a SocialDisposition from canonical reaction traits. Content has already
 * passed the Zod enum, so unknown traits cannot reach here — there is no runtime
 * free-text tolerance any more.
 */
export function deriveDisposition(traits: readonly CanonicalReactionTrait[]): SocialDisposition {
  const acc = { ...DEFAULT_DISPOSITION };
  for (const trait of traits) {
    const delta = REACTION_TRAIT_DELTAS[trait];
    acc.statusConsciousness += delta.statusConsciousness ?? 0;
    acc.compassion += delta.compassion ?? 0;
    acc.discretion += delta.discretion ?? 0;
  }
  return {
    statusConsciousness: clamp(acc.statusConsciousness),
    compassion: clamp(acc.compassion),
    discretion: clamp(acc.discretion),
  };
}
