export type { DebugTraceMode, MutationClassification, MutationRecord, StateDiffEntry, TraceSource, TraceTransaction, TraceWarning } from "./types";
export type { EligibilityFailure, EligibilityTraceEvent, MemoryOperation, MemoryTraceEvent, QueueOperation, QueueTraceEvent, RollbackTraceEvent, TraceDomainEvent } from "./domainEvents";
export { TraceCollector } from "./collector";
export { TraceHistory, DEFAULT_TRACE_HISTORY_LIMIT } from "./history";
export { diffGameState } from "./diff";
export { deriveQueueTraceEvents } from "./queueDiff";
export { captureEligibilityTransitions, explainEventEligibility } from "./eligibilityDiff";
