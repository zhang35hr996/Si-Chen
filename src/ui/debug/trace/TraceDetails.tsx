import type { TraceTransaction } from "../../../engine/trace/types";
import { TraceMutationRow } from "./TraceMutationRow";

function copyJson(tx: TraceTransaction) {
  void navigator.clipboard.writeText(JSON.stringify(tx, null, 2));
}

export function TraceDetails({ tx, onBack }: { tx: TraceTransaction; onBack: () => void }) {
  const untracked = tx.mutations.filter((m) => m.classification === "untracked");
  return (
    <section className="trace-details">
      <div className="trace-details__header">
        <button type="button" onClick={onBack}>← 返回</button>
        <strong>{tx.id}</strong>
        <span className={tx.outcome === "committed" ? "trace-badge--ok" : "trace-badge--err"}>
          {tx.outcome === "committed" ? "已提交" : "已回滚"}
        </span>
        <button type="button" onClick={() => copyJson(tx)}>复制 JSON</button>
      </div>
      <p className="trace-details__meta">
        {new Date(tx.timestamp).toLocaleTimeString()} · {tx.source.label}
        {tx.gameTime && ` · ${tx.gameTime}`}
        {tx.error && <span className="trace-badge--err"> {tx.error}</span>}
      </p>
      {untracked.length > 0 && (
        <p className="trace-details__warn">⚠ {untracked.length} 个未追踪变更</p>
      )}
      {tx.warnings.length > 0 && (
        <ul className="trace-details__warnings">
          {tx.warnings.map((w, i) => (
            <li key={i}>{w.message}{w.path ? ` @ ${w.path}` : ""}</li>
          ))}
        </ul>
      )}
      <ul className="trace-details__mutations">
        {tx.mutations.length === 0
          ? <li className="trace-details__empty">（无变更）</li>
          : tx.mutations.map((m, i) => <TraceMutationRow key={i} mut={m} />)
        }
      </ul>
    </section>
  );
}
