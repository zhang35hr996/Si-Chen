import type { MutationClassification, MutationRecord, TraceWarning } from "./types";

/**
 * Collects per-effect mutation records during a single trace transaction.
 * Passed optionally into applyEffects() via EffectContext; no-ops when absent.
 * Must not change game behaviour — pure observation only.
 */
export class TraceCollector {
  private readonly _mutations: MutationRecord[] = [];
  private readonly _warnings: TraceWarning[] = [];
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

  /** Record a single field mutation. Call before AND after the mutation, passing before/after values. */
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
    // Skip no-ops — value didn't actually change (e.g. capped to same value).
    if (mut.before === mut.after) return;
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

  getMutations(): readonly MutationRecord[] {
    return this._mutations;
  }

  getWarnings(): readonly TraceWarning[] {
    return this._warnings;
  }
}
