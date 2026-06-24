/**
 * Cosine similarity and related vector math utilities.
 */

export class VectorMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorMathError";
  }
}

/** Returns the L2 (Euclidean) norm of a vector. Reserved for ANN pre-normalisation (PR3+). */
export function normL2(v: readonly number[]): number {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i]! * v[i]!;
  }
  return Math.sqrt(sumSq);
}

/**
 * Cosine similarity between two vectors.
 * Returns a value in [-1, 1]; 1 = identical direction, 0 = orthogonal,
 * -1 = opposite direction.
 *
 * Throws on dimension mismatch, zero vector, or non-finite values.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new VectorMathError(
      `Dimension mismatch: a has ${a.length}, b has ${b.length}`,
    );
  }
  if (a.length === 0) {
    throw new VectorMathError("Cannot compute cosine similarity of empty vectors");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (!isFinite(ai) || !isFinite(bi)) {
      throw new VectorMathError(`Non-finite value at index ${i}`);
    }
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) {
    throw new VectorMathError("Zero vector — cosine similarity is undefined");
  }
  // Clamp to [-1, 1] to guard against floating-point rounding artefacts.
  return Math.max(-1, Math.min(1, dot / denom));
}

/**
 * Returns a unit (L2-normalized) copy of the vector.
 * Throws on zero vector or non-finite values.
 * Reserved for ANN pre-normalisation (PR3+).
 */
export function normalizeVector(v: readonly number[]): number[] {
  const n = normL2(v);
  if (n === 0) {
    throw new VectorMathError("Cannot normalize a zero vector");
  }
  return v.map((x) => x / n);
}
