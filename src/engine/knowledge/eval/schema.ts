/**
 * Schema for deterministic knowledge retrieval evaluation cases.
 *
 * All expected and forbidden IDs must be stable chunk IDs (using the {#anchor} syntax from PR7A).
 * The eval runner validates that all referenced IDs actually exist in the corpus.
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

const knowledgeSourceTypeSchema = z.enum([
  "world_rule",
  "etiquette",
  "location",
  "official_system",
  "character_public_profile",
  "historical_archive",
]);

const knowledgeVisibilitySchema = z.enum(["public", "restricted", "imperial"]);

export const evalCaseSchema = z
  .object({
    id: z.string().min(1),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20),

    /** Restrict search to these source types. */
    sourceTypes: z.array(knowledgeSourceTypeSchema).optional(),
    /** Maximum visibility the caller may see. */
    visibilityCeiling: knowledgeVisibilitySchema.optional(),
    /** In-game time for temporal filtering (year/month/period/dayIndex). */
    currentTime: z
      .object({
        year: z.number(),
        month: z.number(),
        period: z.enum(["early", "mid", "late"]),
        dayIndex: z.number(),
      })
      .optional(),

    /**
     * At least one of these chunk IDs must appear in the top-`limit` results.
     */
    expectedAnyOf: z.array(z.string()).optional(),

    /**
     * All of these chunk IDs must appear in the top-`limit` results.
     */
    expectedAll: z.array(z.string()).optional(),

    /**
     * None of these chunk IDs may appear in any position of the results.
     */
    forbiddenIds: z.array(z.string()).optional(),

    /**
     * When true: the result set must be completely empty (zero hits).
     */
    expectedZeroHits: z.boolean().optional(),

    category: evalCategorySchema,
    note: z.string().optional(),
  })
  .refine(
    (c) => {
      // A case must have at least one meaningful assertion.
      const hasPositive =
        (c.expectedAnyOf?.length ?? 0) > 0 || (c.expectedAll?.length ?? 0) > 0;
      const hasForbidden = (c.forbiddenIds?.length ?? 0) > 0;
      const hasZero = c.expectedZeroHits === true;
      return hasPositive || hasForbidden || hasZero;
    },
    {
      message:
        "Case must have at least one assertion: expectedAnyOf/expectedAll with items, forbiddenIds with items, or expectedZeroHits: true",
    },
  )
  .refine(
    (c) => {
      // expectedZeroHits: true cannot coexist with positive expectations.
      if (c.expectedZeroHits !== true) return true;
      return (c.expectedAnyOf?.length ?? 0) === 0 && (c.expectedAll?.length ?? 0) === 0;
    },
    {
      message:
        "expectedZeroHits: true cannot coexist with expectedAnyOf or expectedAll",
    },
  )
  .refine(
    (c) => {
      // Expected IDs and forbidden IDs must be disjoint.
      const expected = new Set([...(c.expectedAnyOf ?? []), ...(c.expectedAll ?? [])]);
      const forbidden = c.forbiddenIds ?? [];
      return forbidden.every((id) => !expected.has(id));
    },
    {
      message: "An ID cannot appear in both expected and forbiddenIds",
    },
  );

export type KnowledgeEvalCase = z.infer<typeof evalCaseSchema>;

export function parseEvalCases(jsonlContent: string): KnowledgeEvalCase[] {
  const cases = jsonlContent
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

  // Validate unique case IDs.
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) {
      throw new Error(`cases.jsonl: duplicate case id '${c.id}'`);
    }
    seen.add(c.id);
  }

  return cases;
}
