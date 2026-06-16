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
import { buildRankOp, type RankOpRequest } from "../store/rankOps";
import { monthOrdinal } from "../engine/calendar/time";
import { buildBedchamber, type BedchamberPlan } from "../store/bedchamber";
import { BedchamberModal } from "./components/BedchamberModal";
import { BedchamberPicker } from "./components/BedchamberPicker";
import { PregnancyModal } from "./components/PregnancyModal";
import { BedchamberScene } from "./screens/BedchamberScene";
import type { BedchamberMode } from "../engine/state/types";
import { RankAdminModal } from "./components/RankAdminModal";
import { DebugPanel } from "./debug/DebugPanel";
import { BootErrorScreen } from "./screens/BootErrorScreen";
import { DialogueScreen } from "./screens/DialogueScreen";
import { FreeViewScreen } from "./screens/FreeViewScreen";
import { LocationScreen } from "./screens/LocationScreen";
import { MapScreen } from "./screens/MapScreen";
import { ReactionScreen } from "./screens/ReactionScreen";
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
  const [manageCharId, setManageCharId] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{ speakerId: string; lines: string[] } | null>(null);
  // 侍寝流程：选人 → 选模式 → 播放体验 → 提交（→ 初夜晋升）
  const [flipOpen, setFlipOpen] = useState(false);
  const [bedchamberPickId, setBedchamberPickId] = useState<string | null>(null);
  const [bedchamberRun, setBedchamberRun] = useState<BedchamberPlan | null>(null);
  const [firstNightPromptId, setFirstNightPromptId] = useState<string | null>(null);
  // The 皇城主地图 is home: 新游戏 and 事件结束 land here (atRoot); the location's
  // 宫城图 button opens the map on the current board instead (atRoot=false).
  const [mapAtRoot, setMapAtRoot] = useState(false);
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

  /** Return to the 皇城主地图 (home). Used by 新游戏 and after an event ends. */
  const goHome = () => {
    setMapAtRoot(true);
    setView("map");
  };

  /** Autosave hooks: scene commit + travel only (plan §9), never mid-scene. */
  const doAutosave = () => {
    if (storage) autosave(storage, db, store.getState(), { logger });
  };

  const applyRankOp = (charId: string, req: RankOpRequest) => {
    const op = buildRankOp(db, store.getState(), charId, req);
    setManageCharId(null);
    if (!op) return; // no change
    const result = store.applyEffects(db, op.effects);
    if (result.ok) {
      doAutosave();
      setReaction({ speakerId: charId, lines: op.lines });
    }
  };

  const canContinue =
    storage !== null && listSaves(storage).some((s) => (s.slot === "auto" || s.slot === "auto.prev") && s.status === "ok");

  const continueGame = () => {
    if (!storage) return;
    const result = loadWithRecovery(storage, db, { logger });
    if (result.ok) {
      store.loadState(result.value.state);
      setContinueError(result.value.warnings.map((w) => w.message).join("；") || null);
      goHome();
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
    else setView("location"); // arrived somewhere with no event → show that room
  };

  const newGame = () => {
    store.newGame(db);
    const pick = pickNextEvent(db, store.getState(), "game_start");
    if (pick) startEvent(pick.id);
    else goHome(); // 开局即在皇城主地图
  };

  const beginBedchamber = (charId: string) => {
    setFlipOpen(false);
    setBedchamberPickId(charId);
  };

  const chooseBedchamberMode = (mode: BedchamberMode) => {
    const charId = bedchamberPickId;
    setBedchamberPickId(null);
    if (!charId) return;
    const plan = buildBedchamber(db, store.getState(), charId, mode);
    if (plan) setBedchamberRun(plan);
  };

  const commitBedchamber = (plan: BedchamberPlan) => {
    setBedchamberRun(null);
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    const spend = store.dispatch({ type: "SPEND_AP", amount: 1 });
    if (!spend.ok) return; // AP guard backstop — don't autosave an un-spent encounter
    doAutosave();
    if (plan.isFirstNight && plan.charId !== "feng_hou") {
      setFirstNightPromptId(plan.charId);
    } else if (spend.ok && spend.value.rolledOver) {
      runCheckpoints(true);
    }
  };

  const liveState = store.getState();
  const preg = liveState.resources.bloodline.pregnancy;
  const pregnancyDue =
    preg.status === "pending" &&
    preg.conceivedAt !== undefined &&
    monthOrdinal(liveState.calendar) > monthOrdinal(preg.conceivedAt);
  const fatherCandidates = pregnancyDue
    ? Object.values(db.characters)
        .filter(
          (c) =>
            c.kind === "consort" &&
            (liveState.bedchamber[c.id]?.encounters ?? []).some(
              (e) => e.mode === "passion" && monthOrdinal(e.at) === monthOrdinal(preg.conceivedAt!),
            ),
        )
        .map((c) => c.id)
    : [];

  const confirmPregnancy = (fatherIds: string[]) => {
    const r = store.applyEffects(db, [{ type: "pregnancy", op: "confirm", fatherIds }]);
    if (r.ok) doAutosave();
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
          onOpenMap={() => {
            setMapAtRoot(false); // open on the current board so 返回 climbs to 主图
            setView("map");
          }}
          onOpenSave={() => setView("save")}
          onStartEvent={startEvent}
          onManage={(id) => setManageCharId(id)}
          onBedchamber={(id) => beginBedchamber(id)}
          onFlipTablet={() => setFlipOpen(true)}
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
          atRoot={mapAtRoot}
          onTravelled={(rolledOver) => {
            doAutosave(); // travel autosave (plan §9)
            runCheckpoints(rolledOver);
          }}
          onEnterCurrent={() => setView("location")}
          onOpenView={(locationId) => {
            setFreeViewId(locationId);
            setView("freeview");
          }}
          onOpenSave={() => setView("save")}
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
              goHome(); // 事件结束 → 跳回皇城主地图
              return;
            }
            // Abandoned mid-scene (零代价离开): back to the room you were in.
            setView("location");
          }}
        />
      )}
      {manageCharId && store.getState().standing[manageCharId] && (
        <RankAdminModal
          db={db}
          character={db.characters[manageCharId]!}
          standing={store.getState().standing[manageCharId]!}
          onApply={(req) => applyRankOp(manageCharId, req)}
          onClose={() => setManageCharId(null)}
        />
      )}
      {reaction && (
        <ReactionScreen
          db={db}
          store={store}
          registry={registry}
          speakerId={reaction.speakerId}
          lines={reaction.lines}
          onDone={() => setReaction(null)}
        />
      )}
      {flipOpen && (
        <BedchamberPicker
          db={db}
          state={store.getState()}
          onPick={beginBedchamber}
          onClose={() => setFlipOpen(false)}
        />
      )}
      {bedchamberPickId && db.characters[bedchamberPickId] && (
        <BedchamberModal
          name={db.characters[bedchamberPickId]!.profile.name}
          onChoose={chooseBedchamberMode}
          onClose={() => setBedchamberPickId(null)}
        />
      )}
      {bedchamberRun && (
        <BedchamberScene
          db={db}
          store={store}
          registry={registry}
          speakerId={bedchamberRun.charId}
          lines={bedchamberRun.lines}
          onDone={() => commitBedchamber(bedchamberRun)}
        />
      )}
      {firstNightPromptId && (
        <div className="modal-backdrop">
          <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{db.characters[firstNightPromptId]!.profile.name}　初承恩泽</h2>
            <p>是否晋升以彰圣眷？</p>
            <button
              type="button"
              onClick={() => {
                const id = firstNightPromptId;
                setFirstNightPromptId(null);
                setManageCharId(id);
              }}
            >
              晋升
            </button>
            <button type="button" onClick={() => setFirstNightPromptId(null)}>
              暂且不必
            </button>
          </div>
        </div>
      )}
      {pregnancyDue && fatherCandidates.length > 0 && (
        <PregnancyModal
          db={db}
          state={liveState}
          candidateIds={fatherCandidates}
          onConfirm={confirmPregnancy}
        />
      )}
      <DebugPanel store={store} db={db} logger={logger} onForceEvent={startEvent} />
    </>
  );
}
