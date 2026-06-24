import { useMemo } from "react";
import type { DomainEventComparison, TraceComparison } from "../../../engine/trace/compare";
import { compareTransactions } from "../../../engine/trace/compare";
import type { TraceDomainEvent } from "../../../engine/trace/domainEvents";
import type { TraceTransaction } from "../../../engine/trace/types";
import { TraceMutationRow } from "./TraceMutationRow";

interface Props {
  primary: TraceTransaction;
  comparison: TraceTransaction;
  onExit: () => void;
}

/** Format a value for display — avoids [object Object] for complex values. */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    try { return JSON.stringify(v, null, 0).slice(0, 80); }
    catch { return String(v); }
  }
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

/** One-line label for a domain event showing its most meaningful fields. */
function domainLabel(d: TraceDomainEvent): string {
  if (d.kind === "memory") return `memory ${d.operation} owner=${d.ownerId} entry=${d.entryId}`;
  if (d.kind === "queue") return `queue ${d.queue} ${d.operation} ${d.itemId}${d.resolution ? ` (${d.resolution})` : ""}`;
  if (d.kind === "eligibility") return `eligibility ${d.eventId} → ${d.transition}`;
  if (d.kind === "rollback") return `rollback ${d.failedPhase}: ${d.message.slice(0, 60)}`;
  return `${(d as { kind: string }).kind}`;
}

export function TraceCompareView({ primary, comparison, onExit }: Props) {
  const result: TraceComparison = useMemo(
    () => compareTransactions(primary, comparison),
    [primary, comparison],
  );

  const { mutationSummary: ms, domainSummary: ds, metadataChanges: meta } = result;
  const metaDiffs = Object.values(meta).filter(Boolean);

  return (
    <section className="trace-compare">
      <div className="trace-compare__header">
        <button type="button" onClick={onExit}>← 退出对比</button>
        <strong>对比事务</strong>
        <span className="trace-compare__ids">
          <span className="trace-compare__label--primary">A {primary.id}</span>
          {" vs "}
          <span className="trace-compare__label--comparison">B {comparison.id}</span>
        </span>
      </div>

      {/* Metadata changes */}
      {metaDiffs.length > 0 && (
        <div className="trace-compare__section">
          <h4>元数据差异</h4>
          <ul className="trace-compare__meta-list">
            {meta.outcome !== null && (
              <li>outcome: <span className="trace-compare__label--primary">{meta.outcome.primary}</span> → <span className="trace-compare__label--comparison">{meta.outcome.comparison}</span></li>
            )}
            {meta.source !== null && (
              <li>source: <span className="trace-compare__label--primary">{primary.source.label}</span> → <span className="trace-compare__label--comparison">{comparison.source.label}</span></li>
            )}
            {meta.gameTime !== null && (
              <li>gameTime: <span className="trace-compare__label--primary">{meta.gameTime.primary ?? "—"}</span> → <span className="trace-compare__label--comparison">{meta.gameTime.comparison ?? "—"}</span></li>
            )}
            {meta.error !== null && (
              <li>error: <span className="trace-compare__label--primary">{meta.error.primary ?? "—"}</span> → <span className="trace-compare__label--comparison">{meta.error.comparison ?? "—"}</span></li>
            )}
            {meta.directCount !== null && (
              <li>directCount: <span className="trace-compare__label--primary">{meta.directCount.primary}</span> → <span className="trace-compare__label--comparison">{meta.directCount.comparison}</span></li>
            )}
            {meta.untrackedCount !== null && (
              <li>untrackedCount: <span className="trace-compare__label--primary">{meta.untrackedCount.primary}</span> → <span className="trace-compare__label--comparison">{meta.untrackedCount.comparison}</span></li>
            )}
            {meta.warningCount !== null && (
              <li>warnings: <span className="trace-compare__label--primary">{meta.warningCount.primary}</span> → <span className="trace-compare__label--comparison">{meta.warningCount.comparison}</span></li>
            )}
          </ul>
        </div>
      )}

      {/* Mutation summary */}
      <div className="trace-compare__section">
        <h4>变更对比</h4>
        <p className="trace-compare__stat">
          仅 A: {ms.onlyPrimary.length} · 仅 B: {ms.onlyComparison.length} · 变化: {ms.changed.length} · 相同: {ms.unchangedCount}
        </p>

        {ms.changed.length > 0 && (
          <>
            <h5>值发生变化</h5>
            <ul className="trace-compare__mut-list">
              {ms.changed.map((c) => (
                <li key={c.key} className="trace-compare__mut-changed">
                  <div className="trace-compare__mut-key">{c.primary.path} / {c.primary.phase}</div>
                  <div><span className="trace-compare__label--primary">A</span>: {fmtValue(c.primary.before)} → {fmtValue(c.primary.after)}</div>
                  <div><span className="trace-compare__label--comparison">B</span>: {fmtValue(c.comparison.before)} → {fmtValue(c.comparison.after)}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {ms.onlyPrimary.length > 0 && (
          <>
            <h5>仅在 A 中</h5>
            <ul className="trace-compare__mut-list trace-compare__mut-list--primary">
              {ms.onlyPrimary.map((m, i) => <TraceMutationRow key={`${m.path}|${m.phase}|${i}`} mut={m} />)}
            </ul>
          </>
        )}

        {ms.onlyComparison.length > 0 && (
          <>
            <h5>仅在 B 中</h5>
            <ul className="trace-compare__mut-list trace-compare__mut-list--comparison">
              {ms.onlyComparison.map((m, i) => <TraceMutationRow key={`${m.path}|${m.phase}|${i}`} mut={m} />)}
            </ul>
          </>
        )}
      </div>

      {/* Domain event summary */}
      <div className="trace-compare__section">
        <h4>领域事件对比</h4>
        <p className="trace-compare__stat">
          变化: {ds.changed.length} · 相同: {ds.unchangedCount} · 仅 A: {ds.onlyPrimary.length} · 仅 B: {ds.onlyComparison.length}
        </p>

        {ds.changed.length > 0 && (
          <>
            <h5>载荷发生变化</h5>
            <ul className="trace-compare__domain-list">
              {ds.changed.map((c: DomainEventComparison) => (
                <li key={c.key} className="trace-compare__domain-changed">
                  <div className="trace-compare__mut-key">{c.key}</div>
                  <div><span className="trace-compare__label--primary">A</span>: {domainLabel(c.primary)}</div>
                  <div><span className="trace-compare__label--comparison">B</span>: {domainLabel(c.comparison)}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {ds.onlyPrimary.length > 0 && (
          <>
            <h5>仅在 A 中</h5>
            <ul className="trace-compare__domain-list">
              {ds.onlyPrimary.map((d, i) => (
                <li key={`${d.kind}|${d.phase}|${i}`}><span className="trace-compare__label--primary">{domainLabel(d)}</span></li>
              ))}
            </ul>
          </>
        )}
        {ds.onlyComparison.length > 0 && (
          <>
            <h5>仅在 B 中</h5>
            <ul className="trace-compare__domain-list">
              {ds.onlyComparison.map((d, i) => (
                <li key={`${d.kind}|${d.phase}|${i}`}><span className="trace-compare__label--comparison">{domainLabel(d)}</span></li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
