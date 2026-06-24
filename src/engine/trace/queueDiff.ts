import type { GameState } from "../state/types";
import type { QueueTraceEvent } from "./domainEvents";

/**
 * Auto-derive queue trace events by comparing before/after state snapshots.
 * Emits "enqueued" for new items and "dequeued" for removed items.
 * Callers with explicit semantic knowledge (approveRetirement, retainRetirement)
 * should add explicit QueueTraceEvents to the collector BEFORE calling buildTrace;
 * those explicit events take precedence over auto-derived ones.
 */
export function deriveQueueTraceEvents(before: GameState, after: GameState): QueueTraceEvent[] {
  const events: QueueTraceEvent[] = [];

  // pendingRetirements (keyed by officialId)
  const beforeRetirements = new Set(before.pendingRetirements.map((r) => r.officialId));
  const afterRetirements = new Set(after.pendingRetirements.map((r) => r.officialId));
  for (const id of afterRetirements) {
    if (!beforeRetirements.has(id)) {
      events.push({ kind: "queue", queue: "pendingRetirements", operation: "enqueued", itemId: id, phase: "boundary_diff" });
    }
  }
  for (const id of beforeRetirements) {
    if (!afterRetirements.has(id)) {
      events.push({ kind: "queue", queue: "pendingRetirements", operation: "dequeued", itemId: id, phase: "boundary_diff" });
    }
  }

  // pendingAftermath (keyed by id; resolved flag transitions are also tracked)
  const beforeAftermath = new Map(before.pendingAftermath.map((a) => [a.id, a]));
  const afterAftermathMap = new Map(after.pendingAftermath.map((a) => [a.id, a]));
  for (const [id] of afterAftermathMap) {
    if (!beforeAftermath.has(id)) {
      const item = afterAftermathMap.get(id)!;
      events.push({ kind: "queue", queue: "pendingAftermath", operation: "enqueued", itemId: id, itemType: item.kind, phase: "boundary_diff" });
    }
  }
  for (const [id, item] of beforeAftermath) {
    const afterItem = afterAftermathMap.get(id);
    if (!afterItem) {
      events.push({ kind: "queue", queue: "pendingAftermath", operation: "dequeued", itemId: id, itemType: item.kind, phase: "boundary_diff" });
    } else if (!item.resolved && afterItem.resolved) {
      events.push({ kind: "queue", queue: "pendingAftermath", operation: "resolved", itemId: id, itemType: item.kind, phase: "boundary_diff" });
    }
  }

  // pendingDaxuan (single slot; keyed by "kind:year")
  const bDax = before.pendingDaxuan;
  const aDax = after.pendingDaxuan;
  const bDaxId = bDax ? `${bDax.kind}:${bDax.year}` : null;
  const aDaxId = aDax ? `${aDax.kind}:${aDax.year}` : null;
  if (aDaxId && aDaxId !== bDaxId) {
    events.push({ kind: "queue", queue: "pendingDaxuan", operation: "enqueued", itemId: aDaxId, itemType: aDax?.kind, phase: "boundary_diff" });
  }
  if (bDaxId && bDaxId !== aDaxId) {
    events.push({ kind: "queue", queue: "pendingDaxuan", operation: "dequeued", itemId: bDaxId, itemType: bDax?.kind, phase: "boundary_diff" });
  }

  return events;
}
