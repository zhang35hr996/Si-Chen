import type { EligibilityTraceEvent, MemoryTraceEvent, QueueTraceEvent, RollbackTraceEvent } from "../../../engine/trace/domainEvents";
import type { TraceTransaction } from "../../../engine/trace/types";
import { EligibilityTraceSection } from "./EligibilityTraceSection";
import { MemoryTraceSection } from "./MemoryTraceSection";
import { QueueTraceSection } from "./QueueTraceSection";
import { RollbackTraceSection } from "./RollbackTraceSection";
import { TraceMutationRow } from "./TraceMutationRow";

function copyJson(tx: TraceTransaction) {
  void navigator.clipboard.writeText(JSON.stringify(tx, null, 2));
}

export function TraceDetails({ tx, onBack, onCompare }: { tx: TraceTransaction; onBack: () => void; onCompare?: () => void }) {
  const untracked = tx.mutations.filter((m) => m.classification === "untracked");
  const memoryEvents = tx.domainEvents.filter((e): e is MemoryTraceEvent => e.kind === "memory");
  const queueEvents = tx.domainEvents.filter((e): e is QueueTraceEvent => e.kind === "queue");
  const eligibilityEvents = tx.domainEvents.filter((e): e is EligibilityTraceEvent => e.kind === "eligibility");
  const rollbackEvents = tx.domainEvents.filter((e): e is RollbackTraceEvent => e.kind === "rollback");

  return (
    <section className="trace-details">
      <div className="trace-details__header">
        <button type="button" onClick={onBack}>← 返回</button>
        <strong>{tx.id}</strong>
        <span className={tx.outcome === "committed" ? "trace-badge--ok" : "trace-badge--err"}>
          {tx.outcome === "committed" ? "已提交" : "已回滚"}
        </span>
        <button type="button" onClick={() => copyJson(tx)}>复制 JSON</button>
        {onCompare && <button type="button" onClick={onCompare}>对比…</button>}
      </div>
      <p className="trace-details__meta">
        {new Date(tx.timestamp).toLocaleTimeString()} · {tx.source.label}
        {tx.gameTime && ` · ${tx.gameTime}`}
        {tx.error && <span className="trace-badge--err"> {tx.error}</span>}
      </p>
      {tx.outcome === "rolled_back" && rollbackEvents.length === 0 && (
        <p className="trace-details__rollback-banner">ATTEMPTED — NOT COMMITTED · 未写入任何状态变更</p>
      )}
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
      <RollbackTraceSection events={rollbackEvents} />
      <MemoryTraceSection events={memoryEvents} />
      <QueueTraceSection events={queueEvents} />
      <EligibilityTraceSection events={eligibilityEvents} />
    </section>
  );
}
