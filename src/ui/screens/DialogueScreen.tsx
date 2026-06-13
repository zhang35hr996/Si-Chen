/**
 * Dialogue screen (skeleton-plan §12 PR 8): consumes DialogueLine ONLY —
 * it has no idea what a scene node is. Mid-scene 离开 discards the session:
 * no AP, no effects, `once` unconsumed.
 */
import { useEffect, useRef, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatAp, formatGameTime } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { mockProvider } from "../../engine/dialogue/providers/mockProvider";
import { formatErrorTag, type GameError } from "../../engine/infra/errors";
import type { RingBufferLogger } from "../../engine/infra/logger";
import type { Result } from "../../engine/infra/result";
import { SceneRunner, type DialogueFrame, type RunnerStep } from "../../engine/scenes/runner";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function DialogueScreen({
  db,
  store,
  registry,
  eventId,
  logger,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  eventId: string;
  logger?: RingBufferLogger;
  onDone: (committed: boolean) => void;
}) {
  const state = useGameState(store);
  const runnerRef = useRef<SceneRunner | null>(null);
  const [frame, setFrame] = useState<DialogueFrame | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStep = (result: Result<RunnerStep, GameError>) => {
    if (!result.ok) {
      setError(`${formatErrorTag(result.error)} — ${result.error.message}`);
      return;
    }
    if (result.value.kind === "frame") {
      setFrame(result.value.frame);
      return;
    }
    // terminal → commit the whole transaction (effects + apCost + fired)
    const commit = store.resolveEvent(db, result.value.eventId, result.value.effects);
    if (commit.ok) {
      onDone(true);
    } else {
      setError(commit.error.map((e) => `${formatErrorTag(e)} — ${e.message}`).join("；"));
    }
  };

  useEffect(() => {
    const runner = new SceneRunner(db, mockProvider, logger);
    runnerRef.current = runner;
    void runner.start(store.getState(), eventId).then(handleStep);
    return () => runner.abandon();
    // deps: restart only when the event changes; store/db are stable for the app's lifetime
  }, [eventId]);

  const event = db.events[eventId];
  const quit = () => {
    runnerRef.current?.abandon(); // discard: no AP spent, nothing applied
    onDone(false);
  };

  if (error) {
    return (
      <main className="dialogue-screen">
        <p className="screen-error">{error}</p>
        <div className="dialogue-screen__choices">
          <button type="button" onClick={quit}>
            返回
          </button>
        </div>
      </main>
    );
  }
  if (!frame) {
    return <main className="dialogue-screen" />;
  }

  const speaker = db.characters[frame.line.speakerId];
  const portrait = registry.portrait(speaker?.portraitSet ?? frame.line.speakerId, frame.line.expression);
  const scene = event ? db.scenes[event.sceneId] : undefined;
  const location = scene ? db.locations[scene.locationId] : undefined;
  const background = location ? registry.background(location.backgroundKey) : null;

  return (
    <main
      className="dialogue-screen"
      style={background ? { backgroundImage: `url("${background.url}")` } : undefined}
    >
      <header className="hud dialogue-screen__hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatAp(state.calendar)}
        </span>
        <span className="dialogue-screen__cost">
          {event?.title} · 耗费 {event?.apCost} 行动点
        </span>
        <button type="button" className="hud__button" onClick={quit} title="中途离开不消耗行动点，亦无任何后果">
          离开
        </button>
      </header>

      <img
        className="dialogue-screen__portrait"
        src={portrait.url}
        alt={frame.line.speakerName}
        data-fallback={portrait.isFallback || undefined}
      />

      <section className="dialogue-screen__box">
        <p className="dialogue-screen__speaker">{frame.line.speakerName}</p>
        <p className="dialogue-screen__line">{frame.line.text}</p>
        <div className="dialogue-screen__choices">
          {frame.awaiting === "choice" ? (
            frame.line.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => void runnerRef.current?.advance(choice.id).then(handleStep)}
              >
                {choice.text}
              </button>
            ))
          ) : (
            <button type="button" onClick={() => void runnerRef.current?.advance().then(handleStep)}>
              （继续）
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
