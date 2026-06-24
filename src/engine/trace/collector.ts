import type {
  EligibilityTraceEvent,
  MemoryTraceEvent,
  QueueTraceEvent,
  RollbackTraceEvent,
  TraceDomainEvent,
} from "./domainEvents";
import type { MutationClassification, MutationRecord, StateDiffEntry, TraceWarning } from "./types";

/**
 * Collects per-effect mutation records during a single trace transaction.
 * Passed optionally into applyEffects() via EffectContext; no-ops when absent.
 * Must not change game behaviour — pure observation only.
 */
export class TraceCollector {
  private readonly _mutations: MutationRecord[] = [];
  private readonly _warnings: TraceWarning[] = [];
  private readonly _domainEvents: TraceDomainEvent[] = [];
  private _phase = "effects";

  get currentPhase(): string {
    return this._phase;
  }

  /**
   * Run `fn` with `phase` as the active phase label, then restore.
   * All mutations recorded inside fn will carry this phase label.
   */
  withPhase<T>(phase: string, fn: () => T): T {
    const prev = this._phase;
    this._phase = phase;
    try {
      return fn();
    } finally {
      this._phase = prev;
    }
  }

  /**
   * Record expected side-effects of a known phase as `scheduled` mutations.
   * Diffs are provided by the caller (typically from `diffGameState`).
   * Paths already recorded (by funnel) are skipped to avoid duplicates.
   */
  capturePhaseScheduled(phase: string, diffs: readonly StateDiffEntry[]): void {
    const trackedPaths = new Set(this._mutations.map((m) => m.path));
    for (const d of diffs) {
      if (trackedPaths.has(d.path)) continue;
      const delta =
        typeof d.before === "number" && typeof d.after === "number"
          ? d.after - d.before
          : undefined;
      this._mutations.push({
        path: d.path,
        before: d.before,
        after: d.after,
        delta,
        classification: "scheduled",
        phase,
      });
      trackedPaths.add(d.path);
    }
  }

  /**
   * Attribute all diffs produced by one effect to that effect.
   * Called with the per-effect diff (structuredClone before → state after).
   * All entries are classified as "direct" with the effect's type and index.
   */
  captureEffectDiff(
    effectType: string,
    effectIndex: number,
    diffs: readonly StateDiffEntry[],
    reason?: string,
  ): void {
    for (const d of diffs) {
      const delta =
        typeof d.before === "number" && typeof d.after === "number"
          ? d.after - d.before
          : undefined;
      this._mutations.push({
        effectType,
        effectIndex,
        path: d.path,
        before: d.before,
        after: d.after,
        delta,
        reason,
        classification: "direct",
        phase: this._phase,
      });
    }
  }

  /**
   * Attribute post-batch invariant mutations (classification "derived").
   * Used for structural state repairs that happen after the effect loop.
   */
  captureDerivedDiff(phase: string, diffs: readonly StateDiffEntry[]): void {
    for (const d of diffs) {
      const delta =
        typeof d.before === "number" && typeof d.after === "number"
          ? d.after - d.before
          : undefined;
      this._mutations.push({
        path: d.path,
        before: d.before,
        after: d.after,
        delta,
        classification: "derived",
        phase,
      });
    }
  }

  /**
   * Record a single field mutation. Call before AND after the mutation, passing
   * before/after values. Skips semantic no-ops (equal values).
   */
  record(mut: {
    effectType?: string;
    effectIndex?: number;
    path: string;
    before: unknown;
    after: unknown;
    delta?: number;
    reason?: string;
    classification?: MutationClassification;
  }): void {
    if (semanticEq(mut.before, mut.after)) return;
    this._mutations.push({
      effectType: mut.effectType,
      effectIndex: mut.effectIndex,
      path: mut.path,
      before: mut.before,
      after: mut.after,
      delta: mut.delta,
      reason: mut.reason,
      classification: mut.classification ?? "direct",
      phase: this._phase,
    });
  }

  warn(message: string, path?: string): void {
    this._warnings.push({ message, path });
  }

  recordDomainEvent(event: TraceDomainEvent): void {
    this._domainEvents.push(cloneDomainEvent(event));
  }

  recordMemoryEvent(event: Omit<MemoryTraceEvent, "kind">): void {
    this._domainEvents.push({ kind: "memory", ...event });
  }

  recordQueueEvent(event: Omit<QueueTraceEvent, "kind">): void {
    this._domainEvents.push({ kind: "queue", ...event });
  }

  recordEligibilityEvent(event: Omit<EligibilityTraceEvent, "kind">): void {
    this._domainEvents.push({
      kind: "eligibility",
      ...event,
      failedBefore: [...event.failedBefore],
      failedAfter: [...event.failedAfter],
    });
  }

  /** Record a rollback with phase attribution and counts of attempted work. */
  fail(failedPhase: string, error: { message: string; code?: string } | { message: string; code?: string }[] | string): void {
    let message: string;
    let errorCode: string | undefined;
    if (typeof error === "string") {
      message = error;
    } else if (Array.isArray(error)) {
      message = error.map((e) => e.message).join("; ");
      errorCode = error[0]?.code;
    } else {
      message = error.message;
      errorCode = error.code;
    }
    const rollback: RollbackTraceEvent = {
      kind: "rollback",
      failedPhase,
      ...(errorCode !== undefined ? { errorCode } : {}),
      message,
      attemptedMutationCount: this._mutations.length,
      attemptedDomainEventCount: this._domainEvents.length,
      phase: this._phase,
    };
    this._domainEvents.push(rollback);
  }

  getMutations(): readonly MutationRecord[] {
    return this._mutations;
  }

  getWarnings(): readonly TraceWarning[] {
    return this._warnings;
  }

  getDomainEvents(): readonly TraceDomainEvent[] {
    return this._domainEvents;
  }
}

function cloneDomainEvent(event: TraceDomainEvent): TraceDomainEvent {
  if (event.kind === "eligibility") {
    return { ...event, failedBefore: [...event.failedBefore], failedAfter: [...event.failedAfter] };
  }
  return { ...event };
}

/** Semantic equality: reference equality for primitives, JSON-compare for objects. */
function semanticEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}
