/**
 * Pure trace query/filter/facet model (PR3, dev-only, tree-shaken in prod).
 * All functions are stateless and immutable — inputs are never modified.
 */
import type { EligibilityTraceEvent, MemoryTraceEvent, QueueTraceEvent, RollbackTraceEvent, TraceDomainEvent } from "./domainEvents";
import type { MutationClassification, TraceSource, TraceTransaction } from "./types";

// ── Query type ──────────────────────────────────────────────────────────────

export interface TraceQuery {
  /** Case-insensitive substring match against the bounded search document. */
  text?: string;
  /** Include only transactions with one of these outcomes. */
  outcomes?: Array<"committed" | "rolled_back">;
  /** Include only transactions whose source.kind matches any of these. */
  sourceKinds?: Array<TraceSource["kind"]>;
  /** Include only transactions whose source.sourceId matches any of these. */
  sourceIds?: string[];
  /** Include only transactions that have at least one mutation with any of these phases. */
  phases?: string[];
  /** Include only transactions that have at least one mutation with any of these classifications. */
  mutationClassifications?: MutationClassification[];
  /** Include only transactions that have at least one domain event of any of these kinds. */
  domainKinds?: Array<TraceDomainEvent["kind"]>;
  /** Include only transactions that have at least one mutation whose path starts with any of these. */
  paths?: string[];
  /** Include only transactions that have at least one warning. */
  hasWarnings?: boolean;
  /** Include only transactions that have at least one untracked mutation. */
  hasUntracked?: boolean;
  /** Include only transactions whose sequential id is >= fromSequence. */
  fromSequence?: number;
  /** Include only transactions whose sequential id is <= toSequence. */
  toSequence?: number;
}

// ── Facets ──────────────────────────────────────────────────────────────────

export interface TraceFacets {
  totalCount: number;
  outcomes: Partial<Record<"committed" | "rolled_back", number>>;
  sourceKinds: Record<string, number>;
  phases: Record<string, number>;
  mutationClassifications: Partial<Record<MutationClassification, number>>;
  domainKinds: Partial<Record<TraceDomainEvent["kind"], number>>;
}

// ── Search document ─────────────────────────────────────────────────────────

/**
 * Build a bounded, normalized search string for a transaction.
 * Only explicit semantic fields are included — no full JSON dumps.
 */
function buildSearchDocument(tx: TraceTransaction): string {
  const parts: string[] = [
    tx.source.kind,
    tx.source.label,
  ];
  if (tx.source.sourceId) parts.push(tx.source.sourceId);
  if (tx.error) parts.push(tx.error);
  if (tx.gameTime) parts.push(tx.gameTime);

  for (const m of tx.mutations) {
    parts.push(m.path);
    parts.push(m.phase);
    if (m.effectType) parts.push(m.effectType);
    if (m.reason) parts.push(m.reason);
  }

  for (const d of tx.domainEvents) {
    parts.push(d.kind);
    parts.push(d.phase);
    if (d.kind === "memory") {
      const e = d as MemoryTraceEvent;
      parts.push(e.operation);
      parts.push(e.ownerId);
      parts.push(e.entryId);
      if (e.summary) parts.push(e.summary);
      if (e.sourceCourtEventId) parts.push(e.sourceCourtEventId);
    } else if (d.kind === "queue") {
      const e = d as QueueTraceEvent;
      parts.push(e.queue);
      parts.push(e.operation);
      parts.push(e.itemId);
      if (e.itemType) parts.push(e.itemType);
      if (e.resolution) parts.push(e.resolution);
      if (e.reason) parts.push(e.reason);
    } else if (d.kind === "eligibility") {
      const e = d as EligibilityTraceEvent;
      parts.push(e.eventId);
      parts.push(e.transition);
    } else if (d.kind === "rollback") {
      const e = d as RollbackTraceEvent;
      parts.push(e.failedPhase);
      parts.push(e.message);
      if (e.errorCode) parts.push(e.errorCode);
    }
  }

  return parts.join(" ").toLowerCase();
}

// ── Sequence id extraction ──────────────────────────────────────────────────

function txSequence(tx: TraceTransaction): number {
  const n = parseInt(tx.id.replace(/^#/, ""), 10);
  if (!Number.isFinite(n)) throw new Error(`TraceQuery: cannot parse sequence from id "${tx.id}"`);
  return n;
}

// ── Core matcher ───────────────────────────────────────────────────────────

/** Returns true when tx satisfies all active filter criteria (empty = no restriction). */
export function matchesTraceQuery(tx: TraceTransaction, query: TraceQuery): boolean {
  // Text — trimmed, case-insensitive, substring
  if (query.text !== undefined) {
    const needle = query.text.trim().toLowerCase();
    if (needle !== "" && !buildSearchDocument(tx).includes(needle)) return false;
  }

  // Outcomes — OR within category
  if (query.outcomes !== undefined && query.outcomes.length > 0) {
    if (!query.outcomes.includes(tx.outcome)) return false;
  }

  // Source kind — OR
  if (query.sourceKinds !== undefined && query.sourceKinds.length > 0) {
    if (!query.sourceKinds.includes(tx.source.kind)) return false;
  }

  // Source id — OR
  if (query.sourceIds !== undefined && query.sourceIds.length > 0) {
    if (tx.source.sourceId === undefined || !query.sourceIds.includes(tx.source.sourceId)) return false;
  }

  // Phases — OR: tx qualifies if any mutation matches any queried phase
  if (query.phases !== undefined && query.phases.length > 0) {
    if (!tx.mutations.some((m) => query.phases!.includes(m.phase))) return false;
  }

  // Mutation classifications — OR
  if (query.mutationClassifications !== undefined && query.mutationClassifications.length > 0) {
    if (!tx.mutations.some((m) => query.mutationClassifications!.includes(m.classification))) return false;
  }

  // Domain kinds — OR
  if (query.domainKinds !== undefined && query.domainKinds.length > 0) {
    if (!tx.domainEvents.some((d) => query.domainKinds!.includes(d.kind))) return false;
  }

  // Paths — OR: prefix match
  if (query.paths !== undefined && query.paths.length > 0) {
    if (!tx.mutations.some((m) => query.paths!.some((p) => m.path === p || m.path.startsWith(p + ".")))) return false;
  }

  // hasWarnings flag
  if (query.hasWarnings === true && tx.warnings.length === 0) return false;

  // hasUntracked flag
  if (query.hasUntracked === true && tx.untrackedCount === 0) return false;

  // Sequence range
  if (query.fromSequence !== undefined || query.toSequence !== undefined) {
    const seq = txSequence(tx);
    if (query.fromSequence !== undefined && seq < query.fromSequence) return false;
    if (query.toSequence !== undefined && seq > query.toSequence) return false;
  }

  return true;
}

/** Filter transactions preserving original order. Inputs are never mutated. */
export function filterTraceTransactions(
  transactions: readonly TraceTransaction[],
  query: TraceQuery,
): TraceTransaction[] {
  return transactions.filter((tx) => matchesTraceQuery(tx, query));
}

/** Compute facet counts over the supplied full history. */
export function collectTraceFacets(transactions: readonly TraceTransaction[]): TraceFacets {
  const outcomes: Partial<Record<"committed" | "rolled_back", number>> = {};
  const sourceKinds: Record<string, number> = {};
  const phases: Record<string, number> = {};
  const mutationClassifications: Partial<Record<MutationClassification, number>> = {};
  const domainKinds: Partial<Record<TraceDomainEvent["kind"], number>> = {};

  for (const tx of transactions) {
    outcomes[tx.outcome] = (outcomes[tx.outcome] ?? 0) + 1;
    sourceKinds[tx.source.kind] = (sourceKinds[tx.source.kind] ?? 0) + 1;

    const txPhases = new Set(tx.mutations.map((m) => m.phase));
    for (const ph of txPhases) phases[ph] = (phases[ph] ?? 0) + 1;

    const txClassifications = new Set(tx.mutations.map((m) => m.classification));
    for (const cl of txClassifications) {
      mutationClassifications[cl] = (mutationClassifications[cl] ?? 0) + 1;
    }

    const txDomainKinds = new Set(tx.domainEvents.map((d) => d.kind));
    for (const k of txDomainKinds) {
      domainKinds[k] = (domainKinds[k] ?? 0) + 1;
    }
  }

  return { totalCount: transactions.length, outcomes, sourceKinds, phases, mutationClassifications, domainKinds };
}
