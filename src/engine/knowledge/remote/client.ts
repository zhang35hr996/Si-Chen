/**
 * Browser-safe HTTP client adapter implementing KnowledgeRetriever.
 *
 * Security constraints:
 *   - Uses fetch (browser native — no Node-only imports)
 *   - Never logs or surfaces raw error messages from the server to the LLM
 *   - Maps server response to KnowledgeHybridResult without exposing sourcePath
 *   - sourcePath is set to "" in the reconstructed KnowledgeChunk;
 *     the packer in the dialogue pipeline never reads it
 */
import type { KnowledgeRetriever } from "../../dialogue/knowledge/types";
import type { KnowledgeHybridQuery, KnowledgeHybridResult, KnowledgeHybridHit } from "../retrieval/types";
import {
  remoteKnowledgeRetrieveRequestSchema,
  remoteKnowledgeRetrieveResponseSchema,
  type RemoteKnowledgeHit,
} from "./schemas";

export interface RemoteKnowledgeClientOptions {
  /** Base URL of the knowledge API (e.g. "http://localhost:3001"). */
  readonly baseUrl: string;
  /** Abort timeout in milliseconds covering the full request lifecycle. Default 10000. */
  readonly timeoutMs?: number;
}

export class RemoteKnowledgeClient implements KnowledgeRetriever {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: RemoteKnowledgeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async retrieve(query: KnowledgeHybridQuery): Promise<KnowledgeHybridResult> {
    const body = buildRequestBody(query);
    const parsed = remoteKnowledgeRetrieveRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`RemoteKnowledgeClient: invalid request shape: ${parsed.error.message}`);
    }

    // Check if already aborted before allocating resources
    if (query.signal?.aborted) {
      throw new Error("RemoteKnowledgeClient: aborted before start");
    }

    const controller = new AbortController();

    // Forward external abort signal; addEventListener so we can remove it in finally
    let externalAbortListener: (() => void) | undefined;
    if (query.signal) {
      externalAbortListener = () => controller.abort(query.signal?.reason);
      query.signal.addEventListener("abort", externalAbortListener);
    }

    // Timer covers the full lifecycle: fetch + body parsing + schema validation
    const timer = setTimeout(() => controller.abort(new Error("knowledge retrieval timeout")), this.timeoutMs);

    try {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/knowledge/retrieve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
          signal: controller.signal,
        });
      } catch {
        // Never expose raw fetch error — may contain URL, cert details, etc.
        throw new Error("RemoteKnowledgeClient: network error during retrieval");
      }

      if (!res.ok) {
        throw new Error(`RemoteKnowledgeClient: server returned ${res.status}`);
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error("RemoteKnowledgeClient: invalid JSON response");
      }

      const validated = remoteKnowledgeRetrieveResponseSchema.safeParse(json);
      if (!validated.success) {
        throw new Error("RemoteKnowledgeClient: response schema mismatch");
      }

      const data = validated.data;
      const hits: KnowledgeHybridHit[] = data.hits.map(remoteHitToHybridHit);
      return {
        hits,
        vectorDegradation: data.vectorDegradation
          ? { reason: data.vectorDegradation.reason, message: "" }
          : undefined,
      };
    } finally {
      clearTimeout(timer);
      if (externalAbortListener && query.signal) {
        query.signal.removeEventListener("abort", externalAbortListener);
      }
    }
  }
}

function buildRequestBody(query: KnowledgeHybridQuery): unknown {
  const q: Record<string, unknown> = {
    text: query.text,
    limit: query.limit,
  };
  if (query.visibilityCeiling !== undefined) q.visibilityCeiling = query.visibilityCeiling;
  if (query.currentTime !== undefined) q.currentTime = {
    year: query.currentTime.year,
    month: query.currentTime.month,
    period: query.currentTime.period,
    dayIndex: query.currentTime.dayIndex,
  };
  if (query.sourceTypes !== undefined) q.sourceTypes = [...query.sourceTypes];
  if (query.tagFilter !== undefined) q.tagFilter = { values: [...query.tagFilter.values], mode: query.tagFilter.mode };
  if (query.entityFilter !== undefined) q.entityFilter = { values: [...query.entityFilter.values], mode: query.entityFilter.mode };
  if (query.locationFilter !== undefined) q.locationFilter = { values: [...query.locationFilter.values], mode: query.locationFilter.mode };
  // Omit "fail" (server default) to keep wire format small
  if (query.vectorFailureMode !== undefined && query.vectorFailureMode !== "fail") {
    q.vectorFailureMode = query.vectorFailureMode;
  }
  // RRF tuning — only send when caller explicitly overrides defaults
  if (query.rrfK !== undefined) q.rrfK = query.rrfK;
  if (query.keywordWeight !== undefined) q.keywordWeight = query.keywordWeight;
  if (query.vectorWeight !== undefined) q.vectorWeight = query.vectorWeight;
  return { query: q };
}

function remoteHitToHybridHit(hit: RemoteKnowledgeHit): KnowledgeHybridHit {
  return {
    chunk: {
      id: hit.id,
      sourceType: hit.sourceType,
      title: hit.title,
      text: hit.text,
      tags: hit.tags,
      entityIds: hit.entityIds,
      locationIds: hit.locationIds,
      visibility: hit.visibility,
      validFrom: hit.validFrom,
      validUntil: hit.validUntil,
      sourcePath: "",  // never exposed to browser; packer does not read this field
    },
    hybridScore: hit.hybridScore,
    rank: hit.rank,
    keywordRank: hit.keywordRank,
    keywordScore: hit.keywordScore,
    vectorRank: hit.vectorRank,
    cosineScore: hit.cosineScore,
  };
}
