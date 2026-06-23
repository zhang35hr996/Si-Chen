/**
 * Knowledge ingestion pipeline.
 *
 * Orchestrates source discovery → parse → normalize → deduplicate.
 * Returns a deterministic, sorted KnowledgeChunk[] or a collected error list.
 */
import { type GameError } from "../../infra/errors";
import { err, ok, type Result } from "../../infra/result";
import { normalizeChunks } from "../normalize";
import { parseMarkdownLore } from "./markdown";
import { locationAdapter } from "./location-adapter";
import type { KnowledgeChunk, KnowledgeChunkInput } from "../model";

export interface MarkdownSource {
  kind: "markdown";
  content: string;
  sourcePath: string;
}

export interface JsonSource {
  kind: "json";
  data: unknown;
  sourcePath: string;
}

export type KnowledgeSource = MarkdownSource | JsonSource;

/**
 * Ingest a set of sources into a normalized, deduplicated KnowledgeChunk[].
 *
 * Processing order within the batch is deterministic: sources are processed
 * in the supplied order, and the final chunk list is sorted by ID.
 */
export function ingestSources(
  sources: KnowledgeSource[],
  errors: GameError[],
): KnowledgeChunk[] {
  const inputs: KnowledgeChunkInput[] = [];

  for (const source of sources) {
    if (source.kind === "markdown") {
      const result = parseMarkdownLore(source.content, source.sourcePath);
      if (result.ok) {
        inputs.push(...result.value);
      } else {
        errors.push(...result.error);
      }
    } else {
      // JSON: try registered adapters in stable order
      if (locationAdapter.canHandle(source.data, source.sourcePath)) {
        inputs.push(...locationAdapter.extract(source.data, source.sourcePath));
      }
      // Unknown JSON types are silently skipped (no recursive scanning)
    }
  }

  return normalizeChunks(inputs, errors);
}

/**
 * Ingest and return a Result.  Convenience wrapper when callers want a
 * hard failure on any error.
 */
export function ingestSourcesStrict(
  sources: KnowledgeSource[],
): Result<KnowledgeChunk[], GameError[]> {
  const errors: GameError[] = [];
  const chunks = ingestSources(sources, errors);
  if (errors.length > 0) return err(errors);
  return ok(chunks);
}
