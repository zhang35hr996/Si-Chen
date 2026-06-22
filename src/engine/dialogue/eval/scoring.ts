/**
 * Eval scoring — pure functions, safe for vitest CI (T6, LLM-2).
 *
 * scoreResults aggregates a batch of EvalResult records into summary metrics.
 * No I/O, no file reads, no side effects.
 *
 * Rate denominator logic: pass / (pass + fail) — "not_run" is excluded from
 * the denominator. Division by zero returns 0.
 *
 * cacheHitRate: proportion of results where usage.cacheReadTokens > 0.
 * avgInputTokens / avgOutputTokens: averaged only over results that have usage.
 */
import type { EvalResult } from "./types";
import type { CheckStatus } from "./types";
import { costForUsage, type PriceTable } from "./pricing";

export interface ScoreReport {
  scenarioCount: number;
  runCount: number;
  schemaPassRate: number;        // pass / (pass+fail) — not_run excluded
  gatePassRate: number;          // same logic
  expectationPassRate: number;   // same logic
  cacheHitRate: number;          // results with cacheReadTokens > 0 / total
  avgInputTokens: number;        // mean usage.totalInputTokens over results with usage
  avgOutputTokens: number;       // mean usage.outputTokens over results with usage
  // ── metrics extension (PR2) ──
  avgLatencyMs: number;          // mean durationMs across all results
  p95LatencyMs: number;          // 95th percentile durationMs
  totalInputTokens: number;      // sum of usage.totalInputTokens (full prompt size, normalized)
  totalOutputTokens: number;     // sum of usage.outputTokens
  forbiddenLexiconRate: number;  // share of results with ≥1 forbidden_lexicon finding
  gateViolationsByType: Record<string, number>; // count of all textFindings by gate
  // ── cost coverage (fix branch) ──
  usageRunCount: number;         // results carrying usage
  costedRunCount: number;        // results that produced a known cost (usage present AND model priced)
  costCoverageRate: number;      // costedRunCount / runCount — 1 means complete
  knownCostUsd?: number;         // sum of KNOWN costs only; undefined if none costed. NOT a guaranteed total.
}

/** The gate id whose findings count as forbidden-lexicon (lore) violations. */
export const FORBIDDEN_LEXICON_GATE = "forbidden_lexicon";

function passRate(results: EvalResult[], field: keyof Pick<EvalResult, "schemaStatus" | "gateStatus" | "expectationStatus">): number {
  let pass = 0;
  let fail = 0;
  for (const r of results) {
    const status: CheckStatus = r[field];
    if (status === "pass") pass++;
    else if (status === "fail") fail++;
    // "not_run" excluded from denominator
  }
  const denom = pass + fail;
  return denom === 0 ? 0 : pass / denom;
}

export function scoreResults(results: EvalResult[], opts?: { priceTable?: PriceTable }): ScoreReport {
  if (results.length === 0) {
    return {
      scenarioCount: 0,
      runCount: 0,
      schemaPassRate: 0,
      gatePassRate: 0,
      expectationPassRate: 0,
      cacheHitRate: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      forbiddenLexiconRate: 0,
      gateViolationsByType: {},
      usageRunCount: 0,
      costedRunCount: 0,
      costCoverageRate: 0,
      knownCostUsd: undefined,
    };
  }

  const scenarioIds = new Set(results.map((r) => r.scenarioId));

  // Cache hit: results where usage.cacheReadTokens > 0
  const cacheHits = results.filter((r) => (r.usage?.cacheReadTokens ?? 0) > 0).length;

  // Avg tokens: only results with usage defined; input uses normalized total.
  const withUsage = results.filter((r) => r.usage !== undefined);
  const avgInputTokens =
    withUsage.length === 0
      ? 0
      : withUsage.reduce((sum, r) => sum + r.usage!.totalInputTokens, 0) / withUsage.length;
  const avgOutputTokens =
    withUsage.length === 0
      ? 0
      : withUsage.reduce((sum, r) => sum + r.usage!.outputTokens, 0) / withUsage.length;

  // ── metrics extension (PR2) ──
  const latencies = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.reduce((sum, x) => sum + x, 0) / latencies.length;
  const p95LatencyMs = latencies[Math.min(latencies.length - 1, Math.ceil(0.95 * latencies.length) - 1)]!;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const r of results) {
    totalInputTokens += r.usage?.totalInputTokens ?? 0;
    totalOutputTokens += r.usage?.outputTokens ?? 0;
  }

  const loreHits = results.filter((r) => r.textFindings.some((f) => f.gate === FORBIDDEN_LEXICON_GATE)).length;

  const gateViolationsByType: Record<string, number> = {};
  for (const r of results) {
    for (const f of r.textFindings) {
      gateViolationsByType[f.gate] = (gateViolationsByType[f.gate] ?? 0) + 1;
    }
  }

  // Cost coverage: a run is "costed" only if it has usage AND its model is priced.
  // knownCostUsd sums ONLY costed runs and must not be presented as a guaranteed total.
  const usageRunCount = withUsage.length;
  const costs = results
    .map((r) => costForUsage(`${r.provider}:${r.model}`, r.usage, opts?.priceTable))
    .filter((c): c is number => c !== undefined);
  const costedRunCount = costs.length;
  const knownCostUsd = costedRunCount > 0 ? costs.reduce((sum, c) => sum + c, 0) : undefined;
  const costCoverageRate = costedRunCount / results.length;

  return {
    scenarioCount: scenarioIds.size,
    runCount: results.length,
    schemaPassRate: passRate(results, "schemaStatus"),
    gatePassRate: passRate(results, "gateStatus"),
    expectationPassRate: passRate(results, "expectationStatus"),
    cacheHitRate: results.length === 0 ? 0 : cacheHits / results.length,
    avgInputTokens,
    avgOutputTokens,
    avgLatencyMs,
    p95LatencyMs,
    totalInputTokens,
    totalOutputTokens,
    forbiddenLexiconRate: loreHits / results.length,
    gateViolationsByType,
    usageRunCount,
    costedRunCount,
    costCoverageRate,
    knownCostUsd,
  };
}
