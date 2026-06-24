import { useMemo } from "react";
import type { TraceComparison } from "../../../engine/trace/compare";
import { compareTransactions } from "../../../engine/trace/compare";
import type { TraceTransaction } from "../../../engine/trace/types";
import { TraceMutationRow } from "./TraceMutationRow";

interface Props {
  primary: TraceTransaction;
  comparison: TraceTransaction;
  onExit: () => void;
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
            {meta.outcome && (
              <li>outcome: <span className="trace-compare__label--primary">{meta.outcome.primary}</span> → <span className="trace-compare__label--comparison">{meta.outcome.comparison}</span></li>
            )}
            {meta.source && (
              <li>source: <span className="trace-compare__label--primary">{primary.source.label}</span> → <span className="trace-compare__label--comparison">{comparison.source.label}</span></li>
            )}
            {meta.gameTime && (
              <li>gameTime: <span className="trace-compare__label--primary">{meta.gameTime.primary ?? "—"}</span> → <span className="trace-compare__label--comparison">{meta.gameTime.comparison ?? "—"}</span></li>
            )}
            {meta.error && (
              <li>error: <span className="trace-compare__label--primary">{meta.error.primary ?? "—"}</span> → <span className="trace-compare__label--comparison">{meta.error.comparison ?? "—"}</span></li>
            )}
            {meta.directCount && (
              <li>directCount: <span className="trace-compare__label--primary">{meta.directCount.primary}</span> → <span className="trace-compare__label--comparison">{meta.directCount.comparison}</span></li>
            )}
            {meta.untrackedCount && (
              <li>untrackedCount: <span className="trace-compare__label--primary">{meta.untrackedCount.primary}</span> → <span className="trace-compare__label--comparison">{meta.untrackedCount.comparison}</span></li>
            )}
            {meta.warningCount && (
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
              {ms.changed.map((c, i) => (
                <li key={i} className="trace-compare__mut-changed">
                  <div className="trace-compare__mut-key">{c.primary.path} / {c.primary.phase}</div>
                  <div><span className="trace-compare__label--primary">A</span>: {String(c.primary.before)} → {String(c.primary.after)}</div>
                  <div><span className="trace-compare__label--comparison">B</span>: {String(c.comparison.before)} → {String(c.comparison.after)}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {ms.onlyPrimary.length > 0 && (
          <>
            <h5>仅在 A 中</h5>
            <ul className="trace-compare__mut-list trace-compare__mut-list--primary">
              {ms.onlyPrimary.map((m, i) => <TraceMutationRow key={i} mut={m} />)}
            </ul>
          </>
        )}

        {ms.onlyComparison.length > 0 && (
          <>
            <h5>仅在 B 中</h5>
            <ul className="trace-compare__mut-list trace-compare__mut-list--comparison">
              {ms.onlyComparison.map((m, i) => <TraceMutationRow key={i} mut={m} />)}
            </ul>
          </>
        )}
      </div>

      {/* Domain event summary */}
      <div className="trace-compare__section">
        <h4>领域事件对比</h4>
        <p className="trace-compare__stat">
          匹配: {ds.matchedCount} · 仅 A: {ds.onlyPrimary.length} · 仅 B: {ds.onlyComparison.length}
        </p>
        {ds.onlyPrimary.length > 0 && (
          <>
            <h5>仅在 A 中</h5>
            <ul className="trace-compare__domain-list">
              {ds.onlyPrimary.map((d, i) => (
                <li key={i}><span className="trace-compare__label--primary">{d.kind}</span> / {d.phase}</li>
              ))}
            </ul>
          </>
        )}
        {ds.onlyComparison.length > 0 && (
          <>
            <h5>仅在 B 中</h5>
            <ul className="trace-compare__domain-list">
              {ds.onlyComparison.map((d, i) => (
                <li key={i}><span className="trace-compare__label--comparison">{d.kind}</span> / {d.phase}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
