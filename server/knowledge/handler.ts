/**
 * Transport-neutral handler for knowledge retrieval requests.
 *
 * Security constraints:
 *   - Request validated against strict Zod schema; unknown fields rejected
 *   - Response sanitized: no sourcePath, no embedding vectors, no stack traces,
 *     no API keys, no absolute file paths
 *   - Errors must be logged (never silently ignored)
 *   - Error text must NOT reach the LLM — error is sanitized before response
 *   - vectorDegradation.reason is passed (machine-readable), message is omitted
 */
import {
  remoteKnowledgeRetrieveRequestSchema,
  type RemoteKnowledgeRetrieveRequest,
  type RemoteKnowledgeRetrieveResponse,
  type RemoteKnowledgeHit,
} from "../../src/engine/knowledge/remote/schemas";
import type { KnowledgeHybridHit, KnowledgeHybridResult } from "../../src/engine/knowledge/retrieval/types";
import type { KnowledgeHybridRetriever } from "../../src/engine/knowledge/retrieval/hybrid-retriever";

export type { RemoteKnowledgeRetrieveRequest };

export interface KnowledgeHandlerDeps {
  readonly retriever: KnowledgeHybridRetriever;
  readonly logger?: {
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
  };
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
): Promise<KnowledgeHandlerResult> {
  // Validate request
  const parsed = remoteKnowledgeRetrieveRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "invalid_request", code: "SCHEMA_VALIDATION_FAILED" },
    };
  }

  const req = parsed.data;

  let result: KnowledgeHybridResult;
  try {
    const q = req.query;
    result = await deps.retriever.retrieve({
      text: q.text,
      limit: q.limit,
      visibilityCeiling: q.visibilityCeiling,
      // GameTime fields are identical between DTO schema and internal type
      currentTime: q.currentTime as import("../../src/engine/calendar/time").GameTime | undefined,
      sourceTypes: q.sourceTypes as import("../../src/engine/knowledge/model").KnowledgeSourceType[] | undefined,
      tagFilter: q.tagFilter as import("../../src/engine/knowledge/model").KnowledgeMetadataFilter | undefined,
      entityFilter: q.entityFilter as import("../../src/engine/knowledge/model").KnowledgeMetadataFilter | undefined,
      locationFilter: q.locationFilter as import("../../src/engine/knowledge/model").KnowledgeMetadataFilter | undefined,
      vectorFailureMode: q.vectorFailureMode ?? "fail",
    });
  } catch (err) {
    // Error must be logged — silent ignore is forbidden
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.error("knowledge retrieval failed", { message });
    // Error text must NOT reach the LLM and must NOT be returned to browser
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
