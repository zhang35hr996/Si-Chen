import { useState, useCallback, useSyncExternalStore, useMemo } from "react";
import type { TraceHistory } from "../../../engine/trace/history";
import type { TraceTransaction } from "../../../engine/trace/types";
import { collectTraceFacets, filterTraceTransactions } from "../../../engine/trace/query";
import type { TraceQuery } from "../../../engine/trace/query";
import { TraceFilterBar } from "./TraceFilterBar";
import { TraceHistoryList } from "./TraceHistoryList";
import { TraceDetails } from "./TraceDetails";

interface Props {
  history: TraceHistory;
}

export function TraceTab({ history }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState<TraceQuery>({});

  const txs = useSyncExternalStore(
    (cb) => history.subscribe(cb),
    () => history.getAll(),
  );

  const facets = useMemo(() => collectTraceFacets(txs), [txs]);
  const filteredTxs = useMemo(() => filterTraceTransactions(txs, query), [txs, query]);

  // When selection is filtered out, auto-select first visible or clear.
  const selectedInFiltered = filteredTxs.find((tx) => tx.id === selectedId);
  const effectiveSelectedId: string | null =
    selectedId === null
      ? null
      : selectedInFiltered
        ? selectedId
        : null;

  const selected: TraceTransaction | null =
    effectiveSelectedId !== null
      ? (filteredTxs.find((tx) => tx.id === effectiveSelectedId) ?? null)
      : null;

  const handleClear = useCallback(() => {
    history.clear();
    setSelectedId(null);
  }, [history]);

  if (selected) {
    return <TraceDetails tx={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="trace-tab">
      <TraceFilterBar
        query={query}
        facets={facets}
        filteredCount={filteredTxs.length}
        onChange={setQuery}
      />
      <TraceHistoryList
        txs={filteredTxs}
        totalCount={txs.length}
        onSelect={(tx) => setSelectedId(tx.id)}
        onClear={handleClear}
      />
    </div>
  );
}
