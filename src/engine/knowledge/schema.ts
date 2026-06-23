/**
 * Zod schemas for the knowledge RAG system (PR1).
 *
 * These validate KnowledgeChunkInput before normalization.  The Markdown
 * frontmatter schema is defined here so the Markdown parser can reuse it.
 */
import { z } from "zod";
import { gameTimeShape } from "../content/schemas";

export const knowledgeSourceTypeSchema = z.enum([
  "world_rule",
  "etiquette",
  "location",
  "official_system",
  "character_public_profile",
  "historical_archive",
]);

export const knowledgeVisibilitySchema = z.enum([
  "public",
  "restricted",
  "imperial",
]);

/** Validates a raw chunk input (before normalization). */
export const knowledgeChunkInputSchema = z.object({
  id: z.string().min(1),
  sourceType: knowledgeSourceTypeSchema,
  title: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.string()),
  entityIds: z.array(z.string()),
  locationIds: z.array(z.string()),
  validFrom: gameTimeShape.optional(),
  validUntil: gameTimeShape.optional(),
  visibility: knowledgeVisibilitySchema,
  sourcePath: z.string().min(1),
});

/**
 * Frontmatter schema for Markdown lore documents.
 *
 * GameTime fields are flattened (e.g. validFromYear, validFromMonth,
 * validFromPeriod) to keep frontmatter parsing dependency-free.
 *
 * Example:
 * ```yaml
 * ---
 * id: etiquette.confinement
 * sourceType: etiquette
 * title: 禁足期间的宫廷礼制
 * tags:
 *   - etiquette
 *   - punishment
 * entityIds: []
 * locationIds: []
 * visibility: public
 * ---
 * ```
 */
export const knowledgeFrontmatterSchema = z.object({
  id: z.string().min(1),
  sourceType: knowledgeSourceTypeSchema,
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
  entityIds: z.array(z.string()).default([]),
  locationIds: z.array(z.string()).default([]),
  /** Optional: year component of validFrom (all three required together). */
  validFromYear: z.number().int().min(1).optional(),
  validFromMonth: z.number().int().min(1).max(12).optional(),
  validFromPeriod: z.enum(["early", "mid", "late"]).optional(),
  /** Optional: year component of validUntil (all three required together). */
  validUntilYear: z.number().int().min(1).optional(),
  validUntilMonth: z.number().int().min(1).max(12).optional(),
  validUntilPeriod: z.enum(["early", "mid", "late"]).optional(),
  visibility: knowledgeVisibilitySchema,
});

export type KnowledgeFrontmatter = z.infer<typeof knowledgeFrontmatterSchema>;
