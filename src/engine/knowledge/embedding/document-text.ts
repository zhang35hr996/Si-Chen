/**
 * Deterministic embedding text compiler for KnowledgeChunk.
 *
 * Rules:
 *  - Only public lore fields are included (title, sourceType, tags, entityIds,
 *    locationIds, text).
 *  - sourcePath is excluded (provenance, not lore).
 *  - visibility is excluded (not semantic content).
 *  - validFrom / validUntil are excluded (temporal constraints, not lore).
 *  - Array fields are sorted so insertion order cannot affect the hash.
 *  - The output is stable across process restarts and Node versions.
 */
import { createHash } from "node:crypto";
import type { KnowledgeChunk } from "../model";

/**
 * Compiles a KnowledgeChunk into a canonical text string suitable for
 * embedding.  The output is deterministic: identical chunk fields → identical
 * text → identical SHA-256 hash → cache hit.
 */
export function compileKnowledgeEmbeddingText(chunk: KnowledgeChunk): string {
  const lines: string[] = [
    `Title: ${chunk.title}`,
    `Source type: ${chunk.sourceType}`,
  ];

  // Sorted copies to guarantee ordering-independent output.
  const tags = [...chunk.tags].sort();
  const entityIds = [...chunk.entityIds].sort();
  const locationIds = [...chunk.locationIds].sort();

  if (tags.length > 0) lines.push(`Tags: ${tags.join(", ")}`);
  if (entityIds.length > 0) lines.push(`Entities: ${entityIds.join(", ")}`);
  if (locationIds.length > 0) lines.push(`Locations: ${locationIds.join(", ")}`);

  lines.push("Text:");
  lines.push(chunk.text);

  return lines.join("\n");
}

/**
 * Returns the SHA-256 hex digest of the compiled embedding text.
 * Used as the content-addressable cache key alongside modelKey.
 */
export function contentHash(embeddingText: string): string {
  return createHash("sha256").update(embeddingText, "utf8").digest("hex");
}
