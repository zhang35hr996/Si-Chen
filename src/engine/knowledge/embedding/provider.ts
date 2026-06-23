/**
 * Provider-neutral embedding contract.
 *
 * Deliberately decoupled from any specific SDK so the vector index and hybrid
 * retriever never import OpenAI or Gemini types directly.
 */

export type EmbeddingPurpose = "document" | "query";

export interface EmbeddingRequest {
  /** Texts to embed. Empty array must return immediately without a network call. */
  readonly texts: readonly string[];
  /** Hint to the provider (some APIs use different endpoints or task types). */
  readonly purpose: EmbeddingPurpose;
  /** Caller-supplied cancellation signal. */
  readonly signal?: AbortSignal;
}

export interface EmbeddingResult {
  /** vectors[i] corresponds to request.texts[i]. Length === request.texts.length. */
  readonly vectors: ReadonlyArray<readonly number[]>;
  readonly provider: "openai" | "gemini";
  readonly model: string;
  /** Number of dimensions — all vectors in this result share the same value. */
  readonly dimensions: number;
}

export interface EmbeddingProvider {
  readonly providerId: "openai" | "gemini";
  readonly model: string;
  /**
   * Stable cache key: `${providerId}:${model}`.
   * Used as the first component of the SQLite cache primary key.
   */
  readonly modelKey: string;

  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
