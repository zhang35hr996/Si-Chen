/** PR2 — semantic domain-level events collected alongside state mutations. */

export type MemoryOperation = "created" | "propagated";

export type QueueOperation =
  | "enqueued"
  | "dequeued"
  | "resolved"
  | "cancelled"
  | "rescheduled"
  | "replaced";

export interface MemoryTraceEvent {
  kind: "memory";
  operation: MemoryOperation;
  ownerId: string;
  entryId: string;
  /** Court event ID that caused this memory, when known. */
  sourceCourtEventId?: string;
  summary?: string;
  recipientReason?: string;
  effectType?: string;
  effectIndex?: number;
  phase: string;
}

export interface QueueTraceEvent {
  kind: "queue";
  queue: string;
  operation: QueueOperation;
  itemId: string;
  itemType?: string;
  resolution?: "approved" | "retained" | "rejected";
  reason?: string;
  phase: string;
}

export interface EligibilityFailure {
  conditionType: string;
  expected?: unknown;
  actual?: unknown;
  subjectId?: string;
  path?: string;
}

export interface EligibilityTraceEvent {
  kind: "eligibility";
  eventId: string;
  transition: "became_eligible" | "became_ineligible";
  /** Conditions that caused ineligibility before the transaction. */
  failedBefore: EligibilityFailure[];
  /** Conditions that cause ineligibility after the transaction. */
  failedAfter: EligibilityFailure[];
  phase: string;
}

export interface RollbackTraceEvent {
  kind: "rollback";
  failedPhase: string;
  errorCode?: string;
  message: string;
  /** Mutation records that were attempted but not committed. */
  attemptedMutationCount: number;
  /** Domain events that were attempted but not committed. */
  attemptedDomainEventCount: number;
  phase: string;
}

export type TraceDomainEvent =
  | MemoryTraceEvent
  | QueueTraceEvent
  | EligibilityTraceEvent
  | RollbackTraceEvent;
