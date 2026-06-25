/**
 * Transport-neutral handler for knowledge retrieval requests.
 *
 * Security constraints:
 *   - Request validated against strict Zod schema; unknown fields rejected
 *   - Response sanitized: no sourcePath, no embedding vectors, no stack traces,
 *     no API keys, no absolute file paths
 *   - Errors MUST be logged (silent ignore is forbidden) — logger is required
 *   - Raw error.message MUST NOT be logged (may contain API keys, file paths,
 *     SQLite stack traces). Only safe, structured classifications are logged.
 *   - Error text must NOT reach the LLM — error is sanitized before response
 *   - vectorDegradation.reason is passed (machine-readable), message is omitted
 */
import {
  remoteKnowledgeRetrieveRequestSchema,
  type RemoteKnowledgeRetrieveRequest,
  type RemoteKnowledgeRetrieveResponse,
  type RemoteKnowledgeHit,
} from "../../src/engine/knowledge/remote/schemas";
import type { KnowledgeHybridHit, KnowledgeHybridResult, KnowledgeHybridQuery } from "../../src/engine/knowledge/retrieval/types";

export type { RemoteKnowledgeRetrieveRequest };

/** Minimal retrieval service interface — avoids binding to the concrete class. */
export interface KnowledgeRetrievalService {
  retrieve(query: KnowledgeHybridQuery): Promise<KnowledgeHybridResult>;
}

/** Logger that accepts only structured, safe context (no raw error messages). */
export interface KnowledgeHandlerLogger {
  warn(message: string, context?: Record<string, string | number | boolean>): void;
  error(message: string, context?: Record<string, string | number | boolean>): void;
}

export interface KnowledgeHandlerDeps {
  readonly retriever: KnowledgeRetrievalService;
  /** Required — handler must log failures; caller provides a no-op if needed. */
  readonly logger: KnowledgeHandlerLogger;
}

export interface KnowledgeHandlerResult {
  readonly status: number;
  readonly body: RemoteKnowledgeRetrieveResponse | { error: string; code?: string };
}

/**
 * Handle a single knowledge retrieval request.
 *
 * Input is raw parsed JSON from the HTTP body; output is a typed status+body pair
 * that the HTTP adapter (relay.ts) turns into an HTTP response.
 */
export async function handleKnowledgeRetrieve(
  rawInput: unknown,
  deps: KnowledgeHandlerDeps,
  signal?: AbortSignal,
): Promise<KnowledgeHandlerResult> {
  const parsed = remoteKnowledgeRetrieveRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "invalid_request", code: "SCHEMA_VALIDATION_FAILED" },
    };
  }

  const q = parsed.data.query;

  let result: KnowledgeHybridResult;
  try {
    result = await deps.retriever.retrieve({
      text: q.text,
      limit: q.limit,
      visibilityCeiling: q.visibilityCeiling,
      currentTime: q.currentTime as import("../../src/engine/calendar/time").GameTime | undefined,
      sourceTypes: q.sourceTypes as import("../../src/engine/knowledge/model").KnowledgeSourceType[] | undefined,
      tagFilter: q.tagFilter as import("../../src/engine/knowledge/model").KnowledgeMetadataFilter | undefined,
      entityFilter: q.entityFilter as import("../../src/engine/knowledge/model").KnowledgeMetadataFilter | undefined,
      locationFilter: q.locationFilter as import("../../src/engine/knowledge/model").KnowledgeMetadataFilter | undefined,
      vectorFailureMode: q.vectorFailureMode ?? "fail",
      rrfK: q.rrfK,
      keywordWeight: q.keywordWeight,
      vectorWeight: q.vectorWeight,
      signal,
    });
  } catch (err) {
    // Log a safe classification — NEVER log err.message (may contain API keys, paths, stacks).
    deps.logger.error("knowledge retrieval failed", {
      code: "KNOWLEDGE_RETRIEVAL_FAILED",
      errorType: classifyError(err),
    });
    return {
      status: 500,
      body: { error: "retrieval_failed", code: "INTERNAL_ERROR" },
    };
  }

  const hits: RemoteKnowledgeHit[] = result.hits.map(sanitizeHit);

  const responseBody: RemoteKnowledgeRetrieveResponse = {
    hits,
    vectorDegradation: result.vectorDegradation
      ? { reason: result.vectorDegradation.reason }
      : undefined,
  };

  return { status: 200, body: responseBody };
}

/**
 * Classify an error into a safe, non-sensitive type label for logging.
 *
 * Rules: never return any string derived from err.message. SQLite error codes
 * (e.g. "SQLITE_BUSY") are machine-readable enum values, not sensitive data.
 */
function classifyError(err: unknown): string {
  if (!(err instanceof Error)) return "non_error";
  if (err.name === "AbortError") return "aborted";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && /^SQLITE_[A-Z_]+$/.test(code)) return `sqlite:${code}`;
  return "error";
}

/** Strip server-only fields (sourcePath, embedding vectors, etc.) from a hit. */
function sanitizeHit(hit: KnowledgeHybridHit): RemoteKnowledgeHit {
  const { chunk } = hit;
  return {
    id: chunk.id,
    sourceType: chunk.sourceType,
    title: chunk.title,
    text: chunk.text,
    tags: [...chunk.tags],
    entityIds: [...chunk.entityIds],
    locationIds: [...chunk.locationIds],
    visibility: chunk.visibility,
    validFrom: chunk.validFrom,
    validUntil: chunk.validUntil,
    // sourcePath intentionally omitted
    hybridScore: hit.hybridScore,
    rank: hit.rank,
    keywordRank: hit.keywordRank,
    keywordScore: hit.keywordScore,
    vectorRank: hit.vectorRank,
    cosineScore: hit.cosineScore,
  };
}
