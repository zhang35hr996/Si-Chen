/**
 * Suite D: extractProvenance — full provenance sanitization.
 *
 * Required assertions:
 * - All context kinds (memory, event, knowledge) collected from acceptedClaims + mentionedContextRefs
 * - Stable first-seen order (not alphabetical sort)
 * - Deduplication by contextRefKey
 * - Only offered refs retained; unoffered refs go into unknownRefs diagnostic
 * - knowledge.chunkIds derived from the knowledge subset of sourceRefs, first-seen order
 * - knowledge.degraded derived from KnowledgeRetrievalStatus, never from chunk count
 *   - status "ok" + zero hits → degraded: false (NOT degraded)
 *   - status "vector_degraded" → degraded: true, degradationKind/Reason set
 *   - status "fatal_degraded" → degraded: true, degradationKind: "fatal_degraded"
 * - knowledge: undefined when status is "not_configured"
 * - No sourcePath exposure
 */
import { describe, it, expect } from "vitest";
import { extractProvenance } from "../../../src/engine/dialogue/knowledge/provenance";
import type { ContextRef } from "../../../src/engine/dialogue/types";
import type { KnowledgeRetrievalStatus } from "../../../src/engine/dialogue/types";
import type { PromptKnowledgeChunk } from "../../../src/engine/dialogue/knowledge/types";
import type { ProposedClaim } from "../../../src/engine/dialogue/claims";

const STATUS_OK: KnowledgeRetrievalStatus = { kind: "ok" };
const STATUS_NOT_CONFIGURED: KnowledgeRetrievalStatus = { kind: "not_configured" };
const STATUS_VECTOR_DEGRADED: KnowledgeRetrievalStatus = { kind: "vector_degraded", reason: "no_embeddings" };
const STATUS_FATAL_DEGRADED: KnowledgeRetrievalStatus = { kind: "fatal_degraded" };

const kwRef = (id: string): ContextRef => ({ kind: "knowledge", id });
const memRef = (id: string): ContextRef => ({ kind: "memory", id });
const evtRef = (id: string): ContextRef => ({ kind: "event", id });

function kwChunk(id: string): PromptKnowledgeChunk {
  return { id, title: `title-${id}`, text: "text", sourceType: "etiquette" };
}

function offeredKeys(...refs: ContextRef[]): Set<string> {
  return new Set(refs.map((r) => `${r.kind}:${r.id}`));
}

function makeClaims(...sourceRefs: ContextRef[][]): ProposedClaim[] {
  return sourceRefs.map((refs) => ({ sourceRefs: refs })) as unknown as ProposedClaim[];
}

describe("extractProvenance", () => {
  it("returns undefined knowledge when status is not_configured", () => {
    const result = extractProvenance([], [], new Set(), undefined, STATUS_NOT_CONFIGURED);
    expect(result.sourceRefs).toEqual([]);
    expect(result.knowledge).toBeUndefined();
  });

  it("returns knowledge: { chunkIds: [], degraded: false } when status is ok and no hits", () => {
    const result = extractProvenance([], [], new Set(), [], STATUS_OK);
    expect(result.knowledge).toEqual({ chunkIds: [], degraded: false });
  });

  it("successful empty retrieval is NOT degraded (degraded: false, no degradationKind)", () => {
    const result = extractProvenance([], [], new Set(), [], STATUS_OK);
    expect(result.knowledge?.degraded).toBe(false);
    expect(result.knowledge).not.toHaveProperty("degradationKind");
  });

  it("vector_degraded status → degraded: true, degradationKind and degradationReason set", () => {
    const chunks = [kwChunk("k1")];
    const offered = offeredKeys(kwRef("k1"));
    const result = extractProvenance([], [kwRef("k1")], offered, chunks, STATUS_VECTOR_DEGRADED);
    expect(result.knowledge?.degraded).toBe(true);
    expect(result.knowledge?.degradationKind).toBe("vector_degraded");
    expect(result.knowledge?.degradationReason).toBe("no_embeddings");
  });

  it("fatal_degraded status → degraded: true, degradationKind: fatal_degraded, no reason", () => {
    const result = extractProvenance([], [], new Set(), [], STATUS_FATAL_DEGRADED);
    expect(result.knowledge?.degraded).toBe(true);
    expect(result.knowledge?.degradationKind).toBe("fatal_degraded");
    expect(result.knowledge).not.toHaveProperty("degradationReason");
  });

  it("collects memory refs from accepted claim sourceRefs", () => {
    const offered = offeredKeys(memRef("m1"));
    const claims = makeClaims([memRef("m1")]);
    const result = extractProvenance(claims, [], offered, undefined, STATUS_NOT_CONFIGURED);
    expect(result.sourceRefs).toEqual([{ kind: "memory", id: "m1" }]);
  });

  it("collects event refs from mentionedContextRefs", () => {
    const offered = offeredKeys(evtRef("e1"));
    const result = extractProvenance([], [evtRef("e1")], offered, undefined, STATUS_NOT_CONFIGURED);
    expect(result.sourceRefs).toEqual([{ kind: "event", id: "e1" }]);
  });

  it("collects knowledge refs from mentionedContextRefs", () => {
    const chunks = [kwChunk("k1"), kwChunk("k2")];
    const offered = offeredKeys(kwRef("k1"), kwRef("k2"));
    const result = extractProvenance([], [kwRef("k1")], offered, chunks, STATUS_OK);
    expect(result.sourceRefs).toContainEqual({ kind: "knowledge", id: "k1" });
    expect(result.knowledge?.chunkIds).toEqual(["k1"]);
  });

  it("stable first-seen order: claims before mentionedContextRefs", () => {
    const offered = offeredKeys(memRef("m1"), evtRef("e1"), memRef("m2"));
    const claims = makeClaims([memRef("m1")]);
    const mentioned = [evtRef("e1"), memRef("m2")];
    const result = extractProvenance(claims, mentioned, offered, undefined, STATUS_NOT_CONFIGURED);
    expect(result.sourceRefs.map((r) => `${r.kind}:${r.id}`)).toEqual(["memory:m1", "event:e1", "memory:m2"]);
  });

  it("deduplicates refs appearing in both claims and mentionedContextRefs", () => {
    const offered = offeredKeys(memRef("m1"));
    const claims = makeClaims([memRef("m1")]);
    const mentioned = [memRef("m1")];
    const result = extractProvenance(claims, mentioned, offered, undefined, STATUS_NOT_CONFIGURED);
    expect(result.sourceRefs.filter((r) => r.id === "m1")).toHaveLength(1);
  });

  it("excludes unoffered refs and reports them in unknownRefs", () => {
    const offered = offeredKeys(kwRef("k1"));
    const result = extractProvenance([], [kwRef("k1"), kwRef("k999")], offered, [kwChunk("k1")], STATUS_OK);
    expect(result.sourceRefs.map((r) => r.id)).toContain("k1");
    expect(result.sourceRefs.map((r) => r.id)).not.toContain("k999");
    expect(result.unknownRefs).toContainEqual({ kind: "knowledge", id: "k999" });
  });

  it("unoffered memory ref goes to unknownRefs", () => {
    const offered = offeredKeys(memRef("m1"));
    const result = extractProvenance([], [memRef("m1"), memRef("m_unknown")], offered, undefined, STATUS_NOT_CONFIGURED);
    expect(result.unknownRefs).toContainEqual({ kind: "memory", id: "m_unknown" });
  });

  it("knowledge.chunkIds is in first-seen order (not alphabetical)", () => {
    const chunks = [kwChunk("k_z"), kwChunk("k_a"), kwChunk("k_m")];
    const offered = offeredKeys(kwRef("k_z"), kwRef("k_a"), kwRef("k_m"));
    const result = extractProvenance([], [kwRef("k_z"), kwRef("k_a"), kwRef("k_m")], offered, chunks, STATUS_OK);
    expect(result.knowledge?.chunkIds).toEqual(["k_z", "k_a", "k_m"]);
  });

  it("unused retrieved chunks not reflected in chunkIds", () => {
    const chunks = [kwChunk("k1"), kwChunk("k2")];
    const offered = offeredKeys(kwRef("k1"), kwRef("k2"));
    const result = extractProvenance([], [kwRef("k1")], offered, chunks, STATUS_OK);
    expect(result.knowledge?.chunkIds).toEqual(["k1"]);
    expect(result.knowledge?.chunkIds).not.toContain("k2");
  });

  it("no sourcePath exposure: PromptKnowledgeChunk has only { id, title, text, sourceType }", () => {
    const chunk: PromptKnowledgeChunk = kwChunk("k1");
    expect(Object.keys(chunk).sort()).toEqual(["id", "sourceType", "text", "title"]);
    expect(chunk).not.toHaveProperty("sourcePath");
  });
});
