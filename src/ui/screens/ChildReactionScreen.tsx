/** 皇嗣台词子屏：与 ReactionScreen 同布局，但立绘由 portraitSet 显式给出（皇嗣非 db.characters）。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function ChildReactionScreen({
  db,
  store,
  registry,
  portraitSet,
  speakerName,
  lines,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  portraitSet: string;
  speakerName: string;
  lines: string[];
  onDone: () => void;
}) {
  const state = useGameState(store);
  const [index, setIndex] = useState(0);
  const portrait = registry.portrait(portraitSet, "neutral");
  const location = db.locations[state.playerLocation];
  const background = location
    ? registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background")
    : null;
  const text = lines[index] ?? "";
  const next = () => (index + 1 < lines.length ? setIndex(index + 1) : onDone());

  return (
    <main
      className="dialogue-screen"
      style={background ? { backgroundImage: `url("${background.url}")` } : undefined}
    >
      <img
        className="dialogue-screen__portrait"
        src={portrait.url}
        alt={speakerName}
        data-fallback={portrait.isFallback || undefined}
      />
      <section className="dialogue-screen__box" onClick={next}>
        <p className="dialogue-screen__speaker">{speakerName}</p>
        <p className="dialogue-screen__line">{text}</p>
        <div className="dialogue-screen__choices">
          <button type="button" onClick={next}>（继续）</button>
        </div>
      </section>
    </main>
  );
}
