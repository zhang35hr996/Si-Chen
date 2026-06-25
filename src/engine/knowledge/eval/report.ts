/**
 * Report generation for knowledge retrieval eval results.
 *
 * Produces:
 *  - JSON report (machine-readable)
 *  - Markdown report (human-readable)
 *
 * Both are written to artifacts/knowledge-eval/ and are gitignored.
 * Only a checked-in baseline fixture (cases.jsonl) is committed.
 */
import type { AggregateMetrics } from "./metrics";

export interface EvalReport {
  timestamp: string;
  mode: "keyword" | "hybrid";
  totalCases: number;
  metrics: AggregateMetrics;
  missingExpectedIds: Array<{ caseId: string; missingId: string }>;
}

export function buildReport(
  mode: "keyword" | "hybrid",
  metrics: AggregateMetrics,
  missingExpectedIds: Array<{ caseId: string; missingId: string }>,
): EvalReport {
  return {
    timestamp: new Date().toISOString(),
    mode,
    totalCases: metrics.totalCases,
    metrics,
    missingExpectedIds,
  };
}

export function renderMarkdownReport(report: EvalReport): string {
  const m = report.metrics;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const lines: string[] = [
    `# Knowledge Eval Report — ${report.mode.toUpperCase()}`,
    ``,
    `**Generated:** ${report.timestamp}`,
    `**Mode:** ${report.mode}`,
    `**Cases:** ${report.totalCases}`,
    ``,
    `## Overall Metrics`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Hit@1 | ${pct(m.hitAt1)} |`,
    `| Hit@3 | ${pct(m.hitAt3)} |`,
    `| Hit@5 | ${pct(m.hitAt5)} |`,
    `| MRR | ${m.mrr.toFixed(3)} |`,
    `| Required misses | ${m.requiredMisses} |`,
    `| Forbidden hits | ${m.forbiddenHitCount} |`,
    `| Unexpected zero hits | ${m.unexpectedZeroHits} |`,
    `| Duplicate hits | ${m.duplicateHits} |`,
    `| Visibility leakage | ${m.visibilityLeakage} |`,
    `| Temporal leakage | ${m.temporalLeakage} |`,
    ``,
    `## By Category`,
    ``,
    `| Category | Cases | Hit@5 | Forbidden hits |`,
    `|----------|-------|-------|----------------|`,
    ...Object.entries(m.byCategory).map(
      ([cat, stats]) =>
        `| ${cat} | ${stats.total} | ${pct(stats.hitAt5)} | ${stats.forbiddenHitCount} |`,
    ),
    ``,
  ];

  if (report.missingExpectedIds.length > 0) {
    lines.push(`## Missing Expected IDs`, ``);
    lines.push(`> These expected IDs do not exist in the corpus — fix cases.jsonl or rebuild.`, ``);
    for (const { caseId, missingId } of report.missingExpectedIds) {
      lines.push(`- Case \`${caseId}\`: \`${missingId}\``);
    }
    lines.push(``);
  }

  if (m.failedCases.length > 0) {
    lines.push(`## Failed Cases`, ``);
    for (const r of m.failedCases) {
      lines.push(`### ${r.caseId} (${r.category})`, ``);
      lines.push(`**Query:** ${r.query}`, ``);
      if (r.expectedAnyOf.length > 0) {
        lines.push(`**Expected any of:** ${r.expectedAnyOf.join(", ")}`);
      }
      if (r.expectedAll.length > 0) {
        lines.push(`**Expected all:** ${r.expectedAll.join(", ")}`);
      }
      if (r.forbiddenIds.length > 0) {
        lines.push(`**Forbidden:** ${r.forbiddenIds.join(", ")}`);
      }
      lines.push(`**Actual top IDs:**`);
      for (const d of r.details.slice(0, 5)) {
        const kwInfo = d.keywordScore !== null ? ` kw_score=${d.keywordScore.toFixed(3)}` : "";
        const vecInfo = d.cosineScore !== null ? ` cosine=${d.cosineScore.toFixed(3)}` : "";
        lines.push(`  ${d.rank}. \`${d.id}\`${kwInfo}${vecInfo}`);
      }
      if (r.forbiddenHits.length > 0) {
        lines.push(`**Forbidden hits:** ${r.forbiddenHits.join(", ")}`);
      }
      lines.push(``);
    }
  } else {
    lines.push(`## Failed Cases`, ``, `_None — all cases passed._`, ``);
  }

  return lines.join("\n");
}
