import { useState, useCallback, useSyncExternalStore } from "react";
import type { TraceHistory } from "../../../engine/trace/history";
import type { TraceTransaction } from "../../../engine/trace/types";
import { TraceHistoryList } from "./TraceHistoryList";
import { TraceDetails } from "./TraceDetails";

interface Props {
  history: TraceHistory;
}

export function TraceTab({ history }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const txs = useSyncExternalStore(
    (cb) => history.subscribe(cb),
    () => history.getAll(),
  );

  const selected: TraceTransaction | null = txs.find((tx) => tx.id === selectedId) ?? null;

  const handleClear = useCallback(() => {
    history.clear();
    setSelectedId(null);
  }, [history]);

  if (selected) {
    return <TraceDetails tx={selected} onBack={() => setSelectedId(null)} />;
  }

  return <TraceHistoryList txs={txs} onSelect={(tx) => setSelectedId(tx.id)} onClear={handleClear} />;
}
