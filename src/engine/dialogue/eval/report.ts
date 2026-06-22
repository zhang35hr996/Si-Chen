/**
 * Multi-model scorecard — pure builder (PR2). One row per model, aggregated from
 * that model's EvalResult[] via scoreResults. JSON (ScorecardRow[]) is canonical;
 * Markdown and TSV are DERIVED from the same rows and are never the source of truth.
 *
 * characterProxyScore / styleProxyScore are populated when speaker profiles are
 * supplied (else null). Numeric ScoreReport fields that may be undefined
 * (knownCostUsd) are normalised to null here so JSON/Markdown/TSV render cleanly.
 */
import { scoreResults } from "./scoring";
import type { PriceTable } from "./pricing";
import type { EvalResult } from "./types";
import { characterProxyScore, styleProxyScore, type SpeakerProfile } from "./consistencyProxy";

export interface ScorecardRow {
  provider: string;
  model: string;
  runCount: number;
  schemaPassRate: number;
  gatePassRate: number;
  expectationPassRate: number;
  forbiddenLexiconRate: number;
  gateViolationsByType: Record<string, number>;
  characterProxyScore: number | null;
  styleProxyScore: number | null;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  usageRunCount: number;
  costedRunCount: number;
  costCoverageRate: number;
  knownCostUsd: number | null; // sum of KNOWN costs only — read together with costCoverageRate
}

export interface ModelResultGroup {
  provider: string;
  model: string;
  results: EvalResult[];
}

/**
 * A scorecard row labels a whole file by its first record's provider+model, so a
 * file mixing providers/models would silently mislabel. Returns the first record
 * that disagrees with results[0] (with its index), or null when the batch is
 * homogeneous (or empty). The CLI uses this to fail fast.
 */
export function firstHeterogeneousRecord(
  results: EvalResult[],
): { index: number; provider: string; model: string } | null {
  if (results.length === 0) return null;
  const { provider, model } = results[0]!;
  for (let i = 1; i < results.length; i++) {
    const r = results[i]!;
    if (r.provider !== provider || r.model !== model) {
      return { index: i, provider: r.provider, model: r.model };
    }
  }
  return null;
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);

/**
 * Per-model proxy scores: score only records that actually produced text, then
 * group by speakerId, score each speaker that HAS a profile over its own lines,
 * and macro-average across those speakers. Records with no `text` (provider
 * failures etc.) are excluded BEFORE scoring — a model that emitted no dialogue
 * must not earn proxy credit for the absence of mistakes. A speaker with no
 * scorable text is ignored; if no speaker has scorable text + a profile — or no
 * `profiles` map is supplied — the columns stay null.
 */
function proxyScoresFor(
  results: EvalResult[],
  profiles?: Record<string, SpeakerProfile>,
): { character: number | null; style: number | null } {
  if (!profiles) return { character: null, style: null };
  const bySpeaker = new Map<string, EvalResult[]>();
  for (const r of results) {
    if (r.text === undefined) continue; // no generated text → not scorable
    const arr = bySpeaker.get(r.speakerId) ?? [];
    arr.push(r);
    bySpeaker.set(r.speakerId, arr);
  }
  const charScores: number[] = [];
  const styleScores: number[] = [];
  for (const [speakerId, speakerResults] of bySpeaker) {
    const profile = profiles[speakerId];
    if (!profile) continue; // no profile → ignored, not scored
    charScores.push(characterProxyScore(speakerResults, profile).score);
    styleScores.push(styleProxyScore(speakerResults, profile).score);
  }
  return { character: mean(charScores), style: mean(styleScores) };
}

export function buildScorecard(
  groups: ModelResultGroup[],
  opts?: { priceTable?: PriceTable; profiles?: Record<string, SpeakerProfile> },
): ScorecardRow[] {
  return groups.map((g) => {
    const r = scoreResults(g.results, { priceTable: opts?.priceTable });
    const proxy = proxyScoresFor(g.results, opts?.profiles);
    return {
      provider: g.provider,
      model: g.model,
      runCount: r.runCount,
      schemaPassRate: r.schemaPassRate,
      gatePassRate: r.gatePassRate,
      expectationPassRate: r.expectationPassRate,
      forbiddenLexiconRate: r.forbiddenLexiconRate,
      gateViolationsByType: r.gateViolationsByType,
      characterProxyScore: proxy.character,
      styleProxyScore: proxy.style,
      avgLatencyMs: r.avgLatencyMs,
      p95LatencyMs: r.p95LatencyMs,
      totalInputTokens: r.totalInputTokens,
      totalOutputTokens: r.totalOutputTokens,
      usageRunCount: r.usageRunCount,
      costedRunCount: r.costedRunCount,
      costCoverageRate: r.costCoverageRate,
      knownCostUsd: r.knownCostUsd ?? null,
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
  { key: "forbiddenLexiconRate", label: "forbidden_lex" },
  { key: "characterProxyScore", label: "char_proxy" },
  { key: "styleProxyScore", label: "style_proxy" },
  { key: "avgLatencyMs", label: "avg_ms" },
  { key: "p95LatencyMs", label: "p95_ms" },
  { key: "totalInputTokens", label: "in_tok" },
  { key: "totalOutputTokens", label: "out_tok" },
  { key: "costCoverageRate", label: "cost_cov" },
  { key: "knownCostUsd", label: "known_cost" },
];

function cell(row: ScorecardRow, key: keyof ScorecardRow): string {
  const v = row[key];
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "number") {
    if (key === "knownCostUsd") return v.toFixed(4);
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
