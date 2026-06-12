import { useMemo, useState } from "react";
import rawManifest from "../../assets/manifest.json";
import { assetManifestSchema } from "../engine/assets/manifest";
import { AssetRegistry } from "../engine/assets/registry";
import { loadGameContent } from "../engine/content/viteSource";
import { pickNextEvent } from "../engine/events/engine";
import { assetError } from "../engine/infra/errors";
import type { RingBufferLogger } from "../engine/infra/logger";
import type { GameStore } from "../store/gameStore";
import { DebugPanel } from "./debug/DebugPanel";
import { BootErrorScreen } from "./screens/BootErrorScreen";
import { EventScreen } from "./screens/EventScreen";
import { LocationScreen } from "./screens/LocationScreen";
import { MapScreen } from "./screens/MapScreen";
import { TitleScreen } from "./screens/TitleScreen";

type View = "title" | "location" | "map" | "event";

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
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

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

  const startEvent = (eventId: string) => {
    setActiveEventId(eventId);
    setView("event");
  };

  /** Checkpoint wiring: time_advance (after a rollover) wins over location_enter. */
  const runCheckpoints = (rolledOver: boolean) => {
    const state = store.getState();
    const pick =
      (rolledOver ? pickNextEvent(db, state, "time_advance") : null) ??
      pickNextEvent(db, state, "location_enter");
    if (pick) startEvent(pick.id);
    else setView("location");
  };

  const newGame = () => {
    store.newGame(db);
    const pick = pickNextEvent(db, store.getState(), "game_start");
    if (pick) startEvent(pick.id);
    else setView("location");
  };

  return (
    <>
      {view === "title" && <TitleScreen onNewGame={newGame} />}
      {view === "location" && (
        <LocationScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => setView("map")}
          onStartEvent={startEvent}
        />
      )}
      {view === "map" && (
        <MapScreen
          db={db}
          store={store}
          registry={registry}
          onTravelled={runCheckpoints}
          onClose={() => setView("location")}
        />
      )}
      {view === "event" && activeEventId && (
        <EventScreen
          db={db}
          store={store}
          registry={registry}
          eventId={activeEventId}
          onDone={() => {
            setActiveEventId(null);
            setView("location");
          }}
        />
      )}
      <DebugPanel store={store} db={db} />
    </>
  );
}
