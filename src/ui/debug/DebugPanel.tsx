/**
 * Dev state inspector (skeleton-plan §12 PR 2: "raw state JSON dump panel").
 * Toggle with ` (backtick). Grows tabs (characters/memory/events) in later PRs.
 */
import { useEffect, useState } from "react";
import { formatAp, formatGameTime, toGameTime } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { formatErrorTag } from "../../engine/infra/errors";
import { listMemories, memoryAgeDays, memoryOriginLabel } from "../../engine/memory/inspect";
import type { GameState } from "../../engine/state/types";
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

function MemoryBrowser({ db, state }: { db?: ContentDB; state: GameState }) {
  const charIds = Object.keys(state.memories);
  const [selected, setSelected] = useState<string | null>(null);
  const charId = selected && charIds.includes(selected) ? selected : (charIds[0] ?? null);
  if (!charId) return null;

  const now = toGameTime(state.calendar);
  const entries = listMemories(state, charId);
  const nameOf = (id: string) => db?.characters[id]?.profile.name ?? id;

  return (
    <section className="memory-browser">
      <div className="memory-browser__tabs">
        {charIds.map((id) => (
          <button
            key={id}
            type="button"
            className={id === charId ? "memory-browser__tab--active" : ""}
            onClick={() => setSelected(id)}
          >
            {nameOf(id)}（{listMemories(state, id).length}）
          </button>
        ))}
      </div>
      <ul className="memory-browser__list">
        {entries.length === 0 && <li className="memory-browser__meta">（无记忆）</li>}
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className="memory-browser__meta">
              {entry.id} · {entry.kind} · 显著 {entry.salience} · {memoryAgeDays(entry, now)} 行动日前 ·{" "}
              {memoryOriginLabel(entry)}
              {entry.protected ? " · 🔒" : ""}
              {entry.tags.length > 0 ? ` · #${entry.tags.join(" #")}` : ""}
            </span>
            <span className="memory-browser__summary">{entry.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DebugPanelBody({ store, db }: { store: GameStore; db?: ContentDB }) {
  const state = useGameState(store);
  const [lastRejection, setLastRejection] = useState<string | null>(null);
  const [, bumpReport] = useState(0);

  const spendAp = (amount: number) => {
    const result = store.dispatch({ type: "SPEND_AP", amount });
    setLastRejection(result.ok ? null : `${formatErrorTag(result.error)} — ${result.error.message}`);
  };

  const gameStarted = Object.keys(state.relationships).length > 0;
  const firstCharId = Object.keys(state.relationships)[0];

  const fireEffects = (valid: boolean) => {
    if (!db || !firstCharId) return;
    store.applyEffects(
      db,
      valid
        ? [
            { type: "relationship", char: firstCharId, field: "trust", delta: 2 },
            { type: "resource", pillar: "harem", field: "harmony", delta: 1 },
            {
              type: "memory",
              char: firstCharId,
              entry: {
                kind: "opinion",
                summary: "（调试）陛下方才在调试面板里拨弄了一下人心。",
                salience: 10,
                tags: ["debug"],
                participants: ["player", firstCharId],
              },
            },
          ]
        : [
            { type: "relationship", char: firstCharId, field: "trust", delta: 2 },
            { type: "relationship", char: "char_ghost", field: "trust", delta: 2 },
          ],
    );
    bumpReport((n) => n + 1); // rejected batches don't emit — refresh report display
  };

  const report = store.getLastEffectReport();

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
      <div className="debug-panel__actions">
        <button type="button" onClick={() => fireEffects(true)} disabled={!gameStarted || !db}>
          合法效果批
        </button>
        <button type="button" onClick={() => fireEffects(false)} disabled={!gameStarted || !db}>
          非法效果批
        </button>
      </div>
      {!gameStarted && <p className="debug-panel__content">效果批演示需先开始新游戏。</p>}
      {report && (
        <p className={report.outcome === "applied" ? "debug-panel__content" : "debug-panel__rejection"}>
          上一效果批：{report.outcome === "applied" ? "已应用" : "已整批拒绝"}（{report.effects.length} 个效果）
          {report.errors.map((error, i) => (
            <span key={i}>
              <br />
              {formatErrorTag(error)} — {error.message}
            </span>
          ))}
        </p>
      )}
      {db && <ContentSummary db={db} />}
      {gameStarted && <MemoryBrowser db={db} state={state} />}
      <pre className="debug-panel__dump">{JSON.stringify(state, null, 2)}</pre>
    </aside>
  );
}
