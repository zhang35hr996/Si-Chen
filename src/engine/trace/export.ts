/**
 * Deterministic trace export utilities (PR3, dev-only).
 * Exports only trace data — no GameState, no ContentDB, no credentials.
 * Output ordering is stable. No automatic network transmission.
 */
import type { TraceTransaction } from "./types";

export type TraceExportScope = "selected" | "filtered" | "history";

export interface TraceExportEnvelope {
  schemaVersion: 1;
  exportedAt: string;
  scope: TraceExportScope;
  transactionCount: number;
  transactions: TraceTransaction[];
}

/** Build the export envelope. Inputs are not mutated. */
export function buildTraceExport(
  transactions: readonly TraceTransaction[],
  scope: TraceExportScope,
): TraceExportEnvelope {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scope,
    transactionCount: transactions.length,
    // Spread into a plain array for stable serialization; preserve insertion order.
    transactions: transactions.map((tx) => ({
      id: tx.id,
      timestamp: tx.timestamp,
      source: { ...tx.source },
      outcome: tx.outcome,
      ...(tx.error !== undefined ? { error: tx.error } : {}),
      ...(tx.gameTime !== undefined ? { gameTime: tx.gameTime } : {}),
      directCount: tx.directCount,
      untrackedCount: tx.untrackedCount,
      mutations: tx.mutations.map((m) => ({
        path: m.path,
        before: safeValue(m.before),
        after: safeValue(m.after),
        ...(m.delta !== undefined ? { delta: m.delta } : {}),
        ...(m.effectType !== undefined ? { effectType: m.effectType } : {}),
        ...(m.effectIndex !== undefined ? { effectIndex: m.effectIndex } : {}),
        ...(m.reason !== undefined ? { reason: m.reason } : {}),
        classification: m.classification,
        phase: m.phase,
      })),
      warnings: tx.warnings.map((w) => ({
        message: w.message,
        ...(w.path !== undefined ? { path: w.path } : {}),
      })),
      domainEvents: tx.domainEvents.map((d) => {
        if (d.kind === "eligibility") {
          return { ...d, failedBefore: [...d.failedBefore], failedAfter: [...d.failedAfter] };
        }
        return { ...d };
      }),
    })),
  };
}

/** Serialize an export envelope to a deterministic JSON string. */
export function serializeTraceExport(envelope: TraceExportEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

/**
 * Build a download filename for the given scope and timestamp.
 * Exported as a pure function so tests can verify the format.
 */
export function buildExportFilename(scope: TraceExportScope, now = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `si-chen-trace-${scope}-${ts}.json`;
}

/**
 * Trigger a browser download. Separated from serialization so the pure
 * serializer can be tested without a DOM environment.
 */
export function downloadTraceExport(
  transactions: readonly TraceTransaction[],
  scope: TraceExportScope,
): void {
  const envelope = buildTraceExport(transactions, scope);
  const json = serializeTraceExport(envelope);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = buildExportFilename(scope);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Safely represent a value for JSON export — handles non-JSON-safe types. */
function safeValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  try {
    JSON.stringify(v);
    return v;
  } catch {
    return String(v);
  }
}
