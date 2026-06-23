/**
 * Deterministic fake EmbeddingProvider for tests.
 *
 * Features:
 *  - `defineVector(text, vector)` — pin a specific output for a known text.
 *  - Default factory: one-hot vector keyed by char-code-sum mod dims.
 *  - `sequentialVectorFactory` helper for orthogonal per-call vectors.
 *  - Call log for spy assertions.
 *  - Optional `throwOnEmbed` to simulate provider failure.
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
  /**
   * Custom factory — called per text when no pre-defined vector exists.
   * Must return exactly `dimensions` values.
   */
  vectorFactory?: (text: string, index: number) => number[];
  /** When set, embed() throws this error (or a new Error(throwOnEmbed) if string). */
  throwOnEmbed?: Error | string;
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
  private readonly pinnedVectors = new Map<string, number[]>();
  private readonly throwOnEmbed: Error | string | undefined;

  constructor(opts: FakeProviderOptions = {}) {
    this.providerId = opts.providerId ?? "openai";
    this.model = opts.model ?? "fake-embedding-model";
    this.modelKey = `${this.providerId}:${this.model}`;
    this.dimensions = opts.dimensions ?? 4;
    this.throwOnEmbed = opts.throwOnEmbed;

    const dims = this.dimensions;
    this.vectorFactory =
      opts.vectorFactory ??
      ((text, _i) => {
        const slot = [...text].reduce((s, c) => s + c.charCodeAt(0), 0) % dims;
        return Array.from({ length: dims }, (_, j) => (j === slot ? 1 : 0));
      });
  }

  /**
   * Pre-pins the vector returned for a specific text.
   * Overrides the vectorFactory for this text.
   */
  defineVector(text: string, vector: number[]): void {
    if (vector.length !== this.dimensions) {
      throw new Error(
        `FakeEmbeddingProvider.defineVector: vector length ${vector.length} ≠ dimensions ${this.dimensions}`,
      );
    }
    this.pinnedVectors.set(text, vector);
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    if (this.throwOnEmbed !== undefined) {
      throw typeof this.throwOnEmbed === "string"
        ? new Error(this.throwOnEmbed)
        : this.throwOnEmbed;
    }

    if (request.texts.length === 0) {
      return { vectors: [], provider: this.providerId, model: this.model, dimensions: this.dimensions };
    }

    this.calls.push({ texts: request.texts, purpose: request.purpose });

    const vectors = request.texts.map((t, i) => {
      const pinned = this.pinnedVectors.get(t);
      if (pinned) return pinned as readonly number[];
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
 * Returns a factory that produces orthogonal one-hot vectors cycling through dims.
 * The i-th invocation (by counter, not by index) gets a 1 in slot (counter % dims).
 */
export function sequentialVectorFactory(dims: number): (text: string, index: number) => number[] {
  let counter = 0;
  return (_text, _i) => {
    const slot = counter++ % dims;
    return Array.from({ length: dims }, (_, j) => (j === slot ? 1 : 0));
  };
}
