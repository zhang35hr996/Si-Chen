/**
 * eval-export — pairs results from two eval runs and produces blind eval TSVs (T6, LLM-2).
 *
 * Usage:
 *   tsx tools/eval-export.ts --input <pathA.jsonl> <pathB.jsonl>
 *                            [--seed <N>] [--output-dir <dir>]
 *
 * Pairs results from two runs by (scenarioId + runIndex).
 * Produces:
 *   blind-samples.tsv  — columns: sampleId, scenarioId, runIndex, sceneDirective,
 *                         candidateA_text, candidateB_text
 *   blind-key.tsv      — columns: sampleId, scenarioId, runIndex,
 *                         candidateA_runId, candidateB_runId, A_model, B_model
 *
 * A/B assignment: for each pair, deterministic shuffle based on seed (default 42).
 * blind-samples.tsv has NO model name in any column.
 * blind-key.tsv has the model name (derived from runId prefix).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { EvalResult } from "../src/engine/dialogue/eval/types";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  inputA: string;
  inputB: string;
  seed: number;
  outputDir: string;
} {
  const args = argv.slice(2);

  function flag(name: string): string | undefined {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  }

  // --input <pathA> <pathB>
  const inputIdx = args.indexOf("--input");
  if (inputIdx === -1 || inputIdx + 2 >= args.length) {
    console.error("Error: --input requires two JSONL file paths");
    process.exit(1);
  }
  const inputA = args[inputIdx + 1]!;
  const inputB = args[inputIdx + 2]!;

  if (inputA.startsWith("--") || inputB.startsWith("--")) {
    console.error("Error: --input requires two JSONL file paths, got flags instead");
    process.exit(1);
  }

  const seedRaw = flag("--seed");
  const seed = seedRaw !== undefined ? parseInt(seedRaw, 10) : 42;
  if (isNaN(seed)) {
    console.error(`Error: --seed must be an integer, got: ${seedRaw}`);
    process.exit(1);
  }

  const outputDir = flag("--output-dir") ?? ".";

  return { inputA, inputB, seed, outputDir };
}

// ── JSONL loader ──────────────────────────────────────────────────────────────

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
      console.error(`Error: invalid JSON on line ${lineNum} of ${filePath}: ${trimmed.slice(0, 80)}`);
      process.exit(1);
    }
  }

  return results;
}

// ── Deterministic shuffle (seeded LCG) ───────────────────────────────────────

/**
 * Minimal seeded PRNG (LCG). Returns value in [0, 1).
 * Used to decide A/B assignment per sample deterministically from the seed.
 * We derive a unique seed per sample by combining the global seed with sampleIndex.
 */
function seededRandom(seed: number, index: number): number {
  // Mix seed and index using LCG parameters (same as glibc)
  let s = (seed * 1664525 + index * 22695477 + 1013904223) >>> 0;
  // One more round
  s = (s * 1664525 + 1013904223) >>> 0;
  return s / 0x100000000;
}

// ── Model name extraction ─────────────────────────────────────────────────────

/**
 * Extract model name from runId. Convention: `${model}-${timestamp}-r${runIndex}`.
 * The runId is `${evaluationId}-r${runIndex}` where evaluationId=`${model}-${Date.now()}`.
 * So model is everything before the last `-<digits>-r<digits>` suffix.
 */
function extractModel(result: EvalResult): string {
  // result.model is directly on the result — use it if available
  if (result.model && result.model !== "fixture") {
    return result.model;
  }
  // Fallback: strip "-r{runIndex}" suffix and "-{timestamp}" suffix from runId
  const runId = result.runId;
  // runId = "<evaluationId>-r<runIndex>" → evaluationId = "<model>-<timestamp>"
  const withoutRunSuffix = runId.replace(/-r\d+$/, "");
  // withoutRunSuffix = "<model>-<timestamp>" → strip trailing "-<digits>"
  const withoutTimestamp = withoutRunSuffix.replace(/-\d+$/, "");
  return withoutTimestamp || result.model;
}

// ── TSV helpers ───────────────────────────────────────────────────────────────

function tsvRow(cells: string[]): string {
  return cells.map((c) => c.replace(/\t/g, " ").replace(/\n/g, " ")).join("\t");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const { inputA, inputB, seed, outputDir } = opts;

  const [resultsA, resultsB] = await Promise.all([
    loadResults(inputA),
    loadResults(inputB),
  ]);

  // Index by (scenarioId, runIndex)
  function makeKey(r: EvalResult): string {
    return `${r.scenarioId}::${r.runIndex}`;
  }

  const mapA = new Map<string, EvalResult>();
  for (const r of resultsA) mapA.set(makeKey(r), r);

  const mapB = new Map<string, EvalResult>();
  for (const r of resultsB) mapB.set(makeKey(r), r);

  // Collect pairs where both A and B have a result
  const pairs: Array<{ key: string; rA: EvalResult; rB: EvalResult }> = [];
  for (const [key, rA] of mapA) {
    const rB = mapB.get(key);
    if (rB) {
      pairs.push({ key, rA, rB });
    }
  }

  // Sort for determinism
  pairs.sort((x, y) => x.key.localeCompare(y.key));

  if (pairs.length === 0) {
    console.error("Error: no matching pairs found (same scenarioId + runIndex required in both files)");
    process.exit(1);
  }

  // Build TSV lines
  const samplesHeader = tsvRow([
    "sampleId",
    "scenarioId",
    "runIndex",
    "sceneDirective",
    "candidateA_text",
    "candidateB_text",
  ]);
  const keyHeader = tsvRow([
    "sampleId",
    "scenarioId",
    "runIndex",
    "candidateA_runId",
    "candidateB_runId",
    "A_model",
    "B_model",
  ]);

  const samplesLines: string[] = [samplesHeader];
  const keyLines: string[] = [keyHeader];

  for (let i = 0; i < pairs.length; i++) {
    const { rA, rB } = pairs[i]!;
    const sampleId = `s${String(i + 1).padStart(4, "0")}`;

    // Deterministic A/B assignment: if rand >= 0.5, swap A and B
    const rng = seededRandom(seed, i);
    const [candA, candB] = rng < 0.5 ? [rA, rB] : [rB, rA];

    const scenarioId = candA.scenarioId;
    const runIndex = String(candA.runIndex);

    const sceneDirective = candA.sceneDirective ?? "";

    const textA = candA.text ?? "";
    const textB = candB.text ?? "";

    samplesLines.push(tsvRow([sampleId, scenarioId, runIndex, sceneDirective, textA, textB]));

    const modelA = extractModel(candA);
    const modelB = extractModel(candB);

    keyLines.push(tsvRow([
      sampleId,
      scenarioId,
      runIndex,
      candA.runId,
      candB.runId,
      modelA,
      modelB,
    ]));
  }

  // Write output files
  const outDir = path.resolve(outputDir);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const samplesPath = path.join(outDir, "blind-samples.tsv");
  const keyPath = path.join(outDir, "blind-key.tsv");

  fs.writeFileSync(samplesPath, samplesLines.join("\n") + "\n", "utf8");
  fs.writeFileSync(keyPath, keyLines.join("\n") + "\n", "utf8");

  console.log(`Paired ${pairs.length} samples from ${resultsA.length} + ${resultsB.length} results`);
  console.log(`blind-samples.tsv → ${samplesPath}`);
  console.log(`blind-key.tsv     → ${keyPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
