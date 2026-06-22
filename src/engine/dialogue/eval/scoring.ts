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

export interface ScoreReport {
  scenarioCount: number;
  runCount: number;
  schemaPassRate: number;        // pass / (pass+fail) — not_run excluded
  gatePassRate: number;          // same logic
  expectationPassRate: number;   // same logic
  cacheHitRate: number;          // results with cacheReadTokens > 0 / total
  avgInputTokens: number;        // only from results with usage defined
  avgOutputTokens: number;       // only from results with usage defined
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

export function scoreResults(results: EvalResult[]): ScoreReport {
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

  return {
    scenarioCount: scenarioIds.size,
    runCount: results.length,
    schemaPassRate: passRate(results, "schemaStatus"),
    gatePassRate: passRate(results, "gateStatus"),
    expectationPassRate: passRate(results, "expectationStatus"),
    cacheHitRate: results.length === 0 ? 0 : cacheHits / results.length,
    avgInputTokens,
    avgOutputTokens,
  };
}
