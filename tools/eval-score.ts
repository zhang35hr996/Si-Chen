/**
 * eval-score — reads a JSONL eval-results file and prints a summary (T6, LLM-2).
 *
 * Usage:
 *   tsx tools/eval-score.ts <input.jsonl>
 *
 * Output:
 *   Scenarios:       22 (runs: 1 → 22 results)
 *   Schema pass:     20/22 (91%)
 *   Gate pass:       18/22 (82%)
 *   Expectation:     16/22 (73%)
 *   Avg input tok:   450
 *   Avg out tok:     92
 *   Cache hits:      12/22 (55%)
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import * as path from "node:path";
import { scoreResults } from "../src/engine/dialogue/eval/scoring";
import type { EvalResult } from "../src/engine/dialogue/eval/types";

async function loadResults(filePath: string): Promise<EvalResult[]> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: file not found: ${resolved}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(resolved),
    crlfDelay: Infinity,
  });

  const results: EvalResult[] = [];
  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      results.push(JSON.parse(trimmed) as EvalResult);
    } catch {
      console.error(`Error: invalid JSON on line ${lineNum}: ${trimmed.slice(0, 80)}`);
      process.exit(1);
    }
  }

  return results;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function pad(label: string, width = 17): string {
  return label.padEnd(width);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: tsx tools/eval-score.ts <input.jsonl>");
    process.exit(1);
  }

  const results = await loadResults(inputPath);
  const r = scoreResults(results);

  if (results.length === 0) {
    console.log("No results found in file.");
    return;
  }

  // Compute per-rate numerator counts for display (pass / denominator)
  function countPass(field: "schemaStatus" | "gateStatus" | "expectationStatus"): { pass: number; denom: number } {
    let pass = 0;
    let fail = 0;
    for (const res of results) {
      const s = res[field];
      if (s === "pass") pass++;
      else if (s === "fail") fail++;
    }
    return { pass, denom: pass + fail };
  }

  const schema = countPass("schemaStatus");
  const gate = countPass("gateStatus");
  const exp = countPass("expectationStatus");
  const cacheHits = results.filter((res) => (res.usage?.cacheReadTokens ?? 0) > 0).length;

  // Runs per scenario (use first scenario to infer)
  const scenarioRunCounts: Record<string, number> = {};
  for (const res of results) {
    scenarioRunCounts[res.scenarioId] = (scenarioRunCounts[res.scenarioId] ?? 0) + 1;
  }
  const runsPerScenario = r.scenarioCount > 0
    ? Math.round(r.runCount / r.scenarioCount)
    : 0;

  console.log(`${pad("Scenarios:")}${r.scenarioCount} (runs: ${runsPerScenario} → ${r.runCount} results)`);
  console.log(`${pad("Schema pass:")}${schema.pass}/${schema.denom} (${pct(r.schemaPassRate)})`);
  console.log(`${pad("Gate pass:")}${gate.pass}/${gate.denom} (${pct(r.gatePassRate)})`);
  console.log(`${pad("Expectation:")}${exp.pass}/${exp.denom} (${pct(r.expectationPassRate)})`);
  console.log(`${pad("Avg input tok:")}${Math.round(r.avgInputTokens)}`);
  console.log(`${pad("Avg out tok:")}${Math.round(r.avgOutputTokens)}`);
  console.log(`${pad("Cache hits:")}${cacheHits}/${r.runCount} (${pct(r.cacheHitRate)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
