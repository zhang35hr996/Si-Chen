import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../../../src/engine/knowledge/retrieval/reciprocal-rank-fusion";
import type { RrfInput } from "../../../src/engine/knowledge/retrieval/reciprocal-rank-fusion";

function mkHit(
  chunkId: string,
  kwRank: number | null,
  vecRank: number | null,
): RrfInput {
  return {
    chunkId,
    keywordRank: kwRank,
    keywordScore: kwRank !== null ? 1 / kwRank : null,
    vectorRank: vecRank,
    cosineScore: vecRank !== null ? 1 / vecRank : null,
  };
}

describe("reciprocalRankFusion", () => {
  it("returns empty array for empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("assigns fusedRank starting at 1", () => {
    const hits = [mkHit("a", 1, null), mkHit("b", 2, null)];
    const out = reciprocalRankFusion(hits);
    expect(out[0]!.fusedRank).toBe(1);
    expect(out[1]!.fusedRank).toBe(2);
  });

  it("computes hybrid score as kw/(k+kwRank) + vec/(k+vecRank)", () => {
    const hit = mkHit("a", 1, 2);
    const [out] = reciprocalRankFusion([hit], { k: 60 });
    const expected = 1 / (60 + 1) + 1 / (60 + 2);
    expect(out!.hybridScore).toBeCloseTo(expected, 10);
  });

  it("chunk appearing in both channels scores higher than keyword-only", () => {
    const both = mkHit("both", 1, 1);
    const kwOnly = mkHit("kw", 1, null);
    const [first, second] = reciprocalRankFusion([kwOnly, both]);
    expect(first!.chunkId).toBe("both");
    expect(first!.hybridScore).toBeGreaterThan(second!.hybridScore);
  });

  it("keyword-only hit has null vecRank, vector-only hit has null kwRank", () => {
    const kw = mkHit("kw", 2, null);
    const vec = mkHit("vec", null, 2);
    const out = reciprocalRankFusion([kw, vec]);
    const kwOut = out.find((h) => h.chunkId === "kw")!;
    const vecOut = out.find((h) => h.chunkId === "vec")!;
    expect(kwOut.vectorRank).toBeNull();
    expect(vecOut.keywordRank).toBeNull();
  });

  it("respects custom k and weights", () => {
    const hit = mkHit("a", 1, 1);
    const [out] = reciprocalRankFusion([hit], { k: 10, keywordWeight: 2, vectorWeight: 0.5 });
    const expected = 2 / (10 + 1) + 0.5 / (10 + 1);
    expect(out!.hybridScore).toBeCloseTo(expected, 10);
  });

  // ── Tie-break determinism ────────────────────────────────────────────────────

  it("tie-break: equal hybrid score and equal bestRank → code-point ascending", () => {
    // kwRank=1, vecRank=null for both → identical hybridScore and bestRank=1
    const x = mkHit("x", 1, null);
    const y = { ...x, chunkId: "y" }; // same hybrid score, same bestRank
    const out = reciprocalRankFusion([y, x]); // deliberately reversed input
    // 'x' (0x78) < 'y' (0x79) → "x" sorts first
    expect(out[0]!.chunkId).toBe("x");
    expect(out[1]!.chunkId).toBe("y");
  });

  it("tie-break 2: equal hybrid score, better component rank wins", () => {
    // a appears at kwRank=1 (bestRank=1); b appears at kwRank=3 (bestRank=3)
    // Force equal hybrid scores by using same weight: 1/(k+1) === 1/(k+1) only if same rank.
    // Use different kwRank but same hybridScore by pairing kw+vec so sums match:
    // a: kw=1, vec=3 → 1/61 + 1/63
    // b: kw=3, vec=1 → 1/63 + 1/61 (same score!)
    const a = mkHit("a", 1, 3);
    const b = mkHit("b", 3, 1);
    const out = reciprocalRankFusion([b, a], { k: 60 });
    // hybridScores equal; bestRank(a)=min(1,3)=1 < bestRank(b)=min(3,1)=1 → also equal!
    // Fall through to chunkId code-point: "a" < "b" → "a" first
    expect(out[0]!.chunkId).toBe("a");
    expect(out[1]!.chunkId).toBe("b");
  });

  it("tie-break 2: different bestRank wins over code-point order", () => {
    // "a_high_rank" at kwRank=1 scores higher than "z_low_rank" at kwRank=5
    // even though "a" < "z" alphabetically. Hybrid score takes priority.
    const high = mkHit("z_low_rank", 5, null); // hybridScore = 1/65
    const low = mkHit("a_high_rank", 1, null);  // hybridScore = 1/61 — higher score, wins
    const out = reciprocalRankFusion([high, low], { k: 60 });
    expect(out[0]!.chunkId).toBe("a_high_rank");
  });

  it("tie-break 3: same score and bestRank → code-point ascending", () => {
    const z = mkHit("z", 1, null);
    const a = mkHit("a", 1, null);
    const m = mkHit("m", 1, null);
    const out = reciprocalRankFusion([z, m, a], { k: 60 });
    expect(out.map((h) => h.chunkId)).toEqual(["a", "m", "z"]);
  });

  it("preserves original input fields on output", () => {
    const hit = mkHit("c1", 2, 3);
    const [out] = reciprocalRankFusion([hit]);
    expect(out!.chunkId).toBe("c1");
    expect(out!.keywordRank).toBe(2);
    expect(out!.vectorRank).toBe(3);
    expect(out!.keywordScore).toBeCloseTo(0.5, 5);
  });
});
