/**
 * Dev state inspector (skeleton-plan §12 PR 2: "raw state JSON dump panel").
 * Toggle with ` (backtick). Grows tabs (characters/memory/events) in later PRs.
 */
import { useEffect, useState } from "react";
import { formatAp, formatGameTime, toGameTime } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { formatErrorTag } from "../../engine/infra/errors";
import type { LogEntry, RingBufferLogger } from "../../engine/infra/logger";
import { listMemories, memoryAgeDays, memoryOriginLabel } from "../../engine/memory/inspect";
import { resolveConsortRuntimeAttrs } from "../../engine/characters/consortAttrs";
import type { GameState } from "../../engine/state/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export interface DebugPanelProps {
  store: GameStore;
  db?: ContentDB;
  logger?: RingBufferLogger;
  /** Force-fire an event, bypassing trigger conditions (plan §13 #10). */
  onForceEvent?: (eventId: string) => void;
}

export function DebugPanel(props: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "`") setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return null;
  return <DebugPanelBody {...props} />;
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
              {entry.id} · {entry.kind} · 强度 {entry.strength} · {memoryAgeDays(entry, now)} 行动日前 ·{" "}
              {memoryOriginLabel(entry)}
              {entry.retention === "permanent" ? " · 🔒" : ""}
              {entry.triggerTags.length > 0 ? ` · #${entry.triggerTags.join(" #")}` : ""}
            </span>
            <span className="memory-browser__summary">{entry.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConsortAttrsBrowser({ db, state }: { db?: ContentDB; state: GameState }) {
  const consortIds = Object.keys(state.standing).filter((id) => {
    const char = db?.characters[id] ?? state.generatedConsorts[id];
    return char?.kind === "consort" && state.standing[id]?.lifecycle !== "deceased";
  });
  if (!db || consortIds.length === 0) return null;
  return (
    <section className="debug-panel__consort-attrs">
      <h4>侍君隐藏属性</h4>
      <table style={{ fontSize: "11px", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["姓名", "情意", "恐惧", "野心", "忠诚", "阵营"].map((h) => (
              <th key={h} style={{ padding: "2px 6px", borderBottom: "1px solid #666" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {consortIds.map((id) => {
            const char = db.characters[id] ?? state.generatedConsorts[id];
            const name = char?.profile.name ?? id;
            const attrs = resolveConsortRuntimeAttrs(db, state, id);
            const faction = state.standing[id]?.haremFactionId ?? "—";
            return (
              <tr key={id}>
                <td style={{ padding: "1px 6px" }}>{name}</td>
                <td style={{ padding: "1px 6px" }}>{attrs.affection}</td>
                <td style={{ padding: "1px 6px" }}>{attrs.fear}</td>
                <td style={{ padding: "1px 6px" }}>{attrs.ambition}</td>
                <td style={{ padding: "1px 6px" }}>{attrs.loyalty}</td>
                <td style={{ padding: "1px 6px" }}>{faction}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Recent warn/error diagnostics from the ring buffer (gate rejections, save
 * failures, asset misses…). Read on demand — the buffer mutates outside React. */
function Diagnostics({ logger }: { logger: RingBufferLogger }) {
  const [tick, setTick] = useState(0);
  const recent: LogEntry[] = logger
    .entries()
    .filter((e) => e.level === "warn" || e.level === "error")
    .slice(-15)
    .reverse();

  const exportBundle = () => {
    const url = URL.createObjectURL(new Blob([logger.exportJson()], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `fengsichen-bugbundle-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="debug-panel__diagnostics">
      <div className="debug-panel__actions">
        <strong>诊断日志</strong>
        <button type="button" onClick={() => setTick(tick + 1)}>
          刷新
        </button>
        <button type="button" onClick={exportBundle}>
          导出 Bug 包
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="debug-panel__content">（无警告/错误）</p>
      ) : (
        <ul className="debug-panel__log">
          {recent.map((entry) => (
            <li key={entry.seq} className={`debug-panel__log--${entry.level}`}>
              #{entry.seq} {entry.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Force-trigger any event regardless of its condition (plan §13 #10). */
function ForceTrigger({ db, onForceEvent }: { db: ContentDB; onForceEvent: (eventId: string) => void }) {
  return (
    <section className="debug-panel__force">
      <strong>强制触发事件</strong>
      <div className="debug-panel__actions">
        {Object.values(db.events).map((event) => (
          <button key={event.id} type="button" onClick={() => onForceEvent(event.id)}>
            {event.title}
          </button>
        ))}
      </div>
    </section>
  );
}

function DebugPanelBody({ store, db, logger, onForceEvent }: DebugPanelProps) {
  const state = useGameState(store);
  const [lastRejection, setLastRejection] = useState<string | null>(null);
  const [, bumpReport] = useState(0);

  const spendAp = (amount: number) => {
    if (db) {
      // Route through the unified time entry so the monthly health tick / gameOver run.
      const result = store.advanceTime(db, { type: "SPEND_AP", amount });
      setLastRejection(result.ok ? null : result.error.map((e) => `${formatErrorTag(e)} — ${e.message}`).join("; "));
    } else {
      // NOTE: intentional raw dispatch — debug AP does NOT run the monthly health tick
      // (db not yet loaded; advanceTime requires a ContentDB).
      const result = store.dispatch({ type: "SPEND_AP", amount });
      setLastRejection(result.ok ? null : `${formatErrorTag(result.error)} — ${result.error.message}`);
    }
  };

  const gameStarted = Object.keys(state.standing).length > 0;
  const firstCharId = Object.keys(state.standing)[0];

  const fireEffects = (valid: boolean) => {
    if (!db || !firstCharId) return;
    store.applyEffects(
      db,
      valid
        ? [
            { type: "favor", char: firstCharId, delta: 2 },
            {
              type: "memory",
              char: firstCharId,
              entry: {
                kind: "impression",
                summary: "（调试）陛下方才在调试面板里拨弄了一下人心。",
                strength: 10,
                retention: "fast",
                subjectIds: ["player", firstCharId],
                perspective: "witness",
                triggerTags: ["debug"],
                unresolved: false,
                emotions: {},
              },
            },
          ]
        : [
            { type: "favor", char: firstCharId, delta: 2 },
            { type: "favor", char: "char_ghost", delta: 2 },
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
      {db && onForceEvent && <ForceTrigger db={db} onForceEvent={onForceEvent} />}
      {logger && <Diagnostics logger={logger} />}
      {db && <ContentSummary db={db} />}
      {gameStarted && <ConsortAttrsBrowser db={db} state={state} />}
      {gameStarted && <MemoryBrowser db={db} state={state} />}
      <pre className="debug-panel__dump">{JSON.stringify(state, null, 2)}</pre>
    </aside>
  );
}
