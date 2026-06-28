/**
 * Dialogue screen (skeleton-plan §12 PR 8): consumes DialogueLine ONLY —
 * it has no idea what a scene node is. Mid-scene 离开 discards the session:
 * no AP, no effects, `once` unconsumed.
 */
import { useEffect, useRef, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { EventEffect } from "../../engine/content/schemas";
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
  onCommit,
  quitLabel = "离开",
  quitTitle = "中途离开不消耗行动点，亦无任何后果",
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  eventId: string;
  logger?: RingBufferLogger;
  onDone: (committed: boolean, rolledOver?: boolean) => void;
  /** 模板事件覆盖默认的 store.resolveEvent 结算路径（含 selectedChoiceId 与 instanceId）。 */
  onCommit?: (
    eventId: string,
    effects: readonly EventEffect[],
    selectedChoiceId?: string,
  ) => Result<{ rolledOver: boolean }, GameError[]>;
  /** 退出按钮文案与悬浮提示（上朝会话复用本屏，标作「退朝」）。 */
  quitLabel?: string;
  quitTitle?: string;
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
    // terminal → commit (effects + apCost + eventLog + sceneHistory；模板事件还含 record resolved)
    const { eventId: completedId, effects, selectedChoiceId } = result.value;
    const commit = onCommit
      ? onCommit(completedId, effects, selectedChoiceId)
      : store.resolveEvent(db, completedId, effects);
    if (commit.ok) {
      onDone(true, commit.value.rolledOver);
    } else {
      setError(commit.error.map((e) => `${formatErrorTag(e)} — ${e.message}`).join("；"));
    }
  };

  useEffect(() => {
    const runner = new SceneRunner(db, { provider: mockProvider, logger });
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

  const isNarration = frame.line.speakerId === "narrator";
  const speaker = isNarration ? undefined : db.characters[frame.line.speakerId];
  const portrait = isNarration
    ? null
    : registry.portrait(speaker?.portraitSet ?? frame.line.speakerId, frame.line.expression);
  const scene = event ? db.scenes[event.sceneId] : undefined;
  const sceneLocation = scene ? db.locations[scene.locationId] : undefined;
  let backgroundKey = sceneLocation?.backgroundKey;
  if (event?.presentation?.mode === "exploration") {
    const pres = event.presentation; // already narrowed to exploration variant
    const host = db.locations[pres.hostLocationId];
    const sub = host?.subLocations?.find((x) => x.id === pres.subLocationId);
    if (sub?.backgroundKey) backgroundKey = sub.backgroundKey;
  }
  const background = backgroundKey
    ? registry.resolveVariant(backgroundKey, timeOfDay(state.calendar), "background")
    : null;

  return (
    <main
      className="dialogue-screen"
      style={background ? { backgroundImage: `url("${background.url}")` } : undefined}
    >
      <header className="hud dialogue-screen__hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatShichen(state.calendar)}
        </span>
        <span className="dialogue-screen__cost">{event?.title}</span>
        <button type="button" className="hud__button" onClick={quit} title={quitTitle}>
          {quitLabel}
        </button>
      </header>

      {!isNarration && portrait && (
        <img
          className="dialogue-screen__portrait"
          src={portrait.url}
          alt={frame.line.speakerName}
          data-fallback={portrait.isFallback || undefined}
        />
      )}

      <section className={`dialogue-screen__box${isNarration ? " dialogue-screen__box--narration" : ""}`}>
        {!isNarration && <p className="dialogue-screen__speaker">{frame.line.speakerName}</p>}
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
