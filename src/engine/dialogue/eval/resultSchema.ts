/**
 * Runtime schema for an EvalResult JSONL record (fix branch). eval-report uses
 * this to validate each line instead of an unchecked `JSON.parse(...) as EvalResult`,
 * so a malformed or stale-format record fails loudly with a path rather than
 * silently producing a misleading scorecard. Non-strict: unknown extra keys are
 * tolerated for forward-compat; the required fields and usage shape are enforced.
 */
import { z } from "zod";

const checkStatus = z.enum(["pass", "fail", "not_run"]);

const normalizedUsageSchema = z.object({
  uncachedInputTokens: z.number(),
  totalInputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheCreationTokens: z.number().optional(),
});

export const evalResultSchema = z.object({
  scenarioId: z.string(),
  runId: z.string(),
  runIndex: z.number(),
  fixtureId: z.string(),
  model: z.string(),
  provider: z.string(),
  speakerId: z.string(),
  mode: z.enum(["fixture", "online"]),
  schemaStatus: checkStatus,
  gateStatus: checkStatus,
  expectationStatus: checkStatus,
  providerError: z.object({ kind: z.string(), cause: z.string().optional() }).optional(),
  claimFindings: z.array(z.object({ code: z.string(), claimId: z.string() })),
  textFindings: z.array(z.object({ gate: z.string(), severity: z.string(), matched: z.string() })),
  expectationFindings: z.array(z.object({ code: z.string(), detail: z.string() })),
  usage: normalizedUsageSchema.optional(),
  requestId: z.string().optional(),
  text: z.string().optional(),
  servedText: z.string().optional(),
  sceneDirective: z.string().optional(),
  durationMs: z.number(),
  knownEventIds: z.array(z.string()).optional(),
});
