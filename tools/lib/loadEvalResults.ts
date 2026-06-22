/**
 * Shared, schema-validated JSONL loader for eval-results files. Used by BOTH
 * eval-report and eval-score so neither can ingest stale/garbled records via an
 * unchecked `JSON.parse(...) as EvalResult` (which would feed undefined usage
 * into scoring and yield NaN/garbage stats).
 *
 * parseEvalResultsText is pure (throws on the first bad line) so it can be unit
 * tested; loadEvalResults wraps it with file I/O and CLI-style exit.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { evalResultSchema } from "../../src/engine/dialogue/eval/resultSchema";
import type { EvalResult } from "../../src/engine/dialogue/eval/types";

/** Parse + validate JSONL text. Throws Error with a line/path-qualified message on the first invalid record. */
export function parseEvalResultsText(text: string, fileLabel = "input"): EvalResult[] {
  const results: EvalResult[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`invalid JSON in ${fileLabel} on line ${i + 1}: ${trimmed.slice(0, 80)}`);
    }
    const check = evalResultSchema.safeParse(parsed);
    if (!check.success) {
      const issue = check.error.issues[0];
      const at = issue?.path.join(".") || "(root)";
      throw new Error(
        `${fileLabel} line ${i + 1} is not a valid EvalResult — ${issue?.message ?? "schema mismatch"} at "${at}". ` +
          `Records written before the usage-accounting fix are incompatible; regenerate with eval:run.`,
      );
    }
    results.push(check.data as EvalResult);
  }
  return results;
}

/** Read + validate a JSONL file. Prints a clear error and exits(1) on any problem. */
export function loadEvalResults(filePath: string): EvalResult[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: file not found: ${resolved}`);
    process.exit(1);
  }
  try {
    return parseEvalResultsText(fs.readFileSync(resolved, "utf8"), filePath);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
