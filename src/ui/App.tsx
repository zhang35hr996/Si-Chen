import { useMemo, useState } from "react";
import rawManifest from "../../assets/manifest.json";
import { assetManifestSchema } from "../engine/assets/manifest";
import { AssetRegistry } from "../engine/assets/registry";
import { loadGameContent } from "../engine/content/viteSource";
import { assetError } from "../engine/infra/errors";
import type { RingBufferLogger } from "../engine/infra/logger";
import type { GameStore } from "../store/gameStore";
import { DebugPanel } from "./debug/DebugPanel";
import { BootErrorScreen } from "./screens/BootErrorScreen";
import { LocationScreen } from "./screens/LocationScreen";
import { MapScreen } from "./screens/MapScreen";
import { TitleScreen } from "./screens/TitleScreen";

type View = "title" | "location" | "map";

export function App({ store, logger }: { store: GameStore; logger?: RingBufferLogger }) {
  const content = useMemo(() => loadGameContent(), []);
  const manifest = useMemo(() => assetManifestSchema.safeParse(rawManifest), []);
  const registry = useMemo(
    () =>
      manifest.success
        ? new AssetRegistry(manifest.data, { logger })
        : new AssetRegistry({ version: 1, entries: {} }, { logger }),
    [manifest, logger],
  );
  const [view, setView] = useState<View>("title");

  if (!content.ok || !manifest.success) {
    const errors = [
      ...(content.ok ? [] : content.error),
      ...(manifest.success
        ? []
        : [assetError("SCHEMA", `assets/manifest.json: ${manifest.error.message}`, { severity: "fatal" })]),
    ];
    return <BootErrorScreen errors={errors} />;
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
        <LocationScreen db={db} store={store} registry={registry} onOpenMap={() => setView("map")} />
      )}
      {view === "map" && (
        <MapScreen
          db={db}
          store={store}
          registry={registry}
          onTravelled={() => setView("location")}
          onClose={() => setView("location")}
        />
      )}
      <DebugPanel store={store} db={db} />
    </>
  );
}
