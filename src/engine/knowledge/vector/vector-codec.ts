/**
 * Compact binary encoding for embedding vectors.
 *
 * Format: little-endian 32-bit float array (IEEE 754).
 * Each element uses 4 bytes → a 1536-dim vector = 6144 bytes.
 *
 * Float32 has ~7 significant decimal digits; embeddings are typically
 * produced at float32 precision, so no information is lost.
 */

export class VectorCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorCodecError";
  }
}

/**
 * Encodes a vector to a little-endian Float32 Buffer.
 * Throws if any value is non-finite.
 */
export function encodeVector(vector: readonly number[]): Buffer {
  if (vector.length === 0) {
    throw new VectorCodecError("Cannot encode empty vector");
  }
  const buf = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    const v = vector[i]!;
    if (!isFinite(v)) {
      throw new VectorCodecError(`Non-finite value at index ${i}: ${v}`);
    }
    buf.writeFloatLE(v, i * 4);
  }
  return buf;
}

/**
 * Decodes a little-endian Float32 Buffer back to a number[].
 * Throws if the byte length does not match `dimensions * 4`.
 */
export function decodeVector(blob: Buffer, dimensions: number): number[] {
  const expectedBytes = dimensions * 4;
  if (blob.length !== expectedBytes) {
    throw new VectorCodecError(
      `Malformed BLOB: expected ${expectedBytes} bytes for ${dimensions} dimensions, got ${blob.length}`,
    );
  }
  const vector: number[] = new Array(dimensions) as number[];
  for (let i = 0; i < dimensions; i++) {
    vector[i] = blob.readFloatLE(i * 4);
  }
  return vector;
}
