/**
 * eval-run — CLI entry point for running dialogue eval scenarios (T6, LLM-2).
 *
 * Usage:
 *   tsx tools/eval-run.ts --provider <anthropic|openai|google|gemini|fixture> [--model <id>]
 *                         [--runs <N>] [--scenarios <path>] [--output <path>]
 *
 * --provider anthropic  → mode=online, needs ANTHROPIC_API_KEY env var
 * --provider openai     → mode=online, needs OPENAI_API_KEY env var
 * --provider google     → mode=online, needs GEMINI_API_KEY env var (alias: --provider gemini)
 * --provider fixture    → mode=fixture, loads evalFixtures from tests/eval/fixtures/builders
 * --model <id>          → required for any online provider, ignored for fixture
 * --runs <N>            → number of runs per scenario (default 1)
 * --scenarios <path>    → path to JSONL file (default tests/eval/golden/scenarios.jsonl)
 * --output <path>       → output JSONL file (default eval-results-<timestamp>.jsonl)
 *
 * Mode is derived from --provider; there is no --mode flag.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  runEvalScenario,
  runEvalScenarioWithProvider,
} from "../src/engine/dialogue/eval/evalRunner";
import type { EvalScenario } from "../src/engine/dialogue/eval/types";
import type { EvalFixtureDefinition } from "../src/engine/dialogue/eval/fixtureProvider";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  provider: "anthropic" | "openai" | "google" | "fixture";
  model?: string;
  runs: number;
  scenarios: string;
  output: string;
} {
  const args = argv.slice(2);

  function flag(name: string): string | undefined {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  }

  let provider = flag("--provider");
  if (provider === "gemini") provider = "google"; // CLI alias → vendor name
  if (provider !== "anthropic" && provider !== "openai" && provider !== "google" && provider !== "fixture") {
    console.error(
      `Error: --provider must be anthropic|openai|google|gemini|fixture, got: ${provider ?? "(missing)"}`,
    );
    process.exit(1);
  }

  const model = flag("--model");
  const runsRaw = flag("--runs");
  const runs = runsRaw !== undefined ? parseInt(runsRaw, 10) : 1;

  if (isNaN(runs) || runs < 1) {
    console.error(`Error: --runs must be a positive integer, got: ${runsRaw}`);
    process.exit(1);
  }

  const scenarios =
    flag("--scenarios") ?? path.join(PROJECT_ROOT, "tests/eval/golden/scenarios.jsonl");
  const output = flag("--output") ?? `eval-results-${Date.now()}.jsonl`;

  return { provider, model, runs, scenarios, output };
}

// ── Load scenarios from JSONL ─────────────────────────────────────────────────

async function loadScenarios(filePath: string): Promise<EvalScenario[]> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: scenarios file not found: ${resolved}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(resolved),
    crlfDelay: Infinity,
  });

  const scenarios: EvalScenario[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      scenarios.push(JSON.parse(trimmed) as EvalScenario);
    } catch {
      console.error(`Error: invalid JSON in scenarios file: ${trimmed.slice(0, 80)}`);
      process.exit(1);
    }
  }

  return scenarios;
}

// ── Fixture provider setup ────────────────────────────────────────────────────

async function loadFixtures(): Promise<Record<string, EvalFixtureDefinition>> {
  const { evalFixtures } = await import(
    path.join(PROJECT_ROOT, "tests/eval/fixtures/builders.ts")
  ) as { evalFixtures: Record<string, EvalFixtureDefinition> };
  return evalFixtures;
}

// ── Online provider setup (anthropic | openai | google) ───────────────────────

function requireKey(env: string, providerName: string): string {
  const v = process.env[env];
  if (!v) {
    console.error(`Error: ${env} environment variable is required for --provider ${providerName}`);
    process.exit(1);
  }
  return v;
}

async function buildOnlineProvider(providerName: "anthropic" | "openai" | "google", model: string) {
  const { createDialogueProvider } = await import(
    path.join(PROJECT_ROOT, "src/engine/dialogue/providers/remoteProvider.ts")
  ) as typeof import("../src/engine/dialogue/providers/remoteProvider");

  if (providerName === "anthropic") {
    const apiKey = requireKey("ANTHROPIC_API_KEY", "anthropic");
    const { createAnthropicSdkTransport } = await import(
      path.join(PROJECT_ROOT, "server/llm/anthropicSdkTransport.ts")
    ) as typeof import("../server/llm/anthropicSdkTransport");
    return createDialogueProvider({ model: { provider: "anthropic", model }, transport: createAnthropicSdkTransport(apiKey) });
  }

  if (providerName === "openai") {
    const apiKey = requireKey("OPENAI_API_KEY", "openai");
    const { createOpenAISdkTransport } = await import(
      path.join(PROJECT_ROOT, "server/llm/openaiSdkTransport.ts")
    ) as typeof import("../server/llm/openaiSdkTransport");
    return createDialogueProvider({ model: { provider: "openai", model }, transport: createOpenAISdkTransport(apiKey) });
  }

  const apiKey = requireKey("GEMINI_API_KEY", "google");
  const { createGeminiSdkTransport } = await import(
    path.join(PROJECT_ROOT, "server/llm/geminiSdkTransport.ts")
  ) as typeof import("../server/llm/geminiSdkTransport");
  return createDialogueProvider({ model: { provider: "google", model }, transport: createGeminiSdkTransport(apiKey) });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const { provider: providerName, model, runs, scenarios: scenariosPath, output } = opts;

  if (providerName !== "fixture" && !model) {
    console.error(`Error: --model is required when --provider is ${providerName}`);
    process.exit(1);
  }

  const scenarios = await loadScenarios(scenariosPath);
  const totalRuns = scenarios.length * runs;

  const evaluationId = `${model ?? "fixture"}-${Date.now()}`;
  const outputPath = path.resolve(output);

  console.log(`Eval run: ${evaluationId}`);
  console.log(`Scenarios: ${scenarios.length}, runs each: ${runs}, total: ${totalRuns}`);
  console.log(`Output: ${outputPath}`);
  console.log("");

  const outputStream = fs.createWriteStream(outputPath, { flags: "w" });

  let fixtures: Record<string, EvalFixtureDefinition> | undefined;
  let onlineProvider: Awaited<ReturnType<typeof buildOnlineProvider>> | undefined;

  if (providerName === "fixture") {
    fixtures = await loadFixtures();
  } else {
    onlineProvider = await buildOnlineProvider(providerName, model!);
  }

  let count = 0;

  for (const scenario of scenarios) {
    for (let runIndex = 0; runIndex < runs; runIndex++) {
      count++;
      const label = `[${count}/${totalRuns}] ${scenario.id} run ${runIndex + 1}/${runs}`;
      process.stdout.write(`${label} ... `);

      const start = Date.now();

      try {
        let result;
        if (providerName === "fixture") {
          const fixture = fixtures![scenario.fixtureId];
          if (!fixture) {
            console.error(`Unknown fixtureId: ${scenario.fixtureId}`);
            process.exit(1);
          }
          result = await runEvalScenario(scenario, fixture, evaluationId, runIndex);
        } else {
          // Online mode: use shared runEvalScenarioWithProvider so expectations
          // are evaluated identically to fixture mode.
          const realProvider = onlineProvider!;
          const { createNewGameState } = await import(
            path.join(PROJECT_ROOT, "src/engine/state/newGame.ts")
          ) as typeof import("../src/engine/state/newGame");
          const { loadRealContent } = await import(
            path.join(PROJECT_ROOT, "tests/helpers/contentFixture.ts")
          ) as typeof import("../tests/helpers/contentFixture");

          const db = loadRealContent();
          const state = createNewGameState(db);

          result = await runEvalScenarioWithProvider(
            scenario,
            db,
            state,
            () => realProvider,
            evaluationId,
            runIndex,
            model!,
            "online",
            providerName,
          );
        }

        const elapsed = Date.now() - start;
        const status = result.gateStatus === "pass" ? "pass" : `fail: ${result.providerError?.kind ?? result.textFindings[0]?.gate ?? "GATE_FAIL"}`;
        console.log(`${status} (${result.durationMs ?? elapsed}ms)`);

        outputStream.write(JSON.stringify(result) + "\n");
      } catch (e) {
        const elapsed = Date.now() - start;
        console.log(`error (${elapsed}ms): ${String(e)}`);
      }
    }
  }

  outputStream.end();
  await new Promise<void>((resolve) => outputStream.on("close", resolve));
  console.log(`\nDone. Results written to: ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
