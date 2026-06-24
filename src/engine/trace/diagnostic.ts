/**
 * Plain-text diagnostic formatter for a single trace transaction (PR3).
 * Pure function — no DOM, no network, no credentials.
 * Output is bounded, deterministic, and safe to paste into issues or AI prompts.
 */
import type { EligibilityTraceEvent, MemoryTraceEvent, QueueTraceEvent, RollbackTraceEvent } from "./domainEvents";
import type { TraceTransaction } from "./types";

const MAX_VALUE_LEN = 80;
const MAX_PATH_LEN = 100;
const MAX_LINES = 120;

/** Format a trace transaction as a compact, copyable diagnostic string. */
export function formatTraceDiagnostic(tx: TraceTransaction): string {
  const lines: string[] = [];

  lines.push(`Trace transaction ${tx.id}`);
  lines.push(`Outcome: ${tx.outcome}`);
  lines.push(`Source: ${tx.source.kind}${tx.source.sourceId ? " / " + tx.source.sourceId : ""}`);
  if (tx.source.label) lines.push(`Label: ${tx.source.label}`);
  if (tx.gameTime) lines.push(`Game time: ${tx.gameTime}`);
  if (tx.error) lines.push(`Error: ${tx.error}`);

  const isRollback = tx.outcome === "rolled_back";
  lines.push(`Mutations: ${tx.mutations.length}${isRollback ? " (attempted, not committed)" : ""}`);
  lines.push(`  Direct: ${tx.directCount}  Untracked: ${tx.untrackedCount}`);

  // Mutations (bounded)
  if (tx.mutations.length > 0) {
    lines.push("Mutations:");
    const shown = tx.mutations.slice(0, 20);
    for (const m of shown) {
      const path = truncate(m.path, MAX_PATH_LEN);
      const before = truncate(renderValue(m.before), MAX_VALUE_LEN);
      const after = truncate(renderValue(m.after), MAX_VALUE_LEN);
      const suffix = m.reason ? ` (${truncate(m.reason, 60)})` : "";
      lines.push(`  [${m.classification}/${m.phase}] ${path}: ${before} → ${after}${suffix}`);
    }
    if (tx.mutations.length > 20) lines.push(`  … and ${tx.mutations.length - 20} more`);
  }

  // Domain events
  if (tx.domainEvents.length > 0) {
    lines.push(`Domain events: ${tx.domainEvents.length}${isRollback ? " (attempted)" : ""}`);
    for (const d of tx.domainEvents) {
      if (d.kind === "memory") {
        const e = d as MemoryTraceEvent;
        const src = e.sourceCourtEventId ? ` from ${e.sourceCourtEventId}` : "";
        const sum = e.summary ? ` "${truncate(e.summary, 60)}"` : "";
        lines.push(`  - memory ${e.operation} ${e.entryId} (owner: ${e.ownerId})${sum}${src}`);
      } else if (d.kind === "queue") {
        const e = d as QueueTraceEvent;
        const res = e.resolution ? ` resolution=${e.resolution}` : "";
        const rsn = e.reason ? ` reason=${e.reason}` : "";
        lines.push(`  - queue ${e.queue} ${e.operation} ${e.itemId}${res}${rsn}`);
      } else if (d.kind === "eligibility") {
        const e = d as EligibilityTraceEvent;
        const failCount = e.transition === "became_ineligible" ? e.failedAfter.length : e.failedBefore.length;
        lines.push(`  - eligibility ${e.eventId} ${e.transition} (${failCount} failed conditions)`);
      } else if (d.kind === "rollback") {
        const e = d as RollbackTraceEvent;
        const code = e.errorCode ? ` [${e.errorCode}]` : "";
        lines.push(`  - rollback at ${e.failedPhase}${code}: ${truncate(e.message, 80)}`);
        lines.push(`    attempted: ${e.attemptedMutationCount} mutations, ${e.attemptedDomainEventCount} domain events`);
      }
    }
  } else {
    lines.push("Domain events: 0");
  }

  // Warnings
  if (tx.warnings.length > 0) {
    lines.push(`Warnings: ${tx.warnings.length}`);
    for (const w of tx.warnings.slice(0, 5)) {
      lines.push(`  ⚠ ${truncate(w.message, 100)}${w.path ? ` @ ${w.path}` : ""}`);
    }
    if (tx.warnings.length > 5) lines.push(`  … and ${tx.warnings.length - 5} more`);
  } else {
    lines.push("Warnings: 0");
  }

  // Enforce hard line cap
  return lines.slice(0, MAX_LINES).join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function renderValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); }
  catch { return String(v); }
}
