/**
 * Eval pricing — external, editable price table + a pure cost function.
 *
 * Prices are DATA, not logic: the table lives here and is passed into scoring as
 * a parameter. costForUsage accepts an override table so prices can be updated
 * without touching scorer/report code. Unknown model or missing usage → undefined
 * (rendered "n/a" upstream); never throws, never NaN.
 *
 * Convention: cacheReadTokens are a discounted slice of inputTokens, so plain
 * (uncached) input = inputTokens - cacheReadTokens, billed at inputPerMTok, while
 * the cached slice is billed at cacheReadPerMTok (falling back to inputPerMTok).
 */
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
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number } | undefined,
  table: PriceTable = DEFAULT_PRICE_TABLE,
): number | undefined {
  const p = table[key];
  if (!p || !usage) return undefined;
  const M = 1_000_000;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreate = usage.cacheCreationTokens ?? 0;
  const plainInput = Math.max(0, usage.inputTokens - cacheRead);
  return (
    (plainInput * p.inputPerMTok +
      usage.outputTokens * p.outputPerMTok +
      cacheRead * (p.cacheReadPerMTok ?? p.inputPerMTok) +
      cacheCreate * (p.cacheCreationPerMTok ?? p.inputPerMTok)) /
    M
  );
}
