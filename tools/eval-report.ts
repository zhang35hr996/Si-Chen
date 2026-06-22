/**
 * eval-report — builds a multi-model scorecard from N eval-results JSONL files
 * (one `eval:run` per model). Canonical output is scorecard.json; scorecard.md
 * and scorecard.tsv are derived from the same rows (PR2).
 *
 * Usage:
 *   tsx tools/eval-report.ts --input a.jsonl b.jsonl c.jsonl [--output-dir <dir>]
 *
 * Each input file's provider/model is read from its first record. Unknown models
 * yield cost "n/a" (see eval/pricing.ts — edit the table there to add prices).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  buildScorecard,
  scorecardToMarkdown,
  scorecardToTsv,
  firstHeterogeneousRecord,
  type ModelResultGroup,
} from "../src/engine/dialogue/eval/report";
import { DEFAULT_PRICE_TABLE } from "../src/engine/dialogue/eval/pricing";
import type { EvalResult } from "../src/engine/dialogue/eval/types";

function parseArgs(argv: string[]): { input: string[]; outputDir: string } {
  const args = argv.slice(2);
  const input: string[] = [];
  const inputIdx = args.indexOf("--input");
  if (inputIdx !== -1) {
    for (let i = inputIdx + 1; i < args.length && !args[i]!.startsWith("--"); i++) {
      input.push(args[i]!);
    }
  }
  if (input.length === 0) {
    console.error("Error: --input requires at least one JSONL file");
    process.exit(1);
  }
  const outIdx = args.indexOf("--output-dir");
  const outputDir = outIdx !== -1 && outIdx + 1 < args.length ? args[outIdx + 1]! : ".";
  return { input, outputDir };
}

async function loadResults(filePath: string): Promise<EvalResult[]> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: file not found: ${resolved}`);
    process.exit(1);
  }
  const rl = readline.createInterface({ input: fs.createReadStream(resolved), crlfDelay: Infinity });
  const results: EvalResult[] = [];
  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      results.push(JSON.parse(trimmed) as EvalResult);
    } catch {
      console.error(`Error: invalid JSON in ${filePath} on line ${lineNum}: ${trimmed.slice(0, 80)}`);
      process.exit(1);
    }
  }
  return results;
}

async function main() {
  const { input, outputDir } = parseArgs(process.argv);

  const groups: ModelResultGroup[] = [];
  for (const file of input) {
    const results = await loadResults(file);
    if (results.length === 0) {
      console.error(`Error: ${file} contains no results`);
      process.exit(1);
    }
    const first = results[0]!;
    const mismatch = firstHeterogeneousRecord(results);
    if (mismatch) {
      console.error(
        `Error: ${file} mixes provider/model — the scorecard labels a file by its first record ` +
          `(${first.provider}:${first.model}), but record #${mismatch.index} is ${mismatch.provider}:${mismatch.model}. ` +
          `Split the runs so each file contains exactly one provider+model.`,
      );
      process.exit(1);
    }
    groups.push({ provider: first.provider, model: first.model, results });
  }

  const rows = buildScorecard(groups, { priceTable: DEFAULT_PRICE_TABLE });

  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  const jsonPath = path.join(outputDir, "scorecard.json");
  const mdPath = path.join(outputDir, "scorecard.md");
  const tsvPath = path.join(outputDir, "scorecard.tsv");

  // JSON is canonical; md/tsv are derived from the same rows.
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2) + "\n");
  fs.writeFileSync(mdPath, scorecardToMarkdown(rows) + "\n");
  fs.writeFileSync(tsvPath, scorecardToTsv(rows) + "\n");

  console.log(`Scorecard written for ${rows.length} model(s):`);
  console.log(`  ${path.resolve(jsonPath)}`);
  console.log(`  ${path.resolve(mdPath)}`);
  console.log(`  ${path.resolve(tsvPath)}`);
  console.log("");
  console.log(scorecardToMarkdown(rows));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
