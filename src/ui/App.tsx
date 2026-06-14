import { useMemo, useRef, useState } from "react";
import rawManifest from "../../assets/manifest.json";
import { assetManifestSchema } from "../engine/assets/manifest";
import { AssetRegistry } from "../engine/assets/registry";
import { loadGameContent } from "../engine/content/viteSource";
import { pickNextEvent } from "../engine/events/engine";
import { assetError, stateError } from "../engine/infra/errors";
import type { RingBufferLogger } from "../engine/infra/logger";
import { autosave, listSaves, loadWithRecovery } from "../engine/save/saveSystem";
import { createLocalStorageAdapter } from "../engine/save/storage";
import type { GameStore } from "../store/gameStore";
import { DebugPanel } from "./debug/DebugPanel";
import { BootErrorScreen } from "./screens/BootErrorScreen";
import { DialogueScreen } from "./screens/DialogueScreen";
import { FreeViewScreen } from "./screens/FreeViewScreen";
import { LocationScreen } from "./screens/LocationScreen";
import { MapScreen } from "./screens/MapScreen";
import { SaveLoadScreen } from "./screens/SaveLoadScreen";
import { TitleScreen } from "./screens/TitleScreen";

/** Cap on scene_end→event chains per player action (plan §10 #9 latent guard). */
const MAX_EVENT_CHAIN = 3;

type View = "title" | "location" | "map" | "freeview" | "event" | "save";

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
  const [freeViewId, setFreeViewId] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const chainDepth = useRef(0);
  const storage = useMemo(() => createLocalStorageAdapter(), []);

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
    chainDepth.current = 0; // player-initiated start resets the chain budget
    setActiveEventId(eventId);
    setView("event");
  };

  /** Autosave hooks: scene commit + travel only (plan §9), never mid-scene. */
  const doAutosave = () => {
    if (storage) autosave(storage, db, store.getState(), { logger });
  };

  const canContinue =
    storage !== null && listSaves(storage).some((s) => (s.slot === "auto" || s.slot === "auto.prev") && s.status === "ok");

  const continueGame = () => {
    if (!storage) return;
    const result = loadWithRecovery(storage, db, { logger });
    if (result.ok) {
      store.loadState(result.value.state);
      setContinueError(result.value.warnings.map((w) => w.message).join("；") || null);
      setView("location");
    } else {
      setContinueError(result.error.map((e) => e.message).join("；"));
    }
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
      {view === "title" && (
        <TitleScreen
          onNewGame={newGame}
          onContinue={continueGame}
          canContinue={canContinue}
          continueError={continueError}
        />
      )}
      {view === "location" && (
        <LocationScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => setView("map")}
          onOpenSave={() => setView("save")}
          onStartEvent={startEvent}
        />
      )}
      {view === "save" && (
        <SaveLoadScreen
          db={db}
          store={store}
          storage={storage}
          logger={logger}
          gameStarted
          onClose={() => setView("location")}
          onLoaded={() => setView("location")}
        />
      )}
      {view === "map" && (
        <MapScreen
          db={db}
          store={store}
          registry={registry}
          onTravelled={(rolledOver) => {
            doAutosave(); // travel autosave (plan §9)
            runCheckpoints(rolledOver);
          }}
          onOpenView={(locationId) => {
            setFreeViewId(locationId);
            setView("freeview");
          }}
          onClose={() => setView("location")}
        />
      )}
      {view === "freeview" && freeViewId && (
        <FreeViewScreen
          db={db}
          store={store}
          registry={registry}
          locationId={freeViewId}
          onStartEvent={startEvent}
          onClose={() => setView("map")}
        />
      )}
      {view === "event" && activeEventId && (
        <DialogueScreen
          db={db}
          store={store}
          registry={registry}
          eventId={activeEventId}
          logger={logger}
          onDone={(committed) => {
            setActiveEventId(null);
            if (committed) {
              doAutosave(); // scene-commit autosave (plan §9)
              const pick = pickNextEvent(db, store.getState(), "scene_end");
              if (pick) {
                if (chainDepth.current < MAX_EVENT_CHAIN) {
                  chainDepth.current += 1;
                  setActiveEventId(pick.id); // chained event keeps the depth budget
                  return;
                }
                logger?.logGameError(
                  stateError("EVENT_CHAIN_LIMIT", `scene_end chain capped at ${MAX_EVENT_CHAIN}`, {
                    severity: "warn",
                    context: { deferred: pick.id },
                  }),
                );
              }
            }
            setView("location");
          }}
        />
      )}
      <DebugPanel store={store} db={db} logger={logger} onForceEvent={startEvent} />
    </>
  );
}
