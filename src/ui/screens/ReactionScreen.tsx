/** Plays a 位分/封号 reaction (1–N lines) through the dialogue seam so the consort's NEW 称呼 + self-ref render. */
import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { assembleDialogueRequest, produceDialogueTurn } from "../../engine/dialogue/orchestrator";
import { mockProvider } from "../../engine/dialogue/providers/mockProvider";
import type { DialogueLine } from "../../engine/dialogue/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function ReactionScreen({
  db,
  store,
  registry,
  speakerId,
  lines,
  backgroundKey,
  generatedLine,
  onChoice,
  choicePending,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  speakerId: string;
  lines: string[];
  /** 覆盖背景（带时段变体）；缺省用玩家当前所在地点背景。 */
  backgroundKey?: string;
  /**
   * When provided, this line is rendered directly — no assembleDialogueRequest or mockProvider.
   * The prop is authoritative: each new value atomically replaces the displayed line without
   * going through local state, so there is no one-frame window where a stale turn's choices
   * are visible and clickable.
   */
  generatedLine?: DialogueLine;
  /** Called when the player clicks a choice button (generative path only). Does NOT advance the line. */
  onChoice?: (choice: { id: string; text: string; tone?: string }) => void;
  /** True while onChoice is in-flight; disables all choice buttons. */
  choicePending?: boolean;
  onDone: () => void;
}) {
  const state = useGameState(store);
  const [index, setIndex] = useState(0);
  // Scripted-path local state only. Generative path reads generatedLine directly from the prop.
  const [scriptedLine, setScriptedLine] = useState<DialogueLine | null>(null);

  // generatedLine is authoritative in the generative path — it is not mirrored into local state.
  // Rendering directly from the prop means a new turn from App replaces the displayed line
  // atomically in the same React render, with no gap where the previous turn's choices are active.
  const line = generatedLine ?? scriptedLine;

  useEffect(() => {
    // Generative path: prop is the source of truth; effect has nothing to do.
    if (generatedLine !== undefined) return;

    // Scripted path: assemble + run through mockProvider for name/pronoun resolution.
    let alive = true;
    const text = lines[index];
    if (text === undefined) return;
    const req = assembleDialogueRequest(db, state, speakerId, state.playerLocation, { scripted: { text }, register: "private" });
    if (!req.ok) {
      onDone();
      return;
    }
    void produceDialogueTurn(db, mockProvider, req.value, state).then((r) => {
      if (alive && r.ok) setScriptedLine(r.value.line);
      else if (alive) onDone();
    });
    return () => {
      alive = false;
    };
  }, [index, generatedLine]); // re-run when index advances (scripted) or generatedLine appears/disappears

  if (!line) return null;

  const character = db.characters[speakerId];
  const portrait = registry.portrait(character?.portraitSet ?? speakerId, line.expression);

  const location = db.locations[state.playerLocation];
  const bgKey = backgroundKey ?? location?.backgroundKey;
  const background = bgKey
    ? registry.resolveVariant(bgKey, timeOfDay(state.calendar), "background")
    : null;

  const next = () => (index + 1 < lines.length ? setIndex(index + 1) : onDone());
  const hasChoices = generatedLine !== undefined && line.choices.length > 0;

  return (
    <main
      className="dialogue-screen"
      data-generated={line?.meta.generated || undefined}
      data-degraded={line?.meta.degraded || undefined}
      style={background ? { backgroundImage: `url("${background.url}")` } : undefined}
    >
      <img
        className="dialogue-screen__portrait"
        src={portrait.url}
        alt={line.speakerName}
        data-fallback={portrait.isFallback || undefined}
      />

      {/* When choices are visible, clicking the box must not advance/close the dialogue. */}
      <section className="dialogue-screen__box" onClick={hasChoices ? undefined : next}>
        <p className="dialogue-screen__speaker">{line.speakerName}</p>
        <p className="dialogue-screen__line">{line.text}</p>
        <div className="dialogue-screen__choices">
          {hasChoices ? (
            line.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                data-tone={c.tone}
                disabled={choicePending}
                onClick={(event) => { event.stopPropagation(); onChoice?.(c); }}
              >
                {c.text}
              </button>
            ))
          ) : (
            <button type="button" onClick={(event) => { event.stopPropagation(); next(); }}>
              （继续）
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
