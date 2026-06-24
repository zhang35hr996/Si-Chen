/**
 * Shared request/response DTO schemas for the remote knowledge retrieval API.
 *
 * Browser-safe. No Node-only modules, no SQLite, no filesystem imports.
 *
 * Security constraints enforced by schema design:
 *   - No sourcePath in response (only for server-side debugging)
 *   - No embedding vectors in response
 *   - No API keys or auth headers in DTOs
 *   - Server validates request with .strict() to reject unknown fields
 */
import { z } from "zod";

// ── Request ───────────────────────────────────────────────────────────────────

// Matches GameTime { year, month, period, dayIndex } in engine/calendar/time.ts
const gameTimeSchema = z.object({
  year: z.number().int().positive(),
  month: z.number().int().min(1).max(12),
  period: z.enum(["early", "mid", "late"]),
  dayIndex: z.number().int().nonnegative(),
});

// Matches KnowledgeMetadataFilter { values, mode } in engine/knowledge/model.ts
const knowledgeMetadataFilterSchema = z.object({
  values: z.array(z.string()),
  mode: z.enum(["any", "all"]),
});

// Matches KnowledgeSourceType in engine/knowledge/model.ts
const knowledgeSourceTypeSchema = z.enum([
  "world_rule",
  "etiquette",
  "location",
  "official_system",
  "character_public_profile",
  "historical_archive",
]);

// Matches KnowledgeVisibility in engine/knowledge/model.ts
const knowledgeVisibilitySchema = z.enum(["public", "restricted", "imperial"]);

export const remoteKnowledgeRetrieveRequestSchema = z.object({
  query: z.object({
    text: z.string().min(1).max(2000),
    limit: z.number().int().min(1).max(20),
    visibilityCeiling: knowledgeVisibilitySchema.optional(),
    currentTime: gameTimeSchema.optional(),
    sourceTypes: z.array(knowledgeSourceTypeSchema).optional(),
    tagFilter: knowledgeMetadataFilterSchema.optional(),
    entityFilter: knowledgeMetadataFilterSchema.optional(),
    locationFilter: knowledgeMetadataFilterSchema.optional(),
    vectorFailureMode: z.enum(["fail", "keyword_only"]).optional(),
  }).strict(),
}).strict();

export type RemoteKnowledgeRetrieveRequest = z.infer<typeof remoteKnowledgeRetrieveRequestSchema>;

// ── Response ──────────────────────────────────────────────────────────────────

// Safe hit DTO: chunk fields without sourcePath or embedding vector
export const remoteKnowledgeHitSchema = z.object({
  id: z.string(),
  sourceType: knowledgeSourceTypeSchema,
  title: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  entityIds: z.array(z.string()),
  locationIds: z.array(z.string()),
  visibility: knowledgeVisibilitySchema,
  validFrom: gameTimeSchema.optional(),
  validUntil: gameTimeSchema.optional(),
  // Score fields for client-side packer
  hybridScore: z.number(),
  rank: z.number().int().positive(),
  keywordRank: z.number().int().positive().nullable(),
  keywordScore: z.number().nullable(),
  vectorRank: z.number().int().positive().nullable(),
  cosineScore: z.number().nullable(),
});

export type RemoteKnowledgeHit = z.infer<typeof remoteKnowledgeHitSchema>;

export const remoteKnowledgeRetrieveResponseSchema = z.object({
  hits: z.array(remoteKnowledgeHitSchema),
  vectorDegradation: z.object({
    reason: z.enum(["provider_error", "no_embeddings", "invalid_embedding", "search_error"]),
  }).optional(),
});

export type RemoteKnowledgeRetrieveResponse = z.infer<typeof remoteKnowledgeRetrieveResponseSchema>;

// ── Error response ────────────────────────────────────────────────────────────

// Sanitized error — no stack, no path, no API key
export const remoteKnowledgeErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

export type RemoteKnowledgeErrorResponse = z.infer<typeof remoteKnowledgeErrorResponseSchema>;
