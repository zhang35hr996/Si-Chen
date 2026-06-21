import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import type { ChengFengPrompt, PromptAction } from "../../store/prompt";

export function ChengFengPromptScreen({ registry, db, store, prompt, onChoose }: {
  registry: AssetRegistry; db: ContentDB; store: GameStore;
  prompt: ChengFengPrompt; onChoose: (action: PromptAction) => void;
}) {
  const state = useGameState(store);
  const character = db.characters[prompt.speakerId];
  const portrait = registry.portrait(character?.portraitSet ?? prompt.speakerId, "neutral");
  const location = db.locations[state.playerLocation];
  const bg = location?.backgroundKey
    ? registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background")
    : null;
  return (
    <main className="dialogue-screen" style={bg ? { backgroundImage: `url("${bg.url}")` } : undefined}>
      <img className="dialogue-screen__portrait" src={portrait.url} alt={character?.profile.name ?? "乘风"}
           data-fallback={portrait.isFallback || undefined} />
      <section className="dialogue-screen__box">
        <p className="dialogue-screen__speaker">{character?.profile.name ?? "乘风"}</p>
        <p className="dialogue-screen__line">{prompt.line}</p>
        <div className="dialogue-screen__choices">
          {prompt.choices.map((c, i) => (
            <button key={i} type="button" onClick={() => onChoose(c.action)}>{c.label}</button>
          ))}
        </div>
      </section>
    </main>
  );
}
