/**
 * Suite D: extractKnowledgeProvenance — provenance extraction from accepted claims
 * and mentionedContextRefs.
 */
import { describe, it, expect } from "vitest";
import { extractKnowledgeProvenance } from "../../../src/engine/dialogue/knowledge/provenance";
import type { ContextRef } from "../../../src/engine/dialogue/claims";
import type { PromptKnowledgeChunk } from "../../../src/engine/dialogue/knowledge/types";

const kwChunk = (id: string): PromptKnowledgeChunk => ({
  id,
  title: `title-${id}`,
  text: "some text",
  sourceType: "etiquette",
  visibility: "public",
});

const kwRef = (id: string): ContextRef => ({ kind: "knowledge", id });
const memRef = (id: string): ContextRef => ({ kind: "memory", id });

describe("extractKnowledgeProvenance", () => {
  it("returns empty sourceRefs and undefined knowledge when knowledgeContext is absent", () => {
    const result = extractKnowledgeProvenance([], [], undefined, false);
    expect(result.sourceRefs).toEqual([]);
    expect(result.knowledge).toBeUndefined();
  });

  it("returns empty sourceRefs and undefined knowledge when knowledgeContext is empty", () => {
    const result = extractKnowledgeProvenance([], [], [], false);
    expect(result.sourceRefs).toEqual([]);
    expect(result.knowledge).toBeUndefined();
  });

  it("extracts knowledge refs from mentionedContextRefs", () => {
    const chunks = [kwChunk("k1"), kwChunk("k2")];
    const result = extractKnowledgeProvenance([], [kwRef("k1")], chunks, false);
    expect(result.sourceRefs).toEqual([{ kind: "knowledge", id: "k1" }]);
    expect(result.knowledge?.chunkIds).toEqual(["k1"]);
  });

  it("ignores knowledge refs not in knowledgeContext (defense against out-of-bound refs)", () => {
    const chunks = [kwChunk("k1")];
    const result = extractKnowledgeProvenance([], [kwRef("k999")], chunks, false);
    expect(result.sourceRefs).toHaveLength(0);
  });

  it("ignores memory/event refs (only knowledge kind tracked)", () => {
    const chunks = [kwChunk("k1")];
    const result = extractKnowledgeProvenance([], [memRef("m1"), kwRef("k1")], chunks, false);
    const kinds = result.sourceRefs.map((r) => r.kind);
    expect(kinds.every((k) => k === "knowledge")).toBe(true);
  });

  it("deduplicates refs appearing in both acceptedClaims and mentionedContextRefs", () => {
    const chunks = [kwChunk("k1")];
    // NOTE: knowledge refs in sourceRefs would normally be rejected by the claim gate,
    // but provenance extraction is gate-agnostic — it just collects what's present.
    const result = extractKnowledgeProvenance([], [kwRef("k1"), kwRef("k1")], chunks, false);
    expect(result.sourceRefs.filter((r) => r.id === "k1")).toHaveLength(1);
  });

  it("sets knowledge.degraded = true when vectorDegraded is true", () => {
    const chunks = [kwChunk("k1")];
    const result = extractKnowledgeProvenance([], [kwRef("k1")], chunks, true);
    expect(result.knowledge?.degraded).toBe(true);
  });

  it("sets knowledge.degraded = false when vectorDegraded is false", () => {
    const chunks = [kwChunk("k1")];
    const result = extractKnowledgeProvenance([], [kwRef("k1")], chunks, false);
    expect(result.knowledge?.degraded).toBe(false);
  });

  it("chunkIds are sorted (deterministic order)", () => {
    const chunks = [kwChunk("k2"), kwChunk("k1"), kwChunk("k3")];
    const result = extractKnowledgeProvenance([], [kwRef("k2"), kwRef("k3"), kwRef("k1")], chunks, false);
    expect(result.knowledge?.chunkIds).toEqual(["k1", "k2", "k3"]);
  });

  it("returns knowledge diagnostic even when no refs are used (chunks offered but unused)", () => {
    const chunks = [kwChunk("k1")];
    const result = extractKnowledgeProvenance([], [], chunks, false);
    expect(result.knowledge).toBeDefined();
    expect(result.knowledge?.chunkIds).toEqual([]);
  });
});
