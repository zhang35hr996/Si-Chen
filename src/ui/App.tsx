import { useMemo, useState } from "react";
import { loadGameContent } from "../engine/content/viteSource";
import type { GameStore } from "../store/gameStore";
import { DebugPanel } from "./debug/DebugPanel";
import { BootErrorScreen } from "./screens/BootErrorScreen";
import { LocationScreen } from "./screens/LocationScreen";
import { MapScreen } from "./screens/MapScreen";
import { TitleScreen } from "./screens/TitleScreen";

type View = "title" | "location" | "map";

export function App({ store }: { store: GameStore }) {
  const content = useMemo(() => loadGameContent(), []);
  const [view, setView] = useState<View>("title");

  if (!content.ok) {
    return <BootErrorScreen errors={content.error} />;
  }
  const db = content.value;

  const newGame = () => {
    store.newGame(db);
    setView("location");
  };

  return (
    <>
      {view === "title" && <TitleScreen onNewGame={newGame} />}
      {view === "location" && (
        <LocationScreen db={db} store={store} onOpenMap={() => setView("map")} />
      )}
      {view === "map" && (
        <MapScreen
          db={db}
          store={store}
          onTravelled={() => setView("location")}
          onClose={() => setView("location")}
        />
      )}
      <DebugPanel store={store} db={db} />
    </>
  );
}
