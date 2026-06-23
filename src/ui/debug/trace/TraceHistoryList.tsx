import type { TraceTransaction } from "../../../engine/trace/types";

interface Props {
  txs: readonly TraceTransaction[];
  onSelect: (tx: TraceTransaction) => void;
  onClear: () => void;
}

export function TraceHistoryList({ txs, onSelect, onClear }: Props) {
  if (txs.length === 0) {
    return (
      <section className="trace-list">
        <p className="trace-list__empty">（尚无追踪记录）</p>
      </section>
    );
  }

  const reversed = [...txs].reverse();
  return (
    <section className="trace-list">
      <div className="trace-list__toolbar">
        <span>{txs.length} 条事务</span>
        <button type="button" onClick={onClear}>清空</button>
      </div>
      <ul className="trace-list__items">
        {reversed.map((tx) => {
          const hasUntracked = tx.untrackedCount > 0;
          const isRolledBack = tx.outcome === "rolled_back";
          return (
            <li
              key={tx.id}
              className={`trace-list__item ${isRolledBack ? "trace-list__item--err" : ""} ${hasUntracked ? "trace-list__item--warn" : ""}`}
            >
              <button type="button" className="trace-list__btn" onClick={() => onSelect(tx)}>
                <span className="trace-list__id">{tx.id}</span>
                <span className="trace-list__label">{tx.source.label}</span>
                <span className="trace-list__counts">
                  {tx.directCount}↓{hasUntracked && <em> +{tx.untrackedCount}?</em>}
                </span>
                {tx.gameTime && <span className="trace-list__time">{tx.gameTime}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
