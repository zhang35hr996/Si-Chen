/**
 * Normalization and validation pipeline for KnowledgeChunkInput → KnowledgeChunk.
 *
 * Mirrors the content loader convention: errors are collected into an array,
 * never thrown, so all problems in a batch surface in a single report.
 */
import { compareGameTime } from "../calendar/time";
import { contentError, type GameError } from "../infra/errors";
import { knowledgeChunkInputSchema } from "./schema";
import type { KnowledgeChunk, KnowledgeChunkInput } from "./model";

/** Validate and normalize a single chunk input. Returns null on any error. */
export function normalizeChunk(
  input: KnowledgeChunkInput,
  errors: GameError[],
): KnowledgeChunk | null {
  const before = errors.length;

  // Schema-level validation (sourceType, visibility, non-empty required fields)
  const parsed = knowledgeChunkInputSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    errors.push(
      knowledgeError(
        "SCHEMA",
        `chunk "${input.id || "(no id)"}": ${issues}`,
        input.sourcePath,
      ),
    );
    return null;
  }

  const data = parsed.data;
  const id = data.id.trim();
  const title = data.title.trim();
  const text = data.text.trim();

  if (!id) {
    errors.push(knowledgeError("EMPTY_ID", "chunk has empty id", data.sourcePath));
  }
  if (!title) {
    errors.push(knowledgeError("EMPTY_TITLE", `chunk "${id}": empty title`, data.sourcePath));
  }
  if (!text) {
    errors.push(knowledgeError("EMPTY_TEXT", `chunk "${id}": empty text`, data.sourcePath));
  }

  if (data.validFrom && data.validUntil) {
    if (compareGameTime(data.validFrom, data.validUntil) > 0) {
      errors.push(
        knowledgeError(
          "INVALID_TIME_RANGE",
          `chunk "${id}": validFrom (day ${data.validFrom.dayIndex}) is after validUntil (day ${data.validUntil.dayIndex})`,
          data.sourcePath,
        ),
      );
    }
  }

  if (errors.length > before) return null;

  // Normalize arrays: trim, filter blanks, de-duplicate, sort
  const tags = normalizeStringArray(data.tags);
  const entityIds = normalizeStringArray(data.entityIds);
  const locationIds = normalizeStringArray(data.locationIds);

  const chunk: KnowledgeChunk = {
    id,
    sourceType: data.sourceType,
    title,
    text,
    tags,
    entityIds,
    locationIds,
    visibility: data.visibility,
    sourcePath: data.sourcePath,
  };
  if (data.validFrom) (chunk as { validFrom?: unknown }).validFrom = data.validFrom;
  if (data.validUntil) (chunk as { validUntil?: unknown }).validUntil = data.validUntil;
  return chunk;
}

/**
 * Normalize a batch of inputs.  Detects duplicate IDs across the batch.
 * All errors are pushed into `errors`; only valid chunks are returned.
 * Output order is sorted by chunk ID for determinism.
 */
export function normalizeChunks(
  inputs: KnowledgeChunkInput[],
  errors: GameError[],
): KnowledgeChunk[] {
  const valid: KnowledgeChunk[] = [];
  const seen = new Map<string, string>(); // id → sourcePath

  for (const input of inputs) {
    const chunk = normalizeChunk(input, errors);
    if (!chunk) continue;

    const prev = seen.get(chunk.id);
    if (prev !== undefined) {
      errors.push(
        knowledgeError(
          "DUPLICATE_ID",
          `chunk "${chunk.id}" already defined at "${prev}"`,
          chunk.sourcePath,
        ),
      );
      continue;
    }
    seen.set(chunk.id, chunk.sourcePath);
    valid.push(chunk);
  }

  // Deterministic output order
  valid.sort((a, b) => a.id.localeCompare(b.id));
  return valid;
}

function normalizeStringArray(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0))].sort();
}

function knowledgeError(
  code: string,
  message: string,
  sourcePath: string,
): GameError {
  return contentError(code, `[knowledge] ${sourcePath}: ${message}`);
}
