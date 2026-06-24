import { useState, useCallback, useSyncExternalStore, useMemo } from "react";
import type { TraceHistory } from "../../../engine/trace/history";
import { collectTraceFacets, filterTraceTransactions } from "../../../engine/trace/query";
import type { TraceQuery } from "../../../engine/trace/query";
import { downloadTraceExport } from "../../../engine/trace/export";
import { TraceFilterBar } from "./TraceFilterBar";
import { TraceHistoryList } from "./TraceHistoryList";
import { TraceDetails } from "./TraceDetails";
import { TraceCompareView } from "./TraceCompareView";

interface Props {
  history: TraceHistory;
}

type TabMode =
  | { kind: "list" }
  | { kind: "detail"; txId: string }
  | { kind: "compare-pick"; primaryId: string }
  | { kind: "compare"; primaryId: string; comparisonId: string };

export function TraceTab({ history }: Props) {
  const [mode, setMode] = useState<TabMode>({ kind: "list" });
  const [query, setQuery] = useState<TraceQuery>({});

  const txs = useSyncExternalStore(
    (cb) => history.subscribe(cb),
    () => history.getAll(),
  );

  const facets = useMemo(() => collectTraceFacets(txs), [txs]);
  const filteredTxs = useMemo(() => filterTraceTransactions(txs, query), [txs, query]);

  // Look up transactions by stable id.
  const findTx = useCallback((id: string) => txs.find((tx) => tx.id === id) ?? null, [txs]);

  const handleClear = useCallback(() => {
    history.clear();
    setMode({ kind: "list" });
  }, [history]);

  // ── Render compare view ──
  if (mode.kind === "compare") {
    const primary = findTx(mode.primaryId);
    const comparison = findTx(mode.comparisonId);
    if (primary && comparison) {
      return (
        <TraceCompareView
          primary={primary}
          comparison={comparison}
          onExit={() => setMode({ kind: "list" })}
        />
      );
    }
    // Evicted — fall through to list
    setMode({ kind: "list" });
  }

  // ── Render detail view ──
  if (mode.kind === "detail") {
    const selected = findTx(mode.txId);
    if (selected) {
      return (
        <TraceDetails
          tx={selected}
          onBack={() => setMode({ kind: "list" })}
          onCompare={() => setMode({ kind: "compare-pick", primaryId: selected.id })}
        />
      );
    }
    // Evicted — fall through to list
    setMode({ kind: "list" });
  }

  // ── Render compare picker ──
  if (mode.kind === "compare-pick") {
    const primaryId = mode.primaryId;
    const primary = findTx(primaryId);
    if (!primary) {
      setMode({ kind: "list" });
    } else {
      return (
        <section className="trace-compare-pick">
          <div className="trace-compare-pick__header">
            <button type="button" onClick={() => setMode({ kind: "detail", txId: primaryId })}>← 取消</button>
            <span>选择第二个对比事务（A: {primaryId}）</span>
          </div>
          <ul className="trace-list__items">
            {[...txs].reverse().filter((tx) => tx.id !== primaryId).map((tx) => (
              <li key={tx.id} className={`trace-list__item${tx.outcome === "rolled_back" ? " trace-list__item--err" : ""}`}>
                <button
                  type="button"
                  className="trace-list__btn"
                  onClick={() => setMode({ kind: "compare", primaryId, comparisonId: tx.id })}
                >
                  <span className="trace-list__id">{tx.id}</span>
                  <span className="trace-list__label">{tx.source.label}</span>
                  <span className={`trace-badge--${tx.outcome === "committed" ? "ok" : "err"}`}>
                    {tx.outcome === "committed" ? "已提交" : "已回滚"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      );
    }
  }

  // ── Render list (default) ──
  return (
    <div className="trace-tab">
      <TraceFilterBar
        query={query}
        facets={facets}
        filteredCount={filteredTxs.length}
        onChange={setQuery}
      />
      <div className="trace-tab__export-bar">
        <button
          type="button"
          disabled={filteredTxs.length === 0}
          onClick={() => downloadTraceExport(filteredTxs, "filtered")}
          title="导出筛选后事务"
        >
          导出筛选
        </button>
        <button
          type="button"
          disabled={txs.length === 0}
          onClick={() => downloadTraceExport(txs, "history")}
          title="导出全部历史"
        >
          导出全部
        </button>
      </div>
      <TraceHistoryList
        txs={filteredTxs}
        totalCount={txs.length}
        onSelect={(tx) => setMode({ kind: "detail", txId: tx.id })}
        onClear={handleClear}
      />
    </div>
  );
}
