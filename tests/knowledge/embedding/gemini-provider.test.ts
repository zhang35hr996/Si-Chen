/**
 * Unit tests for the Gemini embedding provider.
 *
 * Injects a MinimalGeminiClient mock to verify exact outbound request shape
 * without hitting the real API.
 *
 * Gen1 (gemini-embedding-001, text-embedding-004):
 *   One embedContent() call per batch; returns N embeddings for N texts.
 *   Expects: string[], config.taskType, single network call.
 *
 * Gen2 (gemini-embedding-2):
 *   One embedContent() call PER TEXT — API returns a single aggregated
 *   embedding per call regardless of how many Content objects are sent.
 *   Expects: one Content object, no taskType, call count == texts.length.
 */
import { describe, expect, it, vi } from "vitest";
import type { MinimalGeminiClient } from "../../../src/engine/knowledge/embedding/gemini-embedding-provider";
import { createGeminiEmbeddingProviderForTesting } from "../../../src/engine/knowledge/embedding/gemini-embedding-provider";

type EmbedContentCall = Parameters<MinimalGeminiClient["models"]["embedContent"]>[0];

// ── Mock factories ─────────────────────────────────────────────────────────────

/**
 * Gen1 mock: returns ALL `batchVectors` in a single embedContent() call.
 */
function makeBatchMockClient(batchVectors: number[][]): {
  client: MinimalGeminiClient;
  calls: EmbedContentCall[];
} {
  const calls: EmbedContentCall[] = [];
  const client: MinimalGeminiClient = {
    models: {
      embedContent: vi.fn(async (params) => {
        calls.push(params);
        return { embeddings: batchVectors.map((v) => ({ values: v })) };
      }),
    },
  };
  return { client, calls };
}

/**
 * Gen2 mock: returns ONE embedding per embedContent() call.
 * `vectorsPerCall[i]` is the embedding returned by the (i+1)-th call.
 * If a call is made beyond the provided list, throws "unexpected call".
 */
function makePerCallMockClient(vectorsPerCall: number[][]): {
  client: MinimalGeminiClient;
  calls: EmbedContentCall[];
} {
  const calls: EmbedContentCall[] = [];
  let idx = 0;
  const client: MinimalGeminiClient = {
    models: {
      embedContent: vi.fn(async (params) => {
        calls.push(params);
        const vec = vectorsPerCall[idx++];
        if (!vec) throw new Error(`[mock] unexpected call ${idx} (only ${vectorsPerCall.length} vectors supplied)`);
        return { embeddings: [{ values: vec }] };
      }),
    },
  };
  return { client, calls };
}

/**
 * Gen2 mock where the N-th call (1-based) throws.
 */
function makeFailingCallClient(
  vectorsPerCall: number[][],
  failOnCall: number,
  error = new Error("simulated API error"),
): { client: MinimalGeminiClient; calls: EmbedContentCall[] } {
  const calls: EmbedContentCall[] = [];
  let idx = 0;
  const client: MinimalGeminiClient = {
    models: {
      embedContent: vi.fn(async (params) => {
        calls.push(params);
        idx++;
        if (idx === failOnCall) throw error;
        const vec = vectorsPerCall[idx - 1];
        return { embeddings: vec ? [{ values: vec }] : [] };
      }),
    },
  };
  return { client, calls };
}

// ── Gen1 model tests ──────────────────────────────────────────────────────────

describe("Gen1 models (gemini-embedding-001, text-embedding-004)", () => {
  const gen1Models = ["gemini-embedding-001", "text-embedding-004"];

  for (const model of gen1Models) {
    describe(`model: ${model}`, () => {
      it("makes exactly ONE embedContent call for N texts (batch)", async () => {
        const texts = ["first", "second", "third"];
        const { client, calls } = makeBatchMockClient([[1, 0], [0, 1], [1, 1]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        const result = await provider.embed({ texts, purpose: "document" });

        expect(calls).toHaveLength(1);
        expect(result.vectors).toHaveLength(3);
      });

      it("sends contents as a string array", async () => {
        const texts = ["a", "b"];
        const { client, calls } = makeBatchMockClient([[1, 0], [0, 1]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        await provider.embed({ texts, purpose: "document" });

        expect(Array.isArray(calls[0]!.contents)).toBe(true);
        expect(calls[0]!.contents).toEqual(texts);
      });

      it("sets taskType=RETRIEVAL_DOCUMENT for document purpose", async () => {
        const { client, calls } = makeBatchMockClient([[1, 0]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        await provider.embed({ texts: ["doc"], purpose: "document" });

        expect(calls[0]!.config?.taskType).toBe("RETRIEVAL_DOCUMENT");
      });

      it("sets taskType=RETRIEVAL_QUERY for query purpose", async () => {
        const { client, calls } = makeBatchMockClient([[1, 0]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        await provider.embed({ texts: ["q"], purpose: "query" });

        expect(calls[0]!.config?.taskType).toBe("RETRIEVAL_QUERY");
      });

      it("returns vectors in input order", async () => {
        const { client } = makeBatchMockClient([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
        const provider = createGeminiEmbeddingProviderForTesting(client, model);

        const result = await provider.embed({ texts: ["a", "b", "c"], purpose: "document" });

        expect(result.vectors[0]).toEqual([1, 0, 0]);
        expect(result.vectors[1]).toEqual([0, 1, 0]);
        expect(result.vectors[2]).toEqual([0, 0, 1]);
      });
    });
  }
});

// ── Gen2 model tests ──────────────────────────────────────────────────────────

describe("Gen2 model (gemini-embedding-2)", () => {
  const model = "gemini-embedding-2";

  // ── Cardinality: one call per text ──────────────────────────────────────────

  it("makes exactly N embedContent calls for N texts (not one batch call)", async () => {
    const { client, calls } = makePerCallMockClient([[1, 0], [0, 1], [1, 1]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    const result = await provider.embed({ texts: ["a", "b", "c"], purpose: "document" });

    expect(calls).toHaveLength(3);
    expect(result.vectors).toHaveLength(3);
  });

  it("makes exactly 1 call for 1 text", async () => {
    const { client, calls } = makePerCallMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["single"], purpose: "document" });

    expect(calls).toHaveLength(1);
  });

  // ── Request shape: single Content object per call ──────────────────────────

  it("each call sends a single Content object (not a string array)", async () => {
    const { client, calls } = makePerCallMockClient([[1, 0], [0, 1]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["x", "y"], purpose: "document" });

    for (const call of calls) {
      expect(Array.isArray(call.contents)).toBe(false);
      expect(typeof call.contents).toBe("object");
      const c = call.contents as { parts: Array<{ text: string }> };
      expect(c).toHaveProperty("parts");
      expect(Array.isArray(c.parts)).toBe(true);
      expect(c.parts).toHaveLength(1);
    }
  });

  it("does NOT include taskType in config", async () => {
    const { client, calls } = makePerCallMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["x"], purpose: "document" });

    expect(calls[0]!.config?.taskType).toBeUndefined();
  });

  // ── Retrieval prefixes ─────────────────────────────────────────────────────

  it("prepends official document retrieval prefix", async () => {
    const { client, calls } = makePerCallMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["my document"], purpose: "document" });

    const content = calls[0]!.contents as { parts: Array<{ text: string }> };
    expect(content.parts[0]!.text).toBe("title: none | text: my document");
  });

  it("prepends official query retrieval prefix", async () => {
    const { client, calls } = makePerCallMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["my query"], purpose: "query" });

    const content = calls[0]!.contents as { parts: Array<{ text: string }> };
    expect(content.parts[0]!.text).toBe("task: search result | query: my query");
  });

  it("each call targets its own text with the correct prefix", async () => {
    const { client, calls } = makePerCallMockClient([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await provider.embed({ texts: ["alpha", "beta", "gamma"], purpose: "document" });

    const prefix = "title: none | text: ";
    expect((calls[0]!.contents as { parts: [{ text: string }] }).parts[0].text).toBe(prefix + "alpha");
    expect((calls[1]!.contents as { parts: [{ text: string }] }).parts[0].text).toBe(prefix + "beta");
    expect((calls[2]!.contents as { parts: [{ text: string }] }).parts[0].text).toBe(prefix + "gamma");
  });

  // ── Output order ───────────────────────────────────────────────────────────

  it("output vectors are in the same order as input texts", async () => {
    const { client } = makePerCallMockClient([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    const result = await provider.embed({ texts: ["a", "b", "c"], purpose: "document" });

    expect(result.vectors[0]).toEqual([1, 0, 0]);
    expect(result.vectors[1]).toEqual([0, 1, 0]);
    expect(result.vectors[2]).toEqual([0, 0, 1]);
  });

  // ── Failure propagation ────────────────────────────────────────────────────

  it("rejects the whole embed when the second call fails", async () => {
    const { client, calls } = makeFailingCallClient(
      [[1, 0], [0, 0], [0, 0]], // call 2 throws before its return value is used
      2,
      new Error("API error on second call"),
    );
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await expect(
      provider.embed({ texts: ["a", "b", "c"], purpose: "document" }),
    ).rejects.toThrow("API error on second call");

    // Two calls made (first succeeded, second threw)
    expect(calls).toHaveLength(2);
  });

  it("does not make further calls after one fails", async () => {
    const { client, calls } = makeFailingCallClient([[1, 0]], 1, new Error("fail on first"));
    const provider = createGeminiEmbeddingProviderForTesting(client, model);

    await expect(
      provider.embed({ texts: ["a", "b", "c"], purpose: "document" }),
    ).rejects.toThrow();

    expect(calls).toHaveLength(1);
  });

  // ── AbortSignal ───────────────────────────────────────────────────────────

  it("stops making calls after AbortSignal fires between requests", async () => {
    const controller = new AbortController();
    let callCount = 0;
    const abortingClient: MinimalGeminiClient = {
      models: {
        embedContent: vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            // Abort after the first call completes
            controller.abort();
          }
          return { embeddings: [{ values: [1, 0] }] };
        }),
      },
    };
    const provider = createGeminiEmbeddingProviderForTesting(abortingClient, model);

    await expect(
      provider.embed({
        texts: ["a", "b", "c"],
        purpose: "document",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);

    // Only 1 call should have been made before the abort was detected
    expect(callCount).toBe(1);
  });

  it("throws AbortError immediately when signal is pre-aborted (no calls made)", async () => {
    const { client, calls } = makePerCallMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, model);
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.embed({ texts: ["x"], purpose: "document", signal: controller.signal }),
    ).rejects.toThrow(/abort/i);

    expect(calls).toHaveLength(0);
  });
});

// ── Shared behaviour ──────────────────────────────────────────────────────────

describe("shared behaviour across model families", () => {
  it("returns empty vectors without calling client when texts is empty", async () => {
    for (const model of ["gemini-embedding-001", "gemini-embedding-2"]) {
      const { client, calls } = makeBatchMockClient([]);
      const provider = createGeminiEmbeddingProviderForTesting(client, model);

      const result = await provider.embed({ texts: [], purpose: "document" });

      expect(calls).toHaveLength(0);
      expect(result.vectors).toHaveLength(0);
    }
  });

  it("returns correct modelKey", () => {
    const dummyClient = makeBatchMockClient([]).client;
    const p1 = createGeminiEmbeddingProviderForTesting(dummyClient, "gemini-embedding-001");
    const p2 = createGeminiEmbeddingProviderForTesting(dummyClient, "gemini-embedding-2");
    expect(p1.modelKey).toBe("gemini:gemini-embedding-001");
    expect(p2.modelKey).toBe("gemini:gemini-embedding-2");
  });

  it("throws AbortError when signal is pre-aborted (gen1)", async () => {
    const { client } = makeBatchMockClient([[1, 0]]);
    const provider = createGeminiEmbeddingProviderForTesting(client, "gemini-embedding-001");
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.embed({ texts: ["x"], purpose: "document", signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
  });
});
