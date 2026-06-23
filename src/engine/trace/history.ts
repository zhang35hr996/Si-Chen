import type { TraceTransaction } from "./types";

export const DEFAULT_TRACE_HISTORY_LIMIT = 200;

/**
 * Ring-buffer of TraceTransactions (dev-only runtime state, never persisted).
 * One transaction = one atomic store operation (applyEffects, resolveEvent, etc.).
 *
 * Immutable snapshot semantics: `getAll()` returns the same reference between
 * mutations, and a new reference after each `push`/`clear`. Safe for
 * React's `useSyncExternalStore`.
 */
export class TraceHistory {
  private _txs: readonly TraceTransaction[] = [];
  private _seq = 0;
  private _version = 0;
  private readonly _listeners = new Set<() => void>();

  constructor(readonly limit: number = DEFAULT_TRACE_HISTORY_LIMIT) {}

  nextId(): string {
    return `#${++this._seq}`;
  }

  push(tx: TraceTransaction): void {
    const next = [...this._txs, tx];
    if (next.length > this.limit) next.splice(0, next.length - this.limit);
    this._txs = next;
    this._version++;
    for (const l of this._listeners) l();
  }

  getAll(): readonly TraceTransaction[] {
    return this._txs;
  }

  clear(): void {
    this._txs = [];
    this._version++;
    for (const l of this._listeners) l();
  }

  /** Monotonically increasing counter — increments on every push/clear. */
  getVersion(): number {
    return this._version;
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  get size(): number {
    return this._txs.length;
  }
}
