/**
 * Multi-model scorecard — pure builder (PR2). One row per model, aggregated from
 * that model's EvalResult[] via scoreResults. JSON (ScorecardRow[]) is canonical;
 * Markdown and TSV are DERIVED from the same rows and are never the source of truth.
 *
 * characterProxyScore / styleProxyScore are null in PR2; PR3 wires the proxy
 * scorers and populates them. Numeric ScoreReport fields that may be undefined
 * (estCostUsd) are normalised to null here so JSON/Markdown/TSV render cleanly.
 */
import { scoreResults } from "./scoring";
import type { PriceTable } from "./pricing";
import type { EvalResult } from "./types";

export interface ScorecardRow {
  provider: string;
  model: string;
  runCount: number;
  schemaPassRate: number;
  gatePassRate: number;
  expectationPassRate: number;
  loreViolationRate: number;
  gateViolationsByType: Record<string, number>;
  characterProxyScore: number | null;
  styleProxyScore: number | null;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estCostUsd: number | null;
}

export interface ModelResultGroup {
  provider: string;
  model: string;
  results: EvalResult[];
}

export function buildScorecard(groups: ModelResultGroup[], opts?: { priceTable?: PriceTable }): ScorecardRow[] {
  return groups.map((g) => {
    const r = scoreResults(g.results, { priceTable: opts?.priceTable });
    return {
      provider: g.provider,
      model: g.model,
      runCount: r.runCount,
      schemaPassRate: r.schemaPassRate,
      gatePassRate: r.gatePassRate,
      expectationPassRate: r.expectationPassRate,
      loreViolationRate: r.loreViolationRate,
      gateViolationsByType: r.gateViolationsByType,
      characterProxyScore: null,
      styleProxyScore: null,
      avgLatencyMs: r.avgLatencyMs,
      p95LatencyMs: r.p95LatencyMs,
      totalInputTokens: r.totalInputTokens,
      totalOutputTokens: r.totalOutputTokens,
      estCostUsd: r.estCostUsd ?? null,
    };
  });
}

// ── Derived renderers (consume ScorecardRow[] only) ───────────────────────────

const COLUMNS: { key: keyof ScorecardRow; label: string }[] = [
  { key: "provider", label: "provider" },
  { key: "model", label: "model" },
  { key: "runCount", label: "runs" },
  { key: "schemaPassRate", label: "schema" },
  { key: "gatePassRate", label: "gate" },
  { key: "expectationPassRate", label: "expect" },
  { key: "loreViolationRate", label: "lore_viol" },
  { key: "characterProxyScore", label: "char_proxy" },
  { key: "styleProxyScore", label: "style_proxy" },
  { key: "avgLatencyMs", label: "avg_ms" },
  { key: "p95LatencyMs", label: "p95_ms" },
  { key: "totalInputTokens", label: "in_tok" },
  { key: "totalOutputTokens", label: "out_tok" },
  { key: "estCostUsd", label: "cost_usd" },
];

function cell(row: ScorecardRow, key: keyof ScorecardRow): string {
  const v = row[key];
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "number") {
    if (key === "estCostUsd") return v.toFixed(4);
    if (key.endsWith("Rate") || key.endsWith("ProxyScore")) return v.toFixed(3);
    if (key.endsWith("Ms")) return Math.round(v).toString();
    return v.toString();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function scorecardToMarkdown(rows: ScorecardRow[]): string {
  const header = `| ${COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${COLUMNS.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${COLUMNS.map((c) => cell(row, c.key)).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

export function scorecardToTsv(rows: ScorecardRow[]): string {
  const header = COLUMNS.map((c) => c.label).join("\t");
  const body = rows.map((row) => COLUMNS.map((c) => cell(row, c.key)).join("\t"));
  return [header, ...body].join("\n");
}
