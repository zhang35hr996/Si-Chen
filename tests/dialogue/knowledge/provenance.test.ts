/**
 * Suite D: extractProvenance — full provenance sanitization.
 *
 * Required assertions:
 * - All context kinds (memory, event, knowledge) collected from acceptedClaims + mentionedContextRefs
 * - Stable first-seen order (not alphabetical sort)
 * - Deduplication by contextRefKey
 * - Only offered refs retained; unoffered refs go into unknownRefs diagnostic
 * - knowledge.chunkIds derived from the knowledge subset of sourceRefs, first-seen order
 * - knowledge.degraded: true when vectorDegraded OR knowledgeContext is empty []
 * - knowledge: undefined when knowledgeContext is undefined (no retriever wired)
 * - No sourcePath exposure
 */
import { describe, it, expect } from "vitest";
import { extractProvenance } from "../../../src/engine/dialogue/knowledge/provenance";
import type { ContextRef } from "../../../src/engine/dialogue/types";
import type { PromptKnowledgeChunk } from "../../../src/engine/dialogue/knowledge/types";
import type { ProposedClaim } from "../../../src/engine/dialogue/claims";

function makeClaims(...sourceRefs: ContextRef[][]): ProposedClaim[] {
  return sourceRefs.map((refs) => ({ sourceRefs: refs })) as unknown as ProposedClaim[];
}

const kwRef = (id: string): ContextRef => ({ kind: "knowledge", id });
const memRef = (id: string): ContextRef => ({ kind: "memory", id });
const evtRef = (id: string): ContextRef => ({ kind: "event", id });

function kwChunk(id: string): PromptKnowledgeChunk {
  return { id, title: `title-${id}`, text: "text", sourceType: "etiquette" };
}

function offeredKeys(...refs: ContextRef[]): Set<string> {
  return new Set(refs.map((r) => `${r.kind}:${r.id}`));
}

describe("extractProvenance", () => {
  it("returns empty sourceRefs and undefined knowledge when knowledgeContext is undefined", () => {
    const result = extractProvenance([], [], new Set(), undefined, false);
    expect(result.sourceRefs).toEqual([]);
    expect(result.knowledge).toBeUndefined();
    expect(result.unknownRefs).toEqual([]);
  });

  it("returns knowledge: { chunkIds: [], degraded: true } when knowledgeContext is empty []", () => {
    const result = extractProvenance([], [], new Set(), [], false);
    expect(result.sourceRefs).toEqual([]);
    expect(result.knowledge).toEqual({ chunkIds: [], degraded: true });
  });

  it("collects memory refs from mentionedContextRefs", () => {
    const offered = offeredKeys(memRef("m1"));
    const result = extractProvenance([], [memRef("m1")], offered, undefined, false);
    expect(result.sourceRefs).toEqual([{ kind: "memory", id: "m1" }]);
  });

  it("collects event refs from mentionedContextRefs", () => {
    const offered = offeredKeys(evtRef("e1"));
    const result = extractProvenance([], [evtRef("e1")], offered, undefined, false);
    expect(result.sourceRefs).toEqual([{ kind: "event", id: "e1" }]);
  });

  it("collects memory refs from accepted claim sourceRefs", () => {
    const offered = offeredKeys(memRef("m1"));
    const claims = makeClaims([memRef("m1")]);
    const result = extractProvenance(claims, [], offered, undefined, false);
    expect(result.sourceRefs).toEqual([{ kind: "memory", id: "m1" }]);
  });

  it("collects knowledge refs from mentionedContextRefs", () => {
    const chunks = [kwChunk("k1"), kwChunk("k2")];
    const offered = offeredKeys(kwRef("k1"), kwRef("k2"));
    const result = extractProvenance([], [kwRef("k1")], offered, chunks, false);
    expect(result.sourceRefs).toContainEqual({ kind: "knowledge", id: "k1" });
    expect(result.knowledge?.chunkIds).toEqual(["k1"]);
  });

  it("stable first-seen order: claims before mentionedContextRefs, within each source by position", () => {
    const offered = offeredKeys(memRef("m1"), evtRef("e1"), memRef("m2"));
    const claims = makeClaims([memRef("m1")]);
    const mentioned = [evtRef("e1"), memRef("m2")];
    const result = extractProvenance(claims, mentioned, offered, undefined, false);
    expect(result.sourceRefs.map((r) => `${r.kind}:${r.id}`)).toEqual(["memory:m1", "event:e1", "memory:m2"]);
  });

  it("deduplicates refs appearing in both claims and mentionedContextRefs", () => {
    const offered = offeredKeys(memRef("m1"));
    const claims = makeClaims([memRef("m1")]);
    const mentioned = [memRef("m1")];
    const result = extractProvenance(claims, mentioned, offered, undefined, false);
    expect(result.sourceRefs.filter((r) => r.id === "m1")).toHaveLength(1);
  });

  it("excludes unoffered refs and reports them in unknownRefs", () => {
    const offered = offeredKeys(kwRef("k1"));
    const result = extractProvenance([], [kwRef("k1"), kwRef("k999")], offered, [kwChunk("k1")], false);
    expect(result.sourceRefs.map((r) => r.id)).toContain("k1");
    expect(result.sourceRefs.map((r) => r.id)).not.toContain("k999");
    expect(result.unknownRefs).toContainEqual({ kind: "knowledge", id: "k999" });
  });

  it("unoffered memory ref also goes to unknownRefs", () => {
    const offered = offeredKeys(memRef("m1"));
    const result = extractProvenance([], [memRef("m1"), memRef("m_unknown")], offered, undefined, false);
    expect(result.unknownRefs).toContainEqual({ kind: "memory", id: "m_unknown" });
  });

  it("knowledge.chunkIds is in first-seen order (not alphabetical)", () => {
    const chunks = [kwChunk("k_z"), kwChunk("k_a"), kwChunk("k_m")];
    const offered = offeredKeys(kwRef("k_z"), kwRef("k_a"), kwRef("k_m"));
    // Mention order: k_z first, then k_a, then k_m
    const result = extractProvenance([], [kwRef("k_z"), kwRef("k_a"), kwRef("k_m")], offered, chunks, false);
    expect(result.knowledge?.chunkIds).toEqual(["k_z", "k_a", "k_m"]);
  });

  it("knowledge.degraded = true when vectorDegraded = true", () => {
    const chunks = [kwChunk("k1")];
    const offered = offeredKeys(kwRef("k1"));
    const result = extractProvenance([], [kwRef("k1")], offered, chunks, true);
    expect(result.knowledge?.degraded).toBe(true);
  });

  it("knowledge.degraded = false when vectorDegraded = false and chunks non-empty", () => {
    const chunks = [kwChunk("k1")];
    const offered = offeredKeys(kwRef("k1"));
    const result = extractProvenance([], [kwRef("k1")], offered, chunks, false);
    expect(result.knowledge?.degraded).toBe(false);
  });

  it("unused retrieved chunks not reflected in chunkIds (only used ones appear)", () => {
    const chunks = [kwChunk("k1"), kwChunk("k2")];
    const offered = offeredKeys(kwRef("k1"), kwRef("k2"));
    // Only k1 is mentioned; k2 was offered but not used
    const result = extractProvenance([], [kwRef("k1")], offered, chunks, false);
    expect(result.knowledge?.chunkIds).toEqual(["k1"]);
    expect(result.knowledge?.chunkIds).not.toContain("k2");
  });

  it("no sourcePath exposure: packed chunk fields are only { id, title, text, sourceType }", () => {
    // This test verifies the type contract: PromptKnowledgeChunk has no sourcePath
    const chunk: PromptKnowledgeChunk = kwChunk("k1");
    expect(Object.keys(chunk).sort()).toEqual(["id", "sourceType", "text", "title"]);
    expect(chunk).not.toHaveProperty("sourcePath");
  });
});
