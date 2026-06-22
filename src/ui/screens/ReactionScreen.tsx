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
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  speakerId: string;
  lines: string[];
  /** 覆盖背景（带时段变体）；缺省用玩家当前所在地点背景。 */
  backgroundKey?: string;
  /** If provided and index === 0, renders this line directly without calling mockProvider. */
  generatedLine?: DialogueLine;
  onDone: () => void;
}) {
  const state = useGameState(store);
  const [index, setIndex] = useState(0);
  const [line, setLine] = useState<DialogueLine | null>(null);

  useEffect(() => {
    // Generative path: skip assembleDialogueRequest + mockProvider entirely.
    if (generatedLine !== undefined && index === 0) {
      setLine(generatedLine);
      return;
    }

    let alive = true;
    const text = lines[index];
    if (text === undefined) return;
    const req = assembleDialogueRequest(db, state, speakerId, state.playerLocation, { scripted: { text } });
    if (!req.ok) {
      onDone();
      return;
    }
    void produceDialogueTurn(db, mockProvider, req.value, state).then((r) => {
      if (alive && r.ok) setLine(r.value.line);
      else if (alive) onDone();
    });
    return () => {
      alive = false;
    };
  }, [index]); // intentional: re-run only when line index changes

  if (!line) return null;

  const character = db.characters[speakerId];
  const portrait = registry.portrait(character?.portraitSet ?? speakerId, line.expression);

  const location = db.locations[state.playerLocation];
  const bgKey = backgroundKey ?? location?.backgroundKey;
  const background = bgKey
    ? registry.resolveVariant(bgKey, timeOfDay(state.calendar), "background")
    : null;

  const next = () => (index + 1 < lines.length ? setIndex(index + 1) : onDone());

  return (
    <main
      className="dialogue-screen"
      style={background ? { backgroundImage: `url("${background.url}")` } : undefined}
    >
      <img
        className="dialogue-screen__portrait"
        src={portrait.url}
        alt={line.speakerName}
        data-fallback={portrait.isFallback || undefined}
      />

      <section className="dialogue-screen__box" onClick={next}>
        <p className="dialogue-screen__speaker">{line.speakerName}</p>
        <p className="dialogue-screen__line">{line.text}</p>
        <div className="dialogue-screen__choices">
          <button type="button" onClick={next}>
            （继续）
          </button>
        </div>
      </section>
    </main>
  );
}
