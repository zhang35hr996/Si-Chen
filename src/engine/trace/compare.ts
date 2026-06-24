/**
 * Pure transaction comparison model (PR3, dev-only).
 * Inputs are never mutated. Comparison is deterministic.
 */
import type { TraceDomainEvent } from "./domainEvents";
import type { MutationRecord, TraceSource, TraceTransaction } from "./types";

// ── Mutation comparison ──────────────────────────────────────────────────────

export interface MutationComparison {
  key: string;
  primary: MutationRecord;
  comparison: MutationRecord;
  /** True when before/after/reason/effectType differ. */
  differs: boolean;
}

export interface MutationSummary {
  onlyPrimary: MutationRecord[];
  onlyComparison: MutationRecord[];
  changed: MutationComparison[];
  unchangedCount: number;
}

/** Semantic key for mutation matching: path + phase + classification. */
function mutationKey(m: MutationRecord): string {
  return `${m.path}|${m.phase}|${m.classification}`;
}

function mutationsDiffer(a: MutationRecord, b: MutationRecord): boolean {
  return (
    !semanticEq(a.before, b.before) ||
    !semanticEq(a.after, b.after) ||
    a.reason !== b.reason ||
    a.effectType !== b.effectType
  );
}

// ── Domain event comparison ──────────────────────────────────────────────────

export interface DomainEventComparison {
  key: string;
  primary: TraceDomainEvent;
  comparison: TraceDomainEvent;
  /** True when payload fields beyond the semantic key differ. */
  differs: boolean;
}

export interface DomainSummary {
  onlyPrimary: TraceDomainEvent[];
  onlyComparison: TraceDomainEvent[];
  /** Events paired by semantic key whose payload differs. */
  changed: DomainEventComparison[];
  unchangedCount: number;
}

/** Full payload comparison for paired domain events (beyond what the key encodes). */
function domainEventsDiffer(a: TraceDomainEvent, b: TraceDomainEvent): boolean {
  return !semanticEq(a, b);
}

/** Kind-specific semantic key for domain event matching. */
function domainKey(d: TraceDomainEvent): string {
  if (d.kind === "memory") return `memory|${d.operation}|${d.ownerId}|${d.entryId}`;
  if (d.kind === "queue") return `queue|${d.queue}|${d.operation}|${d.itemId}`;
  if (d.kind === "eligibility") return `eligibility|${d.eventId}|${d.transition}`;
  if (d.kind === "rollback") return `rollback|${d.failedPhase}|${d.errorCode ?? ""}|${d.message}`;
  return `unknown|${(d as { kind: string }).kind}`;
}

// ── Metadata comparison ──────────────────────────────────────────────────────

export interface MetadataChanges {
  outcome: { primary: string; comparison: string } | null;
  source: { primary: TraceSource; comparison: TraceSource } | null;
  gameTime: { primary: string | undefined; comparison: string | undefined } | null;
  error: { primary: string | undefined; comparison: string | undefined } | null;
  directCount: { primary: number; comparison: number } | null;
  untrackedCount: { primary: number; comparison: number } | null;
  warningCount: { primary: number; comparison: number } | null;
}

// ── TraceComparison ──────────────────────────────────────────────────────────

export interface TraceComparison {
  primaryId: string;
  comparisonId: string;
  mutationSummary: MutationSummary;
  domainSummary: DomainSummary;
  metadataChanges: MetadataChanges;
}

/**
 * Compare two transactions. Deterministic: no side effects, no mutations.
 * Duplicate mutation keys are handled by index-suffix disambiguation.
 */
export function compareTransactions(
  primary: TraceTransaction,
  comparison: TraceTransaction,
): TraceComparison {
  // ── Mutations ──
  // Disambiguate duplicate keys by appending occurrence index.
  const keyedPrimary = disambiguateKeys(primary.mutations, mutationKey);
  const keyedComparison = disambiguateKeys(comparison.mutations, mutationKey);

  const primaryMap = new Map(keyedPrimary.map(([k, m]) => [k, m]));
  const comparisonMap = new Map(keyedComparison.map(([k, m]) => [k, m]));

  const onlyPrimary: MutationRecord[] = [];
  const onlyComparison: MutationRecord[] = [];
  const changed: MutationComparison[] = [];
  let unchangedCount = 0;

  for (const [k, pm] of primaryMap) {
    const cm = comparisonMap.get(k);
    if (!cm) {
      onlyPrimary.push(pm);
    } else if (mutationsDiffer(pm, cm)) {
      changed.push({ key: k, primary: pm, comparison: cm, differs: true });
    } else {
      unchangedCount++;
    }
  }
  for (const [k, cm] of comparisonMap) {
    if (!primaryMap.has(k)) onlyComparison.push(cm);
  }

  // ── Domain events ──
  const keyedDomPrimary = disambiguateKeys([...primary.domainEvents], domainKey);
  const keyedDomComparison = disambiguateKeys([...comparison.domainEvents], domainKey);

  const domPrimaryMap = new Map(keyedDomPrimary.map(([k, d]) => [k, d]));
  const domComparisonMap = new Map(keyedDomComparison.map(([k, d]) => [k, d]));

  const onlyPrimaryDom: TraceDomainEvent[] = [];
  const onlyComparisonDom: TraceDomainEvent[] = [];
  const changedDom: DomainEventComparison[] = [];
  let domUnchangedCount = 0;

  for (const [k, pd] of domPrimaryMap) {
    const cd = domComparisonMap.get(k);
    if (!cd) {
      onlyPrimaryDom.push(pd);
    } else if (domainEventsDiffer(pd, cd)) {
      changedDom.push({ key: k, primary: pd, comparison: cd, differs: true });
    } else {
      domUnchangedCount++;
    }
  }
  for (const [k, d] of domComparisonMap) {
    if (!domPrimaryMap.has(k)) onlyComparisonDom.push(d);
  }

  // ── Metadata ──
  const metadataChanges: MetadataChanges = {
    outcome: primary.outcome !== comparison.outcome ? { primary: primary.outcome, comparison: comparison.outcome } : null,
    source: !sourcesEq(primary.source, comparison.source) ? { primary: primary.source, comparison: comparison.source } : null,
    gameTime: primary.gameTime !== comparison.gameTime ? { primary: primary.gameTime, comparison: comparison.gameTime } : null,
    error: primary.error !== comparison.error ? { primary: primary.error, comparison: comparison.error } : null,
    directCount: primary.directCount !== comparison.directCount ? { primary: primary.directCount, comparison: comparison.directCount } : null,
    untrackedCount: primary.untrackedCount !== comparison.untrackedCount ? { primary: primary.untrackedCount, comparison: comparison.untrackedCount } : null,
    warningCount: primary.warnings.length !== comparison.warnings.length ? { primary: primary.warnings.length, comparison: comparison.warnings.length } : null,
  };

  return {
    primaryId: primary.id,
    comparisonId: comparison.id,
    mutationSummary: { onlyPrimary, onlyComparison, changed, unchangedCount },
    domainSummary: { onlyPrimary: onlyPrimaryDom, onlyComparison: onlyComparisonDom, changed: changedDom, unchangedCount: domUnchangedCount },
    metadataChanges,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function disambiguateKeys<T>(items: T[], keyFn: (item: T) => string): Array<[string, T]> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyFn(item);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return [count === 0 ? base : `${base}[${count}]`, item] as [string, T];
  });
}

function sourcesEq(a: TraceSource, b: TraceSource): boolean {
  return a.kind === b.kind && a.sourceId === b.sourceId && a.label === b.label;
}

function semanticEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  // Sort keys before stringify to avoid false differences from different insertion order.
  try { return stableStringify(a) === stableStringify(b); }
  catch { return false; }
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v as object).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
