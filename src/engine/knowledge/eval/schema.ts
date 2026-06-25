/**
 * Schema for deterministic knowledge retrieval evaluation cases.
 *
 * All expected IDs must be stable chunk IDs (using the {#anchor} syntax from PR7A).
 * The eval runner validates that all expected IDs actually exist in the corpus.
 */
import { z } from "zod";

export const evalCategorySchema = z.enum([
  "direct",
  "paraphrase",
  "confusable",
  "visibility",
  "temporal",
  "dynamic-negative",
]);

export type EvalCategory = z.infer<typeof evalCategorySchema>;

export const evalCaseSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20),

  /** Restrict search to these source types. */
  sourceTypes: z.array(z.string()).optional(),
  /** Maximum visibility the caller may see. */
  visibilityCeiling: z.string().optional(),
  /** In-game time for temporal filtering (year/month/period/dayIndex). */
  currentTime: z.object({
    year: z.number(),
    month: z.number(),
    period: z.enum(["early", "mid", "late"]),
    dayIndex: z.number(),
  }).optional(),

  /**
   * At least one of these chunk IDs must appear in the top-`limit` results.
   * Used for "any relevant chunk is fine" assertions.
   */
  expectedAnyOf: z.array(z.string()).optional(),

  /**
   * All of these chunk IDs must appear in the top-`limit` results.
   * Used for assertions where every ID is required.
   */
  expectedAll: z.array(z.string()).optional(),

  /**
   * None of these chunk IDs may appear in any position of the results.
   * Primary gate for confusable and dynamic-negative cases.
   */
  forbiddenIds: z.array(z.string()).optional(),

  /**
   * When true: the result set must be completely empty (zero hits).
   * Used for cases where no static lore should match.
   */
  expectedZeroHits: z.boolean().optional(),

  category: evalCategorySchema,
  /** Human-readable note about what this case is testing. */
  note: z.string().optional(),
});

export type KnowledgeEvalCase = z.infer<typeof evalCaseSchema>;

export function parseEvalCases(jsonlContent: string): KnowledgeEvalCase[] {
  return jsonlContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line, i) => {
      const raw = JSON.parse(line) as unknown;
      const result = evalCaseSchema.safeParse(raw);
      if (!result.success) {
        throw new Error(`cases.jsonl line ${i + 1}: ${result.error.message}`);
      }
      return result.data;
    });
}
