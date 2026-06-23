import { describe, expect, it } from "vitest";
import { FakeEmbeddingProvider, sequentialVectorFactory } from "./fake-provider";

describe("FakeEmbeddingProvider", () => {
  it("returns vectors of the configured dimension", async () => {
    const p = new FakeEmbeddingProvider({ dimensions: 8 });
    const result = await p.embed({ texts: ["hello", "world"], purpose: "document" });
    expect(result.dimensions).toBe(8);
    expect(result.vectors).toHaveLength(2);
    result.vectors.forEach((v) => expect(v).toHaveLength(8));
  });

  it("returns empty vectors for empty input without recording a call", async () => {
    const p = new FakeEmbeddingProvider();
    const result = await p.embed({ texts: [], purpose: "document" });
    expect(result.vectors).toHaveLength(0);
    expect(p.calls).toHaveLength(0);
  });

  it("records calls", async () => {
    const p = new FakeEmbeddingProvider();
    await p.embed({ texts: ["a", "b"], purpose: "query" });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.texts).toEqual(["a", "b"]);
    expect(p.calls[0]!.purpose).toBe("query");
  });

  it("respects custom vectorFactory", async () => {
    const dims = 4;
    let callCount = 0;
    const p = new FakeEmbeddingProvider({
      dimensions: dims,
      vectorFactory: (_text, _i) => {
        const v = Array(dims).fill(0) as number[];
        v[callCount++ % dims] = 1;
        return v;
      },
    });
    const result = await p.embed({ texts: ["a", "b", "c", "d"], purpose: "document" });
    expect(result.vectors[0]).toEqual([1, 0, 0, 0]);
    expect(result.vectors[1]).toEqual([0, 1, 0, 0]);
    expect(result.vectors[2]).toEqual([0, 0, 1, 0]);
    expect(result.vectors[3]).toEqual([0, 0, 0, 1]);
  });

  it("modelKey is providerId:model", () => {
    const p = new FakeEmbeddingProvider({ providerId: "gemini", model: "text-embedding-004" });
    expect(p.modelKey).toBe("gemini:text-embedding-004");
  });

  it("resetCalls empties the call log", async () => {
    const p = new FakeEmbeddingProvider();
    await p.embed({ texts: ["x"], purpose: "document" });
    p.resetCalls();
    expect(p.calls).toHaveLength(0);
  });
});

describe("sequentialVectorFactory", () => {
  it("produces orthogonal one-hot vectors cycling through dims", () => {
    const dims = 3;
    const factory = sequentialVectorFactory(dims);
    expect(factory("a", 0)).toEqual([1, 0, 0]);
    expect(factory("b", 1)).toEqual([0, 1, 0]);
    expect(factory("c", 2)).toEqual([0, 0, 1]);
    expect(factory("d", 3)).toEqual([1, 0, 0]); // wraps
  });
});
