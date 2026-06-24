import { describe, expect, it } from "vitest";
import {
  compileKnowledgeEmbeddingText,
  contentHash,
} from "../../../src/engine/knowledge/embedding/document-text";
import type { KnowledgeChunk } from "../../../src/engine/knowledge/model";

const BASE_CHUNK: KnowledgeChunk = {
  id: "test:1",
  sourceType: "world_rule",
  title: "礼制",
  text: "宫廷礼仪详解。",
  tags: ["礼仪", "宫廷"],
  entityIds: ["emperor:1"],
  locationIds: ["palace:1"],
  visibility: "public",
  sourcePath: "content/rules/etiquette.yaml",
};

describe("compileKnowledgeEmbeddingText", () => {
  it("produces deterministic output for the same input", () => {
    const a = compileKnowledgeEmbeddingText(BASE_CHUNK);
    const b = compileKnowledgeEmbeddingText({ ...BASE_CHUNK });
    expect(a).toBe(b);
  });

  it("includes title and text", () => {
    const out = compileKnowledgeEmbeddingText(BASE_CHUNK);
    expect(out).toContain("礼制");
    expect(out).toContain("宫廷礼仪详解");
  });

  it("includes source type", () => {
    const out = compileKnowledgeEmbeddingText(BASE_CHUNK);
    expect(out).toContain("world_rule");
  });

  it("sorts tags deterministically regardless of input order", () => {
    const asc = compileKnowledgeEmbeddingText({ ...BASE_CHUNK, tags: ["礼仪", "宫廷"] });
    const desc = compileKnowledgeEmbeddingText({ ...BASE_CHUNK, tags: ["宫廷", "礼仪"] });
    expect(asc).toBe(desc);
  });

  it("sorts entityIds deterministically", () => {
    const a = compileKnowledgeEmbeddingText({ ...BASE_CHUNK, entityIds: ["b", "a"] });
    const b = compileKnowledgeEmbeddingText({ ...BASE_CHUNK, entityIds: ["a", "b"] });
    expect(a).toBe(b);
  });

  it("sorts locationIds deterministically", () => {
    const a = compileKnowledgeEmbeddingText({ ...BASE_CHUNK, locationIds: ["z", "a"] });
    const b = compileKnowledgeEmbeddingText({ ...BASE_CHUNK, locationIds: ["a", "z"] });
    expect(a).toBe(b);
  });

  it("excludes sourcePath from embedding text", () => {
    const original = compileKnowledgeEmbeddingText(BASE_CHUNK);
    const moved = compileKnowledgeEmbeddingText({
      ...BASE_CHUNK,
      sourcePath: "content/rules/moved.yaml",
    });
    expect(original).toBe(moved);
  });

  it("excludes chunk id from embedding text", () => {
    const a = compileKnowledgeEmbeddingText(BASE_CHUNK);
    const b = compileKnowledgeEmbeddingText({ ...BASE_CHUNK, id: "test:999" });
    expect(a).toBe(b);
  });

  it("excludes validFrom and validUntil from embedding text", () => {
    const base = compileKnowledgeEmbeddingText(BASE_CHUNK);
    const withTime = compileKnowledgeEmbeddingText({
      ...BASE_CHUNK,
      validFrom: { year: 1, month: 1, period: "early", dayIndex: 0 },
      validUntil: { year: 2, month: 6, period: "mid", dayIndex: 46 },
    });
    expect(base).toBe(withTime);
  });

  it("produces different text for different chunk content", () => {
    const a = compileKnowledgeEmbeddingText(BASE_CHUNK);
    const b = compileKnowledgeEmbeddingText({ ...BASE_CHUNK, text: "完全不同的内容。" });
    expect(a).not.toBe(b);
  });
});

describe("contentHash", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const h = contentHash("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(contentHash("test")).toBe(contentHash("test"));
  });

  it("differs for different inputs", () => {
    expect(contentHash("abc")).not.toBe(contentHash("xyz"));
  });

  it("changes when chunk content changes", () => {
    const a = contentHash(compileKnowledgeEmbeddingText(BASE_CHUNK));
    const b = contentHash(
      compileKnowledgeEmbeddingText({ ...BASE_CHUNK, title: "不同的标题" }),
    );
    expect(a).not.toBe(b);
  });

  it("is stable across moves (sourcePath change)", () => {
    const a = contentHash(compileKnowledgeEmbeddingText(BASE_CHUNK));
    const b = contentHash(
      compileKnowledgeEmbeddingText({ ...BASE_CHUNK, sourcePath: "new/path.yaml" }),
    );
    expect(a).toBe(b);
  });
});
