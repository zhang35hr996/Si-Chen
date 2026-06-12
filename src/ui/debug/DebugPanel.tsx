/**
 * Dev state inspector (skeleton-plan §12 PR 2: "raw state JSON dump panel").
 * Toggle with ` (backtick). Grows tabs (characters/memory/events) in later PRs.
 */
import { useEffect, useState } from "react";
import { formatAp, formatGameTime } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { formatErrorTag } from "../../engine/infra/errors";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function DebugPanel({ store, db }: { store: GameStore; db?: ContentDB }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "`") setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return null;
  return <DebugPanelBody store={store} db={db} />;
}

function ContentSummary({ db }: { db: ContentDB }) {
  return (
    <p className="debug-panel__content">
      content v{db.contentVersion} · 角色 {Object.keys(db.characters).join(", ")} · 地点{" "}
      {Object.keys(db.locations).join(", ")} · 事件 {Object.keys(db.events).length} · 场景{" "}
      {Object.keys(db.scenes).length} · 位分 {Object.keys(db.ranks).join(", ")}
    </p>
  );
}

function DebugPanelBody({ store, db }: { store: GameStore; db?: ContentDB }) {
  const state = useGameState(store);
  const [lastRejection, setLastRejection] = useState<string | null>(null);

  const spendAp = (amount: number) => {
    const result = store.dispatch({ type: "SPEND_AP", amount });
    setLastRejection(result.ok ? null : `${formatErrorTag(result.error)} — ${result.error.message}`);
  };

  return (
    <aside className="debug-panel">
      <header className="debug-panel__header">
        <strong>调试面板</strong>
        <span>
          {formatGameTime(state.calendar)} · {formatAp(state.calendar)}
        </span>
      </header>
      <div className="debug-panel__actions">
        <button type="button" onClick={() => spendAp(1)}>
          消耗 1 AP
        </button>
        <button type="button" onClick={() => spendAp(2)}>
          消耗 2 AP
        </button>
        <button
          type="button"
          onClick={() => {
            store.reset();
            setLastRejection(null);
          }}
        >
          重置状态
        </button>
      </div>
      {lastRejection && <p className="debug-panel__rejection">{lastRejection}</p>}
      {db && <ContentSummary db={db} />}
      <pre className="debug-panel__dump">{JSON.stringify(state, null, 2)}</pre>
    </aside>
  );
}
