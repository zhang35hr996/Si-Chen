/**
 * Dialogue screen (skeleton-plan §12 PR 8): consumes DialogueLine ONLY —
 * it has no idea what a scene node is. Mid-scene 离开 discards the session:
 * no AP, no effects, `once` unconsumed.
 */
import { useEffect, useRef, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay, toGameTime } from "../../engine/calendar/time";
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
  // 每个 SceneRunner 生命周期一个稳定世代号。start/advance 的异步结果只有在世代号未变、
  // 且 runnerRef 仍指向发起请求的那个 runner 时才被处理；否则（StrictMode 第一代、组件卸载、
  // 事件切换、quit）整体忽略——绝不把 stale 的 NO_SESSION 当用户错误显示。
  const runnerGenerationRef = useRef(0);
  // 同步在途守卫：start/advance 等待期间禁止再次提交 advance（防快速双击并行 run()）。
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [frame, setFrame] = useState<DialogueFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 历史对话去重集合：以 `${eventId}:${frameSeq}`（台词）/`…:choice:${id}`（玩家选择）为稳定键，
  // 防 React StrictMode 双调用 / rerender 重复写入。只记录"实际显示/实际点击"的内容。
  const recordedRef = useRef<Set<string>>(new Set());

  // 记录实际显示给玩家的台词（含旁白）：每个新 frame 首次渲染即写入历史。
  // 中途离开（quit/abandon）不影响已写入的条目——已显示的台词确实发生过。
  useEffect(() => {
    if (!frame) return;
    const key = `${eventId}:${frame.frameSeq}`;
    if (recordedRef.current.has(key)) return;
    recordedRef.current.add(key);
    store.appendNarrativeLog([
      { at: toGameTime(store.getState().calendar), speakerId: frame.line.speakerId, lines: [frame.line.text] },
    ]);
    // 仅在 frameSeq 变化（新台词显示）时记录；store/eventId 在组件生命周期内稳定。
  }, [frame?.frameSeq]);

  // 记录玩家实际点击的选项（「（继续）」不是选项，不记）。
  const recordPlayerChoice = (choiceId: string, text: string) => {
    if (!frame) return;
    const key = `${eventId}:${frame.frameSeq}:choice:${choiceId}`;
    if (recordedRef.current.has(key)) return;
    recordedRef.current.add(key);
    store.appendNarrativeLog([{ at: toGameTime(store.getState().calendar), speakerId: "player", lines: [text] }]);
  };

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

  /** 仅处理仍属当前 runner 世代的结果；stale 结果整体忽略，绝不解除新 runner 的 pending。 */
  const consume = (generation: number, runner: SceneRunner, result: Result<RunnerStep, GameError>) => {
    if (runnerGenerationRef.current !== generation || runnerRef.current !== runner) return;
    pendingRef.current = false;
    setPending(false);
    handleStep(result);
  };

  /** 守卫式 advance：pending 期间拒绝再次提交；beforeSubmit 仅在确实推进时执行（如记录玩家选择）。 */
  const submitAdvance = (choiceId: string | undefined, beforeSubmit?: () => void) => {
    const runner = runnerRef.current;
    if (!runner || pendingRef.current) return;
    const generation = runnerGenerationRef.current;
    pendingRef.current = true;
    setPending(true);
    beforeSubmit?.();
    void runner.advance(choiceId).then((result) => consume(generation, runner, result));
  };

  useEffect(() => {
    const generation = ++runnerGenerationRef.current;
    const runner = new SceneRunner(db, { provider: mockProvider, logger });
    runnerRef.current = runner;
    setFrame(null);
    setError(null);
    pendingRef.current = true;
    setPending(true);
    void runner.start(store.getState(), eventId).then((result) => consume(generation, runner, result));
    return () => {
      // 先使本世代失效（旧 start/advance 的 Promise 解析时将被忽略），再 abandon。
      if (runnerGenerationRef.current === generation) runnerGenerationRef.current += 1;
      // 仅当 ref 仍指向本 runner 时清空——不能清掉 StrictMode 第二次 setup 新建的 runner。
      if (runnerRef.current === runner) runnerRef.current = null;
      runner.abandon();
    };
    // deps: restart only when the event changes; store/db are stable for the app's lifetime
  }, [eventId]);

  const event = db.events[eventId];
  const quit = () => {
    // 立即失效当前世代 + abandon + 清 ref：退出前发出的 provider 请求随后完成时整体忽略，
    // 不得 setError/setFrame/commit 或再次 onDone。
    runnerGenerationRef.current += 1;
    const runner = runnerRef.current;
    runnerRef.current = null;
    pendingRef.current = false;
    setPending(false);
    runner?.abandon(); // discard: no AP spent, nothing applied
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
                disabled={pending}
                onClick={() => submitAdvance(choice.id, () => recordPlayerChoice(choice.id, choice.text))}
              >
                {choice.text}
              </button>
            ))
          ) : (
            <button type="button" disabled={pending} onClick={() => submitAdvance(undefined)}>
              （继续）
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
