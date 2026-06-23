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

export interface LocationJsonSource {
  kind: "location_json";
  data: unknown;
  sourcePath: string;
}

export type KnowledgeSource = MarkdownSource | LocationJsonSource;

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
      // location_json: validate strictly — missing or blank required fields are an error
      const result = locationAdapter.extractStrict(source.data, source.sourcePath);
      if (!result.ok) {
        errors.push(...result.error);
      } else {
        inputs.push(...result.value);
      }
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
