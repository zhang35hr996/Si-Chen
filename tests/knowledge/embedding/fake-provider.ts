/**
 * Deterministic fake EmbeddingProvider for tests.
 *
 * Produces orthogonal unit vectors keyed by the text's first character code
 * (or a custom factory function) so tests can control cosine similarity.
 *
 * Design:
 *  - Fully synchronous under the hood; wrapped in Promise to satisfy the interface.
 *  - Throws if texts is empty (mirrors provider contract).
 *  - All vectors have the same configured dimension.
 *  - Record call log for spy assertions.
 */
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
} from "../../../src/engine/knowledge/embedding/provider";

export interface FakeProviderOptions {
  providerId?: "openai" | "gemini";
  model?: string;
  dimensions?: number;
  /** If provided, called per-text to produce a vector. Must return `dimensions` values. */
  vectorFactory?: (text: string, index: number) => number[];
}

export interface FakeProviderCall {
  texts: readonly string[];
  purpose: string;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly providerId: "openai" | "gemini";
  readonly model: string;
  readonly modelKey: string;
  readonly dimensions: number;
  readonly calls: FakeProviderCall[] = [];

  private readonly vectorFactory: (text: string, index: number) => number[];

  constructor(opts: FakeProviderOptions = {}) {
    this.providerId = opts.providerId ?? "openai";
    this.model = opts.model ?? "fake-embedding-model";
    this.modelKey = `${this.providerId}:${this.model}`;
    this.dimensions = opts.dimensions ?? 4;

    const dims = this.dimensions;
    this.vectorFactory =
      opts.vectorFactory ??
      ((text, _i) => {
        // Default: one-hot-ish vector keyed by sum of char codes % dims
        const slot = [...text].reduce((s, c) => s + c.charCodeAt(0), 0) % dims;
        return Array.from({ length: dims }, (_, j) => (j === slot ? 1 : 0));
      });
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    if (request.texts.length === 0) {
      // Mirrors real provider behaviour
      return { vectors: [], provider: this.providerId, model: this.model, dimensions: this.dimensions };
    }

    this.calls.push({ texts: request.texts, purpose: request.purpose });

    const vectors = request.texts.map((t, i) => {
      const v = this.vectorFactory(t, i);
      if (v.length !== this.dimensions) {
        throw new Error(
          `FakeEmbeddingProvider: vectorFactory returned ${v.length} values, expected ${this.dimensions}`,
        );
      }
      return v as readonly number[];
    });

    return {
      vectors,
      provider: this.providerId,
      model: this.model,
      dimensions: this.dimensions,
    };
  }

  /** Reset call log between test cases. */
  resetCalls(): void {
    this.calls.length = 0;
  }
}

/**
 * Returns a factory that produces orthogonal unit vectors.
 * The i-th call gets a 1 in slot (i % dims).
 * Wrap with a counter so sequential calls don't collide.
 */
export function sequentialVectorFactory(dims: number): (text: string, index: number) => number[] {
  let counter = 0;
  return (_text, _i) => {
    const slot = counter++ % dims;
    return Array.from({ length: dims }, (_, j) => (j === slot ? 1 : 0));
  };
}
