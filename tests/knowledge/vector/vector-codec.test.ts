import { describe, expect, it } from "vitest";
import { decodeVector, encodeVector, VectorCodecError } from "../../../src/engine/knowledge/vector/vector-codec";

describe("encodeVector / decodeVector round-trip", () => {
  it("round-trips a simple vector", () => {
    const v = [0.1, 0.2, 0.3, 0.4];
    const decoded = decodeVector(encodeVector(v), v.length);
    decoded.forEach((x, i) => expect(x).toBeCloseTo(v[i]!, 5));
  });

  it("encodes each element in 4 bytes", () => {
    const v = [1, 2, 3];
    expect(encodeVector(v).length).toBe(12);
  });

  it("handles 1-element vectors", () => {
    const v = [42];
    expect(decodeVector(encodeVector(v), 1)[0]).toBeCloseTo(42, 4);
  });

  it("handles negative values", () => {
    const v = [-1, -0.5, 0, 0.5, 1];
    const decoded = decodeVector(encodeVector(v), v.length);
    decoded.forEach((x, i) => expect(x).toBeCloseTo(v[i]!, 5));
  });

  it("handles large high-dimensional vectors", () => {
    const dims = 1536;
    const v = Array.from({ length: dims }, (_, i) => Math.sin(i * 0.01));
    const decoded = decodeVector(encodeVector(v), dims);
    decoded.forEach((x, i) => expect(x).toBeCloseTo(v[i]!, 4));
  });
});

describe("encodeVector errors", () => {
  it("throws VectorCodecError for empty vector", () => {
    expect(() => encodeVector([])).toThrow(VectorCodecError);
  });

  it("throws VectorCodecError for NaN", () => {
    expect(() => encodeVector([1, NaN, 3])).toThrow(VectorCodecError);
  });

  it("throws VectorCodecError for Infinity", () => {
    expect(() => encodeVector([Infinity])).toThrow(VectorCodecError);
    expect(() => encodeVector([-Infinity])).toThrow(VectorCodecError);
  });
});

describe("decodeVector errors", () => {
  it("throws VectorCodecError on byte length mismatch", () => {
    const blob = Buffer.allocUnsafe(8); // 2 floats
    expect(() => decodeVector(blob, 3)).toThrow(VectorCodecError); // expects 12 bytes
  });
});
