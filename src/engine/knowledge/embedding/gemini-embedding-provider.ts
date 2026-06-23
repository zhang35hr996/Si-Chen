/**
 * Google Gemini embedding provider.
 *
 * Supports two model families with different request shapes:
 *
 *   Gen1 — "gemini-embedding-001" and legacy "text-embedding-*":
 *     contents: string[]  (the SDK accepts a string array for the whole batch)
 *     config: { taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" }
 *
 *   Gen2 — "gemini-embedding-2" and future "gemini-embedding-*":
 *     Each text is wrapped in its own Content object.
 *     Task intent is expressed through a retrieval prefix prepended to the text.
 *     No config.taskType (not supported by this model family).
 *
 * Cancellation: @google/genai v2 embedContent does not thread AbortSignal into
 * its underlying fetch; we check the signal before and after the SDK call.
 * A completed network call that is caught by the post-check is charged to the
 * user but not persisted (syncEmbeddings writes only after all batches succeed).
 *
 * Testing: use createGeminiEmbeddingProviderForTesting() to inject a mock client
 * that captures outbound request parameters for shape verification.
 */
import { GoogleGenAI } from "@google/genai";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "./provider";

export interface GeminiEmbeddingProviderOptions {
  apiKey: string;
  model: string;
}

// ── Minimal structural client type ────────────────────────────────────────────
// Used by both the real SDK client and test mocks.

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
  // Matches: gemini-embedding-2, gemini-embedding-2-preview-*, etc.
  return /^gemini-embedding-2/i.test(model);
}

// Retrieval prefixes used by gen2 models in place of taskType.
const GEN2_DOC_PREFIX = "Represent this document for retrieval: ";
const GEN2_QUERY_PREFIX = "Represent this query for retrieval: ";

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

      let response: { embeddings?: Array<{ values?: number[] }> };

      if (gen2) {
        // Gen2: one Content object per text + retrieval prefix; no taskType.
        const prefix =
          request.purpose === "document" ? GEN2_DOC_PREFIX : GEN2_QUERY_PREFIX;
        const contents = request.texts.map((text) => ({
          parts: [{ text: prefix + text }],
        }));
        response = await client.models.embedContent({ model, contents });
      } else {
        // Gen1: string array + taskType.
        const taskType =
          request.purpose === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY";
        response = await client.models.embedContent({
          model,
          contents: request.texts as unknown as string[],
          config: { taskType },
        });
      }

      if (request.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const embeddings = response.embeddings ?? [];
      const vectors = embeddings.map((e) => (e.values ?? []) as readonly number[]);
      const dimensions = vectors[0]?.length ?? 0;

      return { vectors, provider: "gemini", model, dimensions };
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
 * Testing-only factory that accepts a mock client.
 * Lets tests inspect the exact request shape sent to the SDK.
 */
export function createGeminiEmbeddingProviderForTesting(
  client: MinimalGeminiClient,
  model: string,
): EmbeddingProvider {
  return buildProvider(client, model);
}
