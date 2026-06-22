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
  avgInputTokens: number;        // only from results with usage defined
  avgOutputTokens: number;       // only from results with usage defined
  // ── metrics extension (PR2) ──
  avgLatencyMs: number;          // mean durationMs across all results
  p95LatencyMs: number;          // 95th percentile durationMs
  totalInputTokens: number;      // sum of usage.inputTokens
  totalOutputTokens: number;     // sum of usage.outputTokens
  estCostUsd?: number;           // sum of costForUsage; undefined if nothing priced
  loreViolationRate: number;     // share of results with ≥1 forbidden_lexicon finding
  gateViolationsByType: Record<string, number>; // count of all textFindings by gate
}

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
      estCostUsd: undefined,
      loreViolationRate: 0,
      gateViolationsByType: {},
    };
  }

  const scenarioIds = new Set(results.map((r) => r.scenarioId));

  // Cache hit: results where usage.cacheReadTokens > 0
  const cacheHits = results.filter((r) => (r.usage?.cacheReadTokens ?? 0) > 0).length;

  // Avg tokens: only results with usage defined
  const withUsage = results.filter((r) => r.usage !== undefined);
  const avgInputTokens =
    withUsage.length === 0
      ? 0
      : withUsage.reduce((sum, r) => sum + r.usage!.inputTokens, 0) / withUsage.length;
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
    totalInputTokens += r.usage?.inputTokens ?? 0;
    totalOutputTokens += r.usage?.outputTokens ?? 0;
  }

  const loreHits = results.filter((r) => r.textFindings.some((f) => f.gate === "forbidden_lexicon")).length;

  const gateViolationsByType: Record<string, number> = {};
  for (const r of results) {
    for (const f of r.textFindings) {
      gateViolationsByType[f.gate] = (gateViolationsByType[f.gate] ?? 0) + 1;
    }
  }

  const costs = results
    .map((r) => costForUsage(`${r.provider}:${r.model}`, r.usage, opts?.priceTable))
    .filter((c): c is number => c !== undefined);
  const estCostUsd = costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : undefined;

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
    estCostUsd,
    loreViolationRate: loreHits / results.length,
    gateViolationsByType,
  };
}
