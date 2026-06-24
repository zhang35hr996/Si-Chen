/** Development Effect Inspector – shared types (dev-only, tree-shaken in prod). */

export type DebugTraceMode = "off" | "record" | "strict";

/** Classification of a recorded mutation. */
export type MutationClassification =
  | "direct"     // caused by an explicit EventEffect in the batch
  | "derived"    // caused by a post-batch invariant repair (e.g. acting_consort demotion)
  | "scheduled"  // caused by a sweep / timed expiry (e.g. confinement sweep)
  | "untracked"; // detected by boundary diff but not attributed to any known effect

export interface MutationRecord {
  /** EventEffect.type of the causing effect, if known. */
  effectType?: string;
  /** Index of the effect in the batch, if this is a direct mutation. */
  effectIndex?: number;
  /** Dot-notation path into GameState, e.g. "standing.guQingchu.favor". */
  path: string;
  before: unknown;
  after: unknown;
  /** Numeric delta (after - before), when both are numbers. */
  delta?: number;
  /** Human-readable explanation, e.g. "favor +3 (capped from +5)". */
  reason?: string;
  classification: MutationClassification;
  /** Active phase label when this mutation was recorded. */
  phase: string;
}

export interface TraceSource {
  kind:
    | "choice"
    | "action"
    | "event"
    | "imperial_command"
    | "harem_admin"
    | "time_advance"
    | "debug"
    | "system";
  /** eventId, commandType, etc. */
  sourceId?: string;
  /** Human-readable label shown in the UI. */
  label: string;
}

export interface TraceWarning {
  message: string;
  path?: string;
}

export interface TraceTransaction {
  /** Sequential id, e.g. "#1". */
  id: string;
  timestamp: number;
  source: TraceSource;
  mutations: MutationRecord[];
  warnings: TraceWarning[];
  outcome: "committed" | "rolled_back";
  /** Error message if rolled back. */
  error?: string;
  /** Formatted game time at the point of commit. */
  gameTime?: string;
  /** Total direct mutations (excluding untracked). */
  directCount: number;
  /** Total untracked mutations detected by boundary diff. */
  untrackedCount: number;
}

/** A single entry from the boundary diff. */
export interface StateDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}
