/** 播放模板化侍寝体验台词（经对话缝隙渲染），结束回调 onDone。 */
import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { assembleDialogueRequest, produceDialogueLine } from "../../engine/dialogue/orchestrator";
import { mockProvider } from "../../engine/dialogue/providers/mockProvider";
import type { DialogueLine } from "../../engine/dialogue/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function BedchamberScene({
  db,
  store,
  registry,
  speakerId,
  lines,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  speakerId: string;
  lines: string[];
  onDone: () => void;
}) {
  const state = useGameState(store);
  const [index, setIndex] = useState(0);
  const [line, setLine] = useState<DialogueLine | null>(null);

  useEffect(() => {
    let alive = true;
    const text = lines[index];
    if (text === undefined) return;
    const req = assembleDialogueRequest(db, state, speakerId, state.playerLocation, { text });
    if (!req.ok) {
      onDone();
      return;
    }
    void produceDialogueLine(db, mockProvider, req.value).then((r) => {
      if (alive && r.ok) setLine(r.value);
      else if (alive) onDone();
    });
    return () => {
      alive = false;
    };
  }, [index]); // re-run only on index change

  if (!line) return null;

  const character = db.characters[speakerId];
  const portrait = registry.portrait(character?.portraitSet ?? speakerId, line.expression);
  const location = db.locations[state.playerLocation];
  const background = location
    ? registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background")
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
