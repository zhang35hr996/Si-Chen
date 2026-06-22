/**
 * Eval pricing — external, editable price table + a pure cost function.
 *
 * Prices are DATA, not logic: the table lives here and is passed into scoring as
 * a parameter. costForUsage accepts an override table so prices can be updated
 * without touching scorer/report code. Unknown model or missing usage → undefined
 * (rendered "n/a" upstream); never throws, never NaN.
 *
 * Bills on NormalizedUsage: uncachedInputTokens at inputPerMTok, cacheReadTokens
 * at cacheReadPerMTok, cacheCreationTokens at cacheCreationPerMTok, outputTokens
 * at outputPerMTok (cache rates fall back to inputPerMTok when unset).
 */
import type { NormalizedUsage } from "../providerContract";

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheCreationPerMTok?: number;
}
export type PriceTable = Record<string, ModelPricing>;

/** USD per 1M tokens, keyed "<provider>:<model>". Edit here; no code changes needed. */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  "anthropic:claude-haiku-4-5-20251001": { inputPerMTok: 1.0, outputPerMTok: 5.0, cacheReadPerMTok: 0.1 },
  // Add provider:model rows as needed. Unknown keys yield undefined cost (n/a).
};

export function costForUsage(
  key: string,
  usage: NormalizedUsage | undefined,
  table: PriceTable = DEFAULT_PRICE_TABLE,
): number | undefined {
  const p = table[key];
  if (!p || !usage) return undefined;
  const M = 1_000_000;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreate = usage.cacheCreationTokens ?? 0;
  return (
    (usage.uncachedInputTokens * p.inputPerMTok +
      usage.outputTokens * p.outputPerMTok +
      cacheRead * (p.cacheReadPerMTok ?? p.inputPerMTok) +
      cacheCreate * (p.cacheCreationPerMTok ?? p.inputPerMTok)) /
    M
  );
}
