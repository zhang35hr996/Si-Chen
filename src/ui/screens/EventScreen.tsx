/**
 * INTERIM event UI (PR 7): title + intro lines + outcome choices, resolved
 * through store.resolveEvent. PR 8's SceneRunner + dialogue UI replaces this
 * screen; the resolution transaction underneath stays.
 */
import { useMemo, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatAp, formatGameTime } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { flattenScene, type FlatLine, type FlatOption } from "../../engine/events/flattenScene";
import { formatErrorTag } from "../../engine/infra/errors";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

function Lines({ db, lines }: { db: ContentDB; lines: FlatLine[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <p key={i} className="event-screen__line">
          <span className="event-screen__speaker">
            {db.characters[line.speakerId]?.profile.name ?? line.speakerId}
          </span>
          {line.text}
        </p>
      ))}
    </>
  );
}

export function EventScreen({
  db,
  store,
  registry,
  eventId,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  eventId: string;
  onDone: () => void;
}) {
  const state = useGameState(store);
  const [closing, setClosing] = useState<FlatLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const event = db.events[eventId];
  const scene = event ? db.scenes[event.sceneId] : undefined;
  const flat = useMemo(() => (scene ? flattenScene(scene) : null), [scene]);

  if (!event || !scene || !flat) {
    return <p className="screen-error">未知事件：{eventId}</p>;
  }
  if (!flat.ok) {
    return <p className="screen-error">{flat.error.message}</p>;
  }

  const speakerId = scene.participants[0]!;
  const portrait = registry.portrait(db.characters[speakerId]?.portraitSet ?? speakerId, "neutral");

  const choose = (option: FlatOption) => {
    const result = store.resolveEvent(db, eventId, option.effects);
    if (result.ok) {
      setClosing(option.closing);
      setError(null);
    } else {
      setError(result.error.map((e) => `${formatErrorTag(e)} — ${e.message}`).join("；"));
    }
  };

  return (
    <main className="event-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatAp(state.calendar)}
        </span>
        <span className="event-screen__cost">{event.title} · 耗费 {event.apCost} 行动点</span>
      </header>

      <section className="event-screen__body">
        <img className="event-screen__portrait" src={portrait.url} alt="" />
        <div className="event-screen__dialogue">
          {closing === null ? (
            <>
              <Lines db={db} lines={flat.value.intro} />
              {error && <p className="debug-panel__rejection">{error}</p>}
              <div className="event-screen__choices">
                {flat.value.options.map((option) => (
                  <button key={option.id} type="button" onClick={() => choose(option)}>
                    {option.text}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <Lines db={db} lines={closing} />
              <div className="event-screen__choices">
                <button type="button" onClick={onDone}>
                  （离开）
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
