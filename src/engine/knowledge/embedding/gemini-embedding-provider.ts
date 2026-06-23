/**
 * Google Gemini embedding provider.
 *
 * Uses the @google/genai@^2 SDK already present in the project.
 * Model name is supplied by the caller (e.g. "text-embedding-004").
 *
 * Gemini's embedContent accepts an array of strings as `contents`, so a
 * single HTTP request handles the full batch.
 *
 * Cancellation: the @google/genai SDK does not expose AbortSignal on
 * embedContent; we check the signal before the call and after it completes,
 * which is the safe approximation available without monkey-patching the SDK.
 */
import { GoogleGenAI } from "@google/genai";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "./provider";

export interface GeminiEmbeddingProviderOptions {
  apiKey: string;
  model: string;
}

export function createGeminiEmbeddingProvider(
  opts: GeminiEmbeddingProviderOptions,
): EmbeddingProvider {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const { model } = opts;

  return {
    providerId: "gemini",
    model,
    modelKey: `gemini:${model}`,

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      if (request.texts.length === 0) {
        return { vectors: [], provider: "gemini", model, dimensions: 0 };
      }

      // Pre-call cancellation check.
      if (request.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // Map purpose to Gemini task type.
      const taskType = request.purpose === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY";

      const response = await ai.models.embedContent({
        model,
        contents: request.texts as string[],
        config: { taskType },
      });

      // Post-call cancellation check (SDK does not thread the signal into fetch).
      if (request.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const embeddings = response.embeddings ?? [];
      const vectors = embeddings.map((e) => e.values ?? []);
      const dimensions = vectors[0]?.length ?? 0;

      return { vectors, provider: "gemini", model, dimensions };
    },
  };
}
