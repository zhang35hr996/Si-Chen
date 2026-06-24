/**
 * Knowledge domain model for static world lore retrieval (RAG PR1).
 *
 * This layer is intentionally isolated from the dialogue runtime: it has no
 * knowledge of characters, game state, or claim gates.  It is advisory context
 * only — it never overrides authoritative runtime state.
 *
 * Retrieved knowledge must not grant a character access to facts above the
 * runtime-computed visibility ceiling.
 */
import type { GameTime } from "../calendar/time";

/** Category of knowledge source. */
export type KnowledgeSourceType =
  | "world_rule"
  | "etiquette"
  | "location"
  | "official_system"
  | "character_public_profile"
  | "historical_archive";

/**
 * Access level required to read a chunk.
 *   public     — open to any reader
 *   restricted — requires a specific role or context (e.g. inner-court staff)
 *   imperial   — only accessible from the sovereign's context
 */
export type KnowledgeVisibility = "public" | "restricted" | "imperial";

/** Numeric rank: higher number = more restricted. Used for ceiling comparison. */
export const VISIBILITY_RANK: Record<KnowledgeVisibility, number> = {
  public: 0,
  restricted: 1,
  imperial: 2,
};

/**
 * A single retrievable unit of world knowledge.
 *
 * Invariants (enforced by normalize.ts):
 *  - id is non-empty and stable across identical inputs
 *  - title and text are non-empty and trimmed
 *  - tags, entityIds, locationIds are sorted, de-duplicated, and contain no blank entries
 *  - if both validFrom and validUntil are set, validFrom.dayIndex <= validUntil.dayIndex
 *  - sourcePath preserves provenance
 */
export interface KnowledgeChunk {
  readonly id: string;
  readonly sourceType: KnowledgeSourceType;
  readonly title: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly entityIds: readonly string[];
  readonly locationIds: readonly string[];
  /** Inclusive lower time bound. Absent = no lower bound. */
  readonly validFrom?: GameTime;
  /** Inclusive upper time bound. Absent = no upper bound. */
  readonly validUntil?: GameTime;
  readonly visibility: KnowledgeVisibility;
  /** Original file path — preserved for debugging and provenance. */
  readonly sourcePath: string;
}

/** Mutable input shape before normalization. */
export interface KnowledgeChunkInput {
  id: string;
  sourceType: KnowledgeSourceType;
  title: string;
  text: string;
  tags: string[];
  entityIds: string[];
  locationIds: string[];
  validFrom?: GameTime;
  validUntil?: GameTime;
  visibility: KnowledgeVisibility;
  sourcePath: string;
}

/** Returns all KnowledgeVisibility values at or below the given ceiling. */
export function visibilitiesAtOrBelow(
  ceiling: KnowledgeVisibility,
): KnowledgeVisibility[] {
  const rank = VISIBILITY_RANK[ceiling];
  return (Object.keys(VISIBILITY_RANK) as KnowledgeVisibility[]).filter(
    (v) => VISIBILITY_RANK[v] <= rank,
  );
}

/**
 * Shared metadata filter type used by both keyword and vector queries.
 * "any" = OR semantics; "all" = AND semantics.
 */
export interface KnowledgeMetadataFilter {
  values: readonly string[];
  mode: "any" | "all";
}

/** Source adapter contract — each adapter is typed and explicit. */
export interface KnowledgeSourceAdapter<T> {
  canHandle(source: unknown, sourcePath: string): source is T;
  extract(source: T, sourcePath: string): KnowledgeChunkInput[];
}
