/**
 * Weighted Reciprocal Rank Fusion (RRF).
 *
 * Combines ranked results from two independent retrieval channels (keyword and
 * vector) into a single ranked list.  Each hit receives a score contribution
 * from every channel in which it appears:
 *
 *   score = kwWeight / (k + kwRank) + vecWeight / (k + vecRank)
 *
 * A hit that does not appear in a channel contributes 0 from that channel.
 *
 * Tie-break order (deterministic):
 *   1. hybridScore descending
 *   2. min(kwRank, vecRank) ascending   — whichever component ranked it higher
 *   3. chunk ID code-point ascending     — stable alphabetic
 */

export interface RrfInput {
  readonly chunkId: string;
  /** 1-based rank in keyword results, or null if absent. */
  readonly keywordRank: number | null;
  readonly keywordScore: number | null;
  /** 1-based rank in vector results, or null if absent. */
  readonly vectorRank: number | null;
  readonly cosineScore: number | null;
}

export interface RrfOutput extends RrfInput {
  readonly hybridScore: number;
  /** 1-based rank in the fused list. */
  readonly fusedRank: number;
}

export interface RrfOptions {
  /** RRF constant k.  Default 60. */
  readonly k?: number;
  /** Weight for keyword term.  Default 1. */
  readonly keywordWeight?: number;
  /** Weight for vector term.  Default 1. */
  readonly vectorWeight?: number;
}

/**
 * Fuses two ranked lists via weighted RRF.
 *
 * @param hits  Merged hit list; may contain keyword-only, vector-only, or both.
 */
export function reciprocalRankFusion(hits: readonly RrfInput[], opts: RrfOptions = {}): RrfOutput[] {
  const k = opts.k ?? 60;
  const kwW = opts.keywordWeight ?? 1;
  const vecW = opts.vectorWeight ?? 1;

  if (!isFinite(k) || k <= 0) {
    throw new RangeError(`[reciprocalRankFusion] k must be finite and > 0, got ${k}`);
  }
  if (!isFinite(kwW) || kwW < 0) {
    throw new RangeError(`[reciprocalRankFusion] keywordWeight must be finite and ≥ 0, got ${kwW}`);
  }
  if (!isFinite(vecW) || vecW < 0) {
    throw new RangeError(`[reciprocalRankFusion] vectorWeight must be finite and ≥ 0, got ${vecW}`);
  }
  if (kwW === 0 && vecW === 0) {
    throw new RangeError(`[reciprocalRankFusion] at least one weight must be > 0`);
  }

  const scored: RrfOutput[] = hits.map((hit) => {
    const kwScore = hit.keywordRank !== null ? kwW / (k + hit.keywordRank) : 0;
    const vScore = hit.vectorRank !== null ? vecW / (k + hit.vectorRank) : 0;
    return { ...hit, hybridScore: kwScore + vScore, fusedRank: 0 };
  });

  // Deterministic sort
  scored.sort((a, b) => {
    if (b.hybridScore !== a.hybridScore) return b.hybridScore - a.hybridScore;

    // Best component rank ascending (lower rank = better)
    const aBest = bestRank(a.keywordRank, a.vectorRank);
    const bBest = bestRank(b.keywordRank, b.vectorRank);
    if (aBest !== bBest) return aBest - bBest;

    // Stable: chunk ID code-point ascending
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });

  // Assign 1-based fused ranks
  for (let i = 0; i < scored.length; i++) {
    scored[i] = { ...scored[i]!, fusedRank: i + 1 };
  }

  return scored;
}

function bestRank(a: number | null, b: number | null): number {
  if (a !== null && b !== null) return Math.min(a, b);
  if (a !== null) return a;
  if (b !== null) return b;
  return Infinity;
}
