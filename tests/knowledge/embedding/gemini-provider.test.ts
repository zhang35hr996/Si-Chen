/**
 * Unit tests for the Gemini embedding provider.
 *
 * Uses MinimalGeminiClient mock to capture exact outbound request shape
 * without hitting the real API.
 *
 * Tests verify:
 *  - Gen1 models (gemini-embedding-001, text-embedding-004): string[] + taskType
 *  - Gen2 models (gemini-embedding-2): Content objects per text + retrieval prefix
 *  - AbortSignal pre-check fires before network call
 *  - Empty texts input returns zero vectors (no network call)
 */
import { describe, expect, it, vi } from "vitest";
import type { MinimalGeminiClient } from "../../../src/engine/knowledge/embedding/gemini-embedding-provider";
import { createGeminiEmbeddingProviderForTesting } from "../../../src/engine/knowledge/embedding/gemini-embedding-provider";

type EmbedContentCall = Parameters<MinimalGeminiClient["models"]["embedContent"]>[0];

function makeMockClient(returnVectors: number[][]): { client: MinimalGeminiClient; calls: EmbedContentCall[] } {
  const calls: EmbedContentCall[] = [];
  const client: MinimalGeminiClient = {
    models: {
      embedContent: vi.fn(async (params) => {
        calls.push(params);
        return {
          embeddings: returnVectors.map((v) => ({ values: v })),
        };
      }),
    },
  };
  return { client, calls };
}

// ── Gen1 model shape ──────────────────────────────────────────────────────────

describe("Gen1 models (gemini-embedding-001, text-embedding-004)", () => {
  const gen1Models = ["gemini-embedding-001", "text-embedding-004"];

  for (const model of gen1Models) {
    describe(`model: ${model}`, () => {
      it("sends contents as string array", async () => {
        const texts = ["first text", "second text"];
        const { client, calls } = makeMockClient([[1, 0], [0, 1]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        await provider.embed({ texts, purpose: "document" });

        expect(calls).toHaveLength(1);
        // Gen1: contents must be the raw string array
        expect(calls[0]!.contents).toEqual(texts);
      });

      it("sets taskType=RETRIEVAL_DOCUMENT for document purpose", async () => {
        const { client, calls } = makeMockClient([[1, 0]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        await provider.embed({ texts: ["doc"], purpose: "document" });

        expect(calls[0]!.config?.taskType).toBe("RETRIEVAL_DOCUMENT");
      });

      it("sets taskType=RETRIEVAL_QUERY for query purpose", async () => {
        const { client, calls } = makeMockClient([[1, 0]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        await provider.embed({ texts: ["query text"], purpose: "query" });

        expect(calls[0]!.config?.taskType).toBe("RETRIEVAL_QUERY");
      });

      it("passes correct model name in request", async () => {
        const { client, calls } = makeMockClient([[1, 0]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        await provider.embed({ texts: ["x"], purpose: "document" });

        expect(calls[0]!.model).toBe(model);
      });
    });
  }
});

// ── Gen2 model shape ──────────────────────────────────────────────────────────

describe("Gen2 model (gemini-embedding-2)", () => {
  const model = "gemini-embedding-2";

  it("wraps each text in a Content object (not a string array)", async () => {
    const texts = ["first text", "second text"];
    const { client, calls } = makeMockClient([[1, 0], [0, 1]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts, purpose: "document" });

    expect(calls).toHaveLength(1);
    const contents = calls[0]!.contents as Array<{ parts: Array<{ text: string }> }>;
    // Must be an array of objects with parts, not an array of strings
    expect(Array.isArray(contents)).toBe(true);
    expect(contents).toHaveLength(2);
    expect(typeof contents[0]).toBe("object");
    expect(contents[0]).toHaveProperty("parts");
  });

  it("prepends document retrieval prefix for document purpose", async () => {
    const { client, calls } = makeMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["my document"], purpose: "document" });

    const contents = calls[0]!.contents as Array<{ parts: Array<{ text: string }> }>;
    expect(contents[0]!.parts[0]!.text).toBe(
      "Represent this document for retrieval: my document",
    );
  });

  it("prepends query retrieval prefix for query purpose", async () => {
    const { client, calls } = makeMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["my query"], purpose: "query" });

    const contents = calls[0]!.contents as Array<{ parts: Array<{ text: string }> }>;
    expect(contents[0]!.parts[0]!.text).toBe(
      "Represent this query for retrieval: my query",
    );
  });

  it("does NOT include taskType in config", async () => {
    const { client, calls } = makeMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["x"], purpose: "document" });

    // config may be absent entirely or present without taskType
    const config = calls[0]!.config;
    expect(config?.taskType).toBeUndefined();
  });

  it("produces one Content object per text", async () => {
    const texts = ["alpha", "beta", "gamma"];
    const { client, calls } = makeMockClient([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts, purpose: "document" });

    const contents = calls[0]!.contents as Array<{ parts: Array<{ text: string }> }>;
    expect(contents).toHaveLength(3);
    const prefix = "Represent this document for retrieval: ";
    expect(contents[0]!.parts[0]!.text).toBe(prefix + "alpha");
    expect(contents[1]!.parts[0]!.text).toBe(prefix + "beta");
    expect(contents[2]!.parts[0]!.text).toBe(prefix + "gamma");
  });
});

// ── Shared behaviour ──────────────────────────────────────────────────────────

describe("shared behaviour across model families", () => {
  it("returns empty vectors without calling client when texts is empty", async () => {
    for (const model of ["gemini-embedding-001", "gemini-embedding-2"]) {
      const { client, calls } = makeMockClient([]);
      const provider = createGeminiEmbeddingProviderForTesting(client, model);

      const result = await provider.embed({ texts: [], purpose: "document" });

      expect(calls).toHaveLength(0);
      expect(result.vectors).toHaveLength(0);
    }
  });

  it("throws AbortError immediately when signal is pre-aborted", async () => {
    for (const model of ["gemini-embedding-001", "gemini-embedding-2"]) {
      const { client } = makeMockClient([[1, 0]]);
      const provider = createGeminiEmbeddingProviderForTesting(client, model);
      const controller = new AbortController();
      controller.abort();

      await expect(
        provider.embed({ texts: ["x"], purpose: "document", signal: controller.signal }),
      ).rejects.toThrow(/abort/i);
    }
  });

  it("returns correct modelKey", () => {
    const p1 = createGeminiEmbeddingProviderForTesting(makeMockClient([]).client, "gemini-embedding-001");
    const p2 = createGeminiEmbeddingProviderForTesting(makeMockClient([]).client, "gemini-embedding-2");
    expect(p1.modelKey).toBe("gemini:gemini-embedding-001");
    expect(p2.modelKey).toBe("gemini:gemini-embedding-2");
  });
});
