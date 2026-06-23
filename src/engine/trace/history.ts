import type { TraceTransaction } from "./types";

export const DEFAULT_TRACE_HISTORY_LIMIT = 200;

/**
 * Ring-buffer of TraceTransactions (dev-only runtime state, never persisted).
 * One transaction = one atomic store operation (applyEffects, resolveEvent, etc.).
 */
export class TraceHistory {
  private readonly _txs: TraceTransaction[] = [];
  private _seq = 0;

  constructor(readonly limit: number = DEFAULT_TRACE_HISTORY_LIMIT) {}

  nextId(): string {
    return `#${++this._seq}`;
  }

  push(tx: TraceTransaction): void {
    this._txs.push(tx);
    if (this._txs.length > this.limit) {
      this._txs.splice(0, this._txs.length - this.limit);
    }
  }

  getAll(): readonly TraceTransaction[] {
    return this._txs;
  }

  clear(): void {
    this._txs.length = 0;
  }

  get size(): number {
    return this._txs.length;
  }
}
