/**
 * OpenAI embedding provider.
 *
 * Uses the openai@^6 SDK already present in the project.
 * Model name is supplied by the caller — it is not hard-coded here.
 *
 * Cancellation: the OpenAI SDK's RequestOptions accept an AbortSignal which
 * propagates to the underlying fetch call.
 *
 * Batching: OpenAI accepts an array of strings as the `input` field, so a
 * single HTTP request handles the full batch.
 */
import OpenAI from "openai";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "./provider";

export interface OpenAIEmbeddingProviderOptions {
  apiKey: string;
  model: string;
  /** Override the base URL for testing with a local proxy. */
  baseURL?: string;
}

export function createOpenAIEmbeddingProvider(
  opts: OpenAIEmbeddingProviderOptions,
): EmbeddingProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    ...(opts.baseURL !== undefined ? { baseURL: opts.baseURL } : {}),
  });
  const { model } = opts;

  return {
    providerId: "openai",
    model,
    modelKey: `openai:${model}`,

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      if (request.texts.length === 0) {
        return { vectors: [], provider: "openai", model, dimensions: 0 };
      }

      const response = await client.embeddings.create(
        {
          model,
          input: request.texts as string[],
          encoding_format: "float",
        },
        { signal: request.signal },
      );

      // OpenAI returns data sorted by index field, but we sort explicitly
      // to be defensive against any future API behaviour change.
      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      const vectors = sorted.map((d) => d.embedding);
      const dimensions = vectors[0]?.length ?? 0;

      return { vectors, provider: "openai", model, dimensions };
    },
  };
}
