import { describe, expect, it } from "vitest";
import { cosineSimilarity, normL2, normalizeVector, VectorMathError } from "../../../src/engine/knowledge/vector/cosine";

describe("normL2", () => {
  it("computes correct L2 norm", () => {
    expect(normL2([3, 4])).toBeCloseTo(5, 10);
    expect(normL2([1, 0, 0])).toBeCloseTo(1, 10);
    expect(normL2([0, 0, 0])).toBeCloseTo(0, 10);
  });
});

describe("normalizeVector", () => {
  it("returns unit vector", () => {
    const n = normalizeVector([3, 4]);
    expect(normL2(n)).toBeCloseTo(1, 10);
  });

  it("throws on zero vector", () => {
    expect(() => normalizeVector([0, 0, 0])).toThrow(VectorMathError);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("clamps to [-1, 1] (no floating-point overflow)", () => {
    // These unit vectors should produce exactly 1.0; verify clamping doesn't break them
    const v = [1 / Math.sqrt(2), 1 / Math.sqrt(2)];
    const result = cosineSimilarity(v, v);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("throws VectorMathError on dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(VectorMathError);
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/mismatch/i);
  });

  it("throws VectorMathError on empty vectors", () => {
    expect(() => cosineSimilarity([], [])).toThrow(VectorMathError);
  });

  it("throws VectorMathError on non-finite values", () => {
    expect(() => cosineSimilarity([1, NaN], [1, 2])).toThrow(VectorMathError);
    expect(() => cosineSimilarity([Infinity, 1], [1, 2])).toThrow(VectorMathError);
  });

  it("throws VectorMathError on zero vector input", () => {
    expect(() => cosineSimilarity([0, 0, 0], [1, 2, 3])).toThrow(VectorMathError);
    expect(() => cosineSimilarity([0, 0, 0], [1, 2, 3])).toThrow(/zero vector/i);
  });

  it("works with high-dimensional vectors", () => {
    const dims = 1536;
    const a = Array.from({ length: dims }, () => Math.random());
    const score = cosineSimilarity(a, a);
    expect(score).toBeCloseTo(1, 5);
  });
});
