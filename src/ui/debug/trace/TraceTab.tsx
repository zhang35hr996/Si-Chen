import { useState, useCallback, useSyncExternalStore } from "react";
import type { TraceHistory } from "../../../engine/trace/history";
import type { TraceTransaction } from "../../../engine/trace/types";
import { TraceHistoryList } from "./TraceHistoryList";
import { TraceDetails } from "./TraceDetails";

interface Props {
  history: TraceHistory;
}

export function TraceTab({ history }: Props) {
  const [selected, setSelected] = useState<TraceTransaction | null>(null);

  const txs = useSyncExternalStore(
    (cb) => history.subscribe(cb),
    () => history.getAll(),
  );

  const handleClear = useCallback(() => {
    history.clear();
    setSelected(null);
  }, [history]);

  if (selected) {
    const stillExists = txs.some((t) => t.id === selected.id);
    if (!stillExists) {
      setSelected(null);
      return null;
    }
    return <TraceDetails tx={selected} onBack={() => setSelected(null)} />;
  }

  return <TraceHistoryList txs={txs} onSelect={setSelected} onClear={handleClear} />;
}
