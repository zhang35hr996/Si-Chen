import { useState, useCallback } from "react";
import type { TraceHistory } from "../../../engine/trace/history";
import type { TraceTransaction } from "../../../engine/trace/types";
import { TraceHistoryList } from "./TraceHistoryList";
import { TraceDetails } from "./TraceDetails";

interface Props {
  history: TraceHistory;
  /** Tick counter — parent bumps this whenever trace history may have changed. */
  tick: number;
}

export function TraceTab({ history, tick: _tick }: Props) {
  const [selected, setSelected] = useState<TraceTransaction | null>(null);
  const [clearCount, setClearCount] = useState(0);

  const handleClear = useCallback(() => {
    history.clear();
    setSelected(null);
    setClearCount((n) => n + 1);
  }, [history]);

  // clearCount is used to force re-render after clear (history mutates in place)
  void clearCount;

  const txs = history.getAll();

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
