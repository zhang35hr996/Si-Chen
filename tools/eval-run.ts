/**
 * eval-run — CLI entry point for running dialogue eval scenarios (T6, LLM-2).
 *
 * Usage:
 *   tsx tools/eval-run.ts --provider <anthropic|fixture> [--model <id>]
 *                         [--runs <N>] [--scenarios <path>] [--output <path>]
 *
 * --provider anthropic  → mode=online, needs ANTHROPIC_API_KEY env var
 * --provider fixture    → mode=fixture, loads evalFixtures from tests/eval/fixtures/builders
 * --model <id>          → required when provider=anthropic, ignored for fixture
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
import { runEvalScenario } from "../src/engine/dialogue/eval/evalRunner";
import type { EvalScenario } from "../src/engine/dialogue/eval/types";
import type { EvalFixtureDefinition } from "../src/engine/dialogue/eval/fixtureProvider";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  provider: "anthropic" | "fixture";
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

  const provider = flag("--provider");
  if (provider !== "anthropic" && provider !== "fixture") {
    console.error(`Error: --provider must be "anthropic" or "fixture", got: ${provider ?? "(missing)"}`);
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

// ── Anthropic provider setup ──────────────────────────────────────────────────

async function buildAnthropicProvider(model: string) {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required for --provider anthropic");
    process.exit(1);
  }

  const { createDialogueProvider } = await import(
    path.join(PROJECT_ROOT, "src/engine/dialogue/providers/remoteProvider.ts")
  ) as typeof import("../src/engine/dialogue/providers/remoteProvider");

  const { createSdkAnthropicTransport } = await import(
    path.join(PROJECT_ROOT, "server/llm/anthropicSdkTransport.ts")
  ) as { createSdkAnthropicTransport: (apiKey: string) => import("../src/engine/dialogue/providers/anthropicProvider").AnthropicTransport };

  const transport = createSdkAnthropicTransport(apiKey);
  const provider = createDialogueProvider({ model: { provider: "anthropic", model }, transport });
  return provider;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const { provider: providerName, model, runs, scenarios: scenariosPath, output } = opts;

  if (providerName === "anthropic" && !model) {
    console.error("Error: --model is required when --provider is anthropic");
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
  let anthropicProvider: Awaited<ReturnType<typeof buildAnthropicProvider>> | undefined;

  if (providerName === "fixture") {
    fixtures = await loadFixtures();
  } else {
    anthropicProvider = await buildAnthropicProvider(model!);
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
          // Anthropic online mode: build a fixture-shaped wrapper around the real provider
          const realProvider = anthropicProvider!;
          const { assembleDialogueRequest, buildDialoguePolicyContext } = await import(
            path.join(PROJECT_ROOT, "src/engine/dialogue/orchestrator.ts")
          ) as typeof import("../src/engine/dialogue/orchestrator");
          const { createNewGameState } = await import(
            path.join(PROJECT_ROOT, "src/engine/state/newGame.ts")
          ) as typeof import("../src/engine/state/newGame");
          const { loadRealContent } = await import(
            path.join(PROJECT_ROOT, "tests/helpers/contentFixture.ts")
          ) as typeof import("../tests/helpers/contentFixture");
          const { validateDialogueProviderResult } = await import(
            path.join(PROJECT_ROOT, "src/engine/dialogue/orchestrator.ts")
          ) as typeof import("../src/engine/dialogue/orchestrator");

          const db = loadRealContent();
          const state = createNewGameState(db);

          const requestResult = assembleDialogueRequest(db, state, scenario.speakerId, scenario.locationId, {
            targetId: scenario.targetId,
            sceneDirective: scenario.sceneDirective,
            transcript: scenario.transcript,
          });

          if (!requestResult.ok) {
            console.log(`fail: assembly_failed (${Date.now() - start}ms)`);
            const partialResult = {
              scenarioId: scenario.id,
              runId: `${evaluationId}-r${runIndex}`,
              runIndex,
              fixtureId: scenario.fixtureId,
              model: model!,
              mode: "online" as const,
              sceneDirective: scenario.sceneDirective,
              schemaStatus: "not_run" as const,
              gateStatus: "not_run" as const,
              // expectations not evaluated in online mode (LLM-2): requires fixture-controlled responses
              expectationStatus: "not_run" as const,
              claimFindings: [],
              textFindings: [],
              expectationFindings: [],
              durationMs: Date.now() - start,
            };
            outputStream.write(JSON.stringify(partialResult) + "\n");
            continue;
          }

          const request = requestResult.value;
          const policy = buildDialoguePolicyContext(db, state, request);

          const runStart = Date.now();
          const raw = await realProvider.generate(request);
          const durationMs = Date.now() - runStart;

          if (!raw.ok) {
            console.log(`fail: ${raw.error.kind} (${durationMs}ms)`);
            const errorResult = {
              scenarioId: scenario.id,
              runId: `${evaluationId}-r${runIndex}`,
              runIndex,
              fixtureId: scenario.fixtureId,
              model: model!,
              mode: "online" as const,
              sceneDirective: scenario.sceneDirective,
              schemaStatus: "not_run" as const,
              gateStatus: "not_run" as const,
              // expectations not evaluated in online mode (LLM-2): requires fixture-controlled responses
              expectationStatus: "not_run" as const,
              claimFindings: [],
              textFindings: [],
              expectationFindings: [],
              providerError: { kind: raw.error.kind },
              durationMs,
            };
            outputStream.write(JSON.stringify(errorResult) + "\n");
            continue;
          }

          const outcome = validateDialogueProviderResult(db, realProvider, request, policy, raw.value);
          const generatedText = raw.value.text;
          const usage = raw.value.usage;
          const requestId = raw.value.providerMeta?.requestId;

          const claimFindings = outcome.diagnostics.claimFindings.map((f) => ({
            code: f.code,
            claimId: f.claimId,
          }));
          const textFindings = outcome.diagnostics.textFindings.map((f) => ({
            gate: f.gate,
            severity: f.severity,
            matched: f.matched,
          }));

          const gateStatus = outcome.ok ? "pass" as const : "fail" as const;
          const servedText = outcome.ok ? outcome.line.text : undefined;

          result = {
            scenarioId: scenario.id,
            runId: `${evaluationId}-r${runIndex}`,
            runIndex,
            fixtureId: scenario.fixtureId,
            model: model!,
            mode: "online" as const,
            sceneDirective: scenario.sceneDirective,
            schemaStatus: "pass" as const,
            gateStatus,
            claimFindings,
            textFindings,
            text: generatedText,
            ...(servedText !== undefined ? { servedText } : {}),
            ...(usage !== undefined ? {
              usage: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
              },
            } : {}),
            ...(requestId !== undefined ? { requestId } : {}),
            // expectations not evaluated in online mode (LLM-2): requires fixture-controlled responses
            expectationStatus: "not_run" as const,
            expectationFindings: [],
            durationMs,
          };
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
