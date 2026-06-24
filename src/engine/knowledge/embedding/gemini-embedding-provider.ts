/**
 * Google Gemini embedding provider.
 *
 * Supports two model families with different request shapes and cardinality:
 *
 *   Gen1 — "gemini-embedding-001", "text-embedding-004":
 *     One `embedContent()` call for the entire batch.
 *     contents: string[]   (SDK accepts an array)
 *     config: { taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" }
 *     Returns one embedding per string in `contents`.
 *
 *   Gen2 — "gemini-embedding-2" (and future "gemini-embedding-N" N≥2):
 *     IMPORTANT: each `embedContent()` call returns exactly ONE aggregated
 *     embedding regardless of how many Content objects are supplied.  To get
 *     N independent embeddings, N separate calls are required.
 *     This implementation makes one sequential call per text; AbortSignal is
 *     checked between calls so a cancel does not trigger pending HTTP requests.
 *     Task intent is expressed through a retrieval instruction prefix prepended
 *     to the text (official "search asymmetric" format — no taskType).
 *
 * Cancellation:
 *   @google/genai v2 embedContent does not thread AbortSignal into its
 *   underlying fetch.  We check the signal before every call.  A network call
 *   that completes after abort is a wasted token; its result is discarded
 *   (syncEmbeddings only writes after all batches succeed anyway).
 *
 * Testing:
 *   Use createGeminiEmbeddingProviderForTesting() to inject a mock client that
 *   captures outbound request parameters for shape and call-count verification.
 */
import { GoogleGenAI } from "@google/genai";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "./provider";

export interface GeminiEmbeddingProviderOptions {
  apiKey: string;
  model: string;
}

// ── Minimal structural client type ────────────────────────────────────────────
// Accepted by both the real SDK and test mocks.

export interface MinimalGeminiClient {
  models: {
    embedContent(params: {
      model: string;
      contents: unknown;
      config?: { taskType?: string };
    }): Promise<{
      embeddings?: Array<{ values?: number[] }>;
    }>;
  };
}

// ── Model-family detection ─────────────────────────────────────────────────────

function isGen2Model(model: string): boolean {
  // Matches gemini-embedding-2, gemini-embedding-2-preview-*, gemini-embedding-3, etc.
  return /^gemini-embedding-[2-9]/i.test(model);
}

// Official Google "search asymmetric" instruction prefixes for gen2 models.
// See: https://ai.google.dev/gemini-api/docs/embeddings
const GEN2_DOC_PREFIX = "title: none | text: ";
const GEN2_QUERY_PREFIX = "task: search result | query: ";

// ── Shared provider builder ───────────────────────────────────────────────────

function buildProvider(client: MinimalGeminiClient, model: string): EmbeddingProvider {
  const gen2 = isGen2Model(model);

  return {
    providerId: "gemini",
    model,
    modelKey: `gemini:${model}`,

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      if (request.texts.length === 0) {
        return { vectors: [], provider: "gemini", model, dimensions: 0 };
      }

      if (request.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      if (gen2) {
        // Gen2: one independent embedContent() call per text.
        // The API returns exactly ONE aggregated embedding per call regardless
        // of how many Content objects are supplied in a single request.
        const prefix =
          request.purpose === "document" ? GEN2_DOC_PREFIX : GEN2_QUERY_PREFIX;
        const vectors: (readonly number[])[] = [];

        for (let i = 0; i < request.texts.length; i++) {
          if (request.signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const text = request.texts[i]!;
          const response = await client.models.embedContent({
            model,
            contents: { parts: [{ text: prefix + text }] },
          });

          const embedding = response.embeddings?.[0];
          if (!embedding?.values || embedding.values.length === 0) {
            throw new Error(
              `[gemini] embedContent returned no embedding for input ${i} (model: ${model})`,
            );
          }
          vectors.push(embedding.values as readonly number[]);
        }

        if (request.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const dimensions = vectors[0]?.length ?? 0;
        return { vectors, provider: "gemini", model, dimensions };
      } else {
        // Gen1: one batch call with the full string array + taskType.
        const taskType =
          request.purpose === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY";
        const response = await client.models.embedContent({
          model,
          contents: request.texts as unknown as string[],
          config: { taskType },
        });

        if (request.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const embeddings = response.embeddings ?? [];
        const vectors = embeddings.map((e) => (e.values ?? []) as readonly number[]);
        const dimensions = vectors[0]?.length ?? 0;
        return { vectors, provider: "gemini", model, dimensions };
      }
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createGeminiEmbeddingProvider(
  opts: GeminiEmbeddingProviderOptions,
): EmbeddingProvider {
  const client = new GoogleGenAI({ apiKey: opts.apiKey }) as unknown as MinimalGeminiClient;
  return buildProvider(client, opts.model);
}

/**
 * Testing-only factory — injects a mock client.
 * Use to verify exact request shape and call count without hitting the real API.
 */
export function createGeminiEmbeddingProviderForTesting(
  client: MinimalGeminiClient,
  model: string,
): EmbeddingProvider {
  return buildProvider(client, model);
}
