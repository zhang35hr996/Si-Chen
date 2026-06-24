/**
 * Validates an EmbeddingResult returned by any provider.
 *
 * Throws with a descriptive message if the provider response violates the
 * embedding contract.  Callers should let the error propagate so the
 * HybridRetriever can apply the appropriate failure mode.
 */
import type { EmbeddingResult } from "./provider";

export class EmbeddingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingValidationError";
  }
}

/**
 * Validates an EmbeddingResult after a provider call.
 *
 * @param result — the result to validate
 * @param expectedCount — the number of texts that were submitted
 */
export function validateEmbeddingResult(result: EmbeddingResult, expectedCount: number): void {
  if (result.vectors.length !== expectedCount) {
    throw new EmbeddingValidationError(
      `[embedding] cardinality mismatch: expected ${expectedCount} vectors, got ${result.vectors.length}`,
    );
  }
  if (result.dimensions < 1) {
    throw new EmbeddingValidationError(
      `[embedding] invalid dimensions: ${result.dimensions}`,
    );
  }
  for (let i = 0; i < result.vectors.length; i++) {
    const vec = result.vectors[i]!;
    if (vec.length !== result.dimensions) {
      throw new EmbeddingValidationError(
        `[embedding] vector[${i}] has ${vec.length} dimensions, expected ${result.dimensions}`,
      );
    }
    if (vec.length === 0) {
      throw new EmbeddingValidationError(
        `[embedding] vector[${i}] is empty`,
      );
    }
    let sumSq = 0;
    for (let j = 0; j < vec.length; j++) {
      const v = vec[j]!;
      if (!isFinite(v)) {
        throw new EmbeddingValidationError(
          `[embedding] vector[${i}][${j}] is non-finite: ${v}`,
        );
      }
      sumSq += v * v;
    }
    if (sumSq === 0) {
      throw new EmbeddingValidationError(
        `[embedding] vector[${i}] is a zero vector`,
      );
    }
  }
}
