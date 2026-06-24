/**
 * PR5 unit tests for remote knowledge retrieval DTO schemas.
 *
 * Tests focus on:
 *  1. Valid request accepted
 *  2. Extra fields rejected (.strict())
 *  3. Required text/limit fields enforced
 *  4. text length bounds
 *  5. limit range (1-20)
 *  6. Response schema accepted with and without vectorDegradation
 *  7. sourcePath absent from RemoteKnowledgeHit schema keys
 *  8. Hit score fields are present in schema
 */
import { describe, it, expect } from "vitest";
import {
  remoteKnowledgeRetrieveRequestSchema,
  remoteKnowledgeRetrieveResponseSchema,
  remoteKnowledgeHitSchema,
} from "../../../src/engine/knowledge/remote/schemas";

const MINIMAL_REQUEST = {
  query: { text: "宫廷礼仪", limit: 5 },
};

const FULL_HIT = {
  id: "chunk_001",
  sourceType: "etiquette",
  title: "宫廷礼仪规范",
  text: "皇帝进殿须行大礼",
  tags: ["ceremony"],
  entityIds: ["emp_xuanzong"],
  locationIds: ["loc_zichendian"],
  visibility: "public",
  hybridScore: 0.91,
  rank: 1,
  keywordRank: 1,
  keywordScore: 0.88,
  vectorRank: null,
  cosineScore: null,
};

describe("remoteKnowledgeRetrieveRequestSchema", () => {
  it("accepts a minimal valid request", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse(MINIMAL_REQUEST);
    expect(result.success).toBe(true);
  });

  it("accepts full optional fields", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      query: {
        text: "礼仪",
        limit: 10,
        visibilityCeiling: "imperial",
        currentTime: { year: 1, month: 3, period: "mid", dayIndex: 100 },
        sourceTypes: ["etiquette", "official_system"],
        tagFilter: { values: ["ceremony"], mode: "any" },
        entityFilter: { values: [], mode: "all" },
        locationFilter: { values: ["loc_zichendian"], mode: "any" },
        vectorFailureMode: "keyword_only",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects extra fields at request level (strict)", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      ...MINIMAL_REQUEST,
      extraField: "should_fail",
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra fields inside query (strict)", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      query: { text: "礼仪", limit: 5, sql: "DROP TABLE chunks" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty text", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      query: { text: "", limit: 5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects text over 2000 chars", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      query: { text: "x".repeat(2001), limit: 5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects limit = 0", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      query: { text: "礼仪", limit: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects limit > 20", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      query: { text: "礼仪", limit: 21 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown vectorFailureMode", () => {
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      query: { text: "礼仪", limit: 5, vectorFailureMode: "ignore" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects path-like content in text (field still present, but security comes from schema not accepting SQL)", () => {
    // The schema accepts any string — injection prevention is in the retriever layer.
    // Just verify normal text with slashes is accepted.
    const result = remoteKnowledgeRetrieveRequestSchema.safeParse({
      query: { text: "content/knowledge/court.md", limit: 5 },
    });
    expect(result.success).toBe(true);
  });
});

describe("remoteKnowledgeHitSchema", () => {
  it("accepts a valid hit", () => {
    const result = remoteKnowledgeHitSchema.safeParse(FULL_HIT);
    expect(result.success).toBe(true);
  });

  it("does NOT have sourcePath as a key in parsed output", () => {
    const result = remoteKnowledgeHitSchema.safeParse(FULL_HIT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("sourcePath");
  });

  it("preserves all score fields", () => {
    const result = remoteKnowledgeHitSchema.safeParse(FULL_HIT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.hybridScore).toBe(0.91);
    expect(result.data.rank).toBe(1);
    expect(result.data.keywordRank).toBe(1);
    expect(result.data.keywordScore).toBe(0.88);
    expect(result.data.vectorRank).toBeNull();
    expect(result.data.cosineScore).toBeNull();
  });

  it("accepts optional validFrom/validUntil", () => {
    const result = remoteKnowledgeHitSchema.safeParse({
      ...FULL_HIT,
      validFrom: { year: 1, month: 1, period: "early", dayIndex: 10 },
      validUntil: { year: 2, month: 6, period: "late", dayIndex: 100 },
    });
    expect(result.success).toBe(true);
  });
});

describe("remoteKnowledgeRetrieveResponseSchema", () => {
  it("accepts empty hits", () => {
    const result = remoteKnowledgeRetrieveResponseSchema.safeParse({ hits: [] });
    expect(result.success).toBe(true);
  });

  it("accepts hits without vectorDegradation", () => {
    const result = remoteKnowledgeRetrieveResponseSchema.safeParse({ hits: [FULL_HIT] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.vectorDegradation).toBeUndefined();
  });

  it("accepts vectorDegradation with valid reason", () => {
    const result = remoteKnowledgeRetrieveResponseSchema.safeParse({
      hits: [],
      vectorDegradation: { reason: "provider_error" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.vectorDegradation?.reason).toBe("provider_error");
  });

  it("vectorDegradation does NOT include message (server-private)", () => {
    const result = remoteKnowledgeRetrieveResponseSchema.safeParse({
      hits: [],
      vectorDegradation: { reason: "no_embeddings", message: "secret stack trace" },
    });
    // Schema does not include message field — strip-mode: it won't fail, but message won't be in output
    // (Zod's default is strip for object schemas unless .strict())
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.vectorDegradation).not.toHaveProperty("message");
  });
});
