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
import { buildBedchamber, passionAllowed, type BedchamberPlan } from "../store/bedchamber";
import { buildConversation } from "../store/conversation";
import { buildHeirSummon, buildHeirLesson, buildTutorReport, type HeirInteractionPlan } from "../store/heirInteraction";
import { buildEmpressDecree, type DecreeReaction } from "../store/empressDecree";
import { buildTaihouIllnessTick, buildShizhiEncounter, buildTaihouRebuke } from "../store/taihou";
import { ShangshufangScreen } from "./screens/ShangshufangScreen";
import { FengxiandianScreen } from "./screens/FengxiandianScreen";
import { CiningGongScreen } from "./screens/CiningGongScreen";
import { buildAdoptionReaction } from "../store/adoption";
import { ChildReactionScreen } from "./screens/ChildReactionScreen";
import { buildBirth, dueGestation } from "../store/gestation";
import { BirthScreen } from "./screens/BirthScreen";
import { BedchamberModal } from "./components/BedchamberModal";
import { BedchamberPicker } from "./components/BedchamberPicker";
import { JingshifangModal } from "./components/JingshifangModal";
import { HeirListModal } from "./components/HeirListModal";
import { ConsortListModal } from "./components/ConsortListModal";
import { HeirNameModal } from "./components/HeirNameModal";
import { centennialDue } from "../engine/characters/heirs";
import { randomPetName } from "../engine/characters/heirNames";
import { PhysicianModal } from "./components/PhysicianModal";
import { SuccessorModal } from "./components/SuccessorModal";
import { BedchamberScene } from "./screens/BedchamberScene";
import type { BedchamberMode } from "../engine/state/types";
import { RankAdminModal } from "./components/RankAdminModal";
import { DebugPanel } from "./debug/DebugPanel";
import { ResourcePanel } from "./components/ResourcePanel";
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

type View = "title" | "location" | "map" | "freeview" | "event" | "save" | "shangshufang" | "fengxiandian" | "cining_gong";

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
  const [postBirthPromoteId, setPostBirthPromoteId] = useState<string | null>(null);
  // 对话/反应/初夜提示等过场若耗尽行动点导致换旬，待过场关闭后再补跑 time_advance checkpoint。
  const [reactionRollover, setReactionRollover] = useState(false);
  // 侍寝流程：选人 → 选模式 → 播放体验 → 提交（→ 初夜晋升）
  const [flipOpen, setFlipOpen] = useState(false);
  const [bedchamberPickId, setBedchamberPickId] = useState<string | null>(null);
  const [bedchamberRun, setBedchamberRun] = useState<BedchamberPlan | null>(null);
  const [firstNightPromptId, setFirstNightPromptId] = useState<string | null>(null);
  // The 皇城主地图 is home: 新游戏 and 事件结束 land here (atRoot); the location's
  // 宫城图 button opens the map on the current board instead (atRoot=false).
  const [mapAtRoot, setMapAtRoot] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [successorOpen, setSuccessorOpen] = useState(false);
  const [successorDismissedMonth, setSuccessorDismissedMonth] = useState<number | null>(null);
  const [centennialDismissedMonth, setCentennialDismissedMonth] = useState<number | null>(null);
  const [physicianOpen, setPhysicianOpen] = useState(false);
  const [heirListOpen, setHeirListOpen] = useState(false);
  const [consortListOpen, setConsortListOpen] = useState(false);
  const [summonedConsortId, setSummonedConsortId] = useState<string | null>(null);
  const [childReaction, setChildReaction] = useState<HeirInteractionPlan | null>(null);
  const [namePetHeirId, setNamePetHeirId] = useState<string | null>(null);
  const [reactionQueue, setReactionQueue] = useState<{ speakerId: string; lines: string[] }[]>([]);
  const [resourcePanelOpen, setResourcePanelOpen] = useState(false);
  const chainDepth = useRef(0);
  const rolledSlots = useRef<Set<string>>(new Set());
  const tickedPeriods = useRef<Set<string>>(new Set());
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

  /** Pick the right room view for the player's current location (specialized screens vs generic). */
  const enterCurrentLocation = () => {
    const loc = store.getState().playerLocation;
    if (loc === "cining_gong") { setView("cining_gong"); maybeShizhi(); return; }
    setView(loc === "shangshufang" ? "shangshufang" : loc === "fengxiandian" ? "fengxiandian" : "location");
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

  /** 重置每旬/每行动点的去重 ref：新游戏或读档后必须清空，否则旧局的 key（rngSeed 固定为 1）会压制本局掷骰。 */
  const resetRollGuards = () => {
    rolledSlots.current.clear();
    tickedPeriods.current.clear();
  };

  const continueGame = () => {
    if (!storage) return;
    const result = loadWithRecovery(storage, db, { logger });
    if (result.ok) {
      store.loadState(result.value.state);
      resetRollGuards();
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
    else if (store.getState().playerLocation === "shangshufang") setView("shangshufang");
    else if (store.getState().playerLocation === "fengxiandian") setView("fengxiandian");
    else if (store.getState().playerLocation === "cining_gong") { setView("cining_gong"); maybeShizhi(); }
    else setView("location"); // arrived somewhere with no event → show that room
  };

  /** 为本次行动消耗的每个行动点掷骰凤后懿旨（命中即应用，至多一道/次）。返回台词节拍。 */
  const rollDecree = (before: { apMax: number; ap: number; dayIndex: number }, amount: number): DecreeReaction[] => {
    const beats: DecreeReaction[] = [];
    for (let i = 0; i < amount; i++) {
      const slot = before.apMax - before.ap + i;
      const key = `${store.getState().rngSeed}:${before.dayIndex}:${slot}`;
      if (rolledSlots.current.has(key)) continue;
      rolledSlots.current.add(key);
      const plan = buildEmpressDecree(db, store.getState(), key);
      if (plan) {
        const applied = store.applyEffects(db, plan.effects);
        if (applied.ok) {
          beats.push(...plan.reactions);
          break; // 单次行动至多一道懿旨
        }
      }
    }
    return beats;
  };

  /** 每行动点掷太后敲打（独立于懿旨；至多一次/行动）。返回台词节拍。 */
  const rollRebuke = (before: { apMax: number; ap: number; dayIndex: number }, amount: number): DecreeReaction[] => {
    const beats: DecreeReaction[] = [];
    for (let i = 0; i < amount; i++) {
      const slot = before.apMax - before.ap + i;
      const key = `rebuke:${store.getState().rngSeed}:${before.dayIndex}:${slot}`;
      if (rolledSlots.current.has(key)) continue;
      rolledSlots.current.add(key);
      const plan = buildTaihouRebuke(db, store.getState(), key);
      if (plan) {
        const applied = store.applyEffects(db, plan.effects);
        if (applied.ok) { beats.push(...plan.beats); break; }
      }
    }
    return beats;
  };

  /** 旬翻转：掷太后生病/自愈，应用效果并返回提示节拍（每旬至多一次）。 */
  const rollTaihouIllness = (): DecreeReaction[] => {
    const cal = store.getState().calendar;
    const key = `${store.getState().rngSeed}:${cal.year}:${cal.month}:${cal.period}`;
    if (tickedPeriods.current.has(key)) return [];
    tickedPeriods.current.add(key);
    const tick = buildTaihouIllnessTick(store.getState(), key);
    if (!tick) return [];
    const applied = store.applyEffects(db, tick.effects);
    if (!applied.ok) return [];
    return tick.beats;
  };

  /** 进慈宁宫且太后病中：掷侍疾遭遇，命中即应用并串播。返回是否已起反应。 */
  const maybeShizhi = (): boolean => {
    const cal = store.getState().calendar;
    const key = `${cal.year}:${cal.month}:${cal.period}`;
    const plan = buildShizhiEncounter(db, store.getState(), key);
    if (!plan) return false;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return false;
    doAutosave();
    const [first, ...rest] = plan.beats;
    setReactionQueue((q) => [...q, ...rest]);
    if (first) setReaction(first);
    return true;
  };

  /** 集中化行动点消耗：扣点 + 凤后懿旨掷骰 + 太后敲打掷骰。返回扣点结果与台词。 */
  const spendAp = (amount: number) => {
    const before = store.getState().calendar;
    const spend = store.dispatch({ type: "SPEND_AP", amount });
    let decreeBeats = spend.ok ? rollDecree(before, amount) : [];
    if (spend.ok) decreeBeats = [...decreeBeats, ...rollRebuke(before, amount)];
    if (spend.ok && spend.value.rolledOver) decreeBeats = [...decreeBeats, ...rollTaihouIllness()];
    return { spend, decreeBeats };
  };

  /** 串播一组反应节拍（行动自身台词 + 凤后懿旨），空则按需补跑转旬 checkpoint。 */
  const playReactions = (beats: DecreeReaction[], rolledOver: boolean) => {
    if (beats.length === 0) {
      if (rolledOver) runCheckpoints(true);
      return;
    }
    setReaction(beats[0]!);
    setReactionQueue(beats.slice(1));
    if (rolledOver) setReactionRollover(true);
  };

  const newGame = () => {
    store.newGame(db);
    resetRollGuards();
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
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return; // AP guard backstop — don't autosave an un-spent encounter
    setSummonedConsortId(null);
    doAutosave();
    const firstNight = plan.isFirstNight && plan.charId !== "feng_hou";
    if (firstNight) {
      setFirstNightPromptId(plan.charId);
      if (spend.value.rolledOver) setReactionRollover(true); // 初夜提示关闭后再补跑
      // 初夜弹窗在上：懿旨入队，待晋升后续反应或「暂且不必」时排空。
      if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
    } else {
      // 非初夜：懿旨台词即时串播（playReactions 内含转旬补跑；无懿旨且转旬也会补跑）。
      playReactions(decreeBeats, spend.value.rolledOver);
    }
  };

  const liveState = store.getState();
  const preg = liveState.resources.bloodline.pregnancy;
  // 孕二月敬事房上书：pending 且已过受孕月。
  const jingshifangDue =
    preg.status === "pending" &&
    preg.conceivedAt !== undefined &&
    monthOrdinal(liveState.calendar) > monthOrdinal(preg.conceivedAt);
  const fatherCandidates = jingshifangDue
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

  const carrySelfPregnancy = () => {
    const r = store.applyEffects(db, [{ type: "pregnancy", op: "carry" }]);
    if (r.ok) doAutosave();
  };
  const designateCandidates = (charIds: string[]) => {
    const r = store.applyEffects(db, [
      { type: "pregnancy", op: "carry" },
      { type: "heir_designate", charIds },
    ]);
    if (r.ok) {
      doAutosave();
      setReaction({
        speakerId: charIds[0]!,
        lines: ["臣等谢陛下隆恩，必当尽心护持皇嗣。"],
      });
    }
  };

  // 帝王自身胎息（多线孕育下至多一条 carrier="sovereign"）。
  const sovereignGest = liveState.resources.bloodline.gestations.find((g) => g.carrier === "sovereign");
  const selfCarrying = preg.status === "carrying" && sovereignGest !== undefined;
  const gestMonth =
    sovereignGest !== undefined
      ? monthOrdinal(liveState.calendar) - monthOrdinal(sovereignGest.conceivedAt) + 1
      : 0;
  // 孕三月自动弹宗正寺；孕四–九月由御书房「召见宗正寺」手动开。
  const successorAutoDue =
    selfCarrying && gestMonth === 3 && successorDismissedMonth !== monthOrdinal(liveState.calendar);
  const canSummonZongzheng = selfCarrying && gestMonth >= 4 && gestMonth <= 9;
  const consortCarrying = liveState.resources.bloodline.gestations.some((g) => g.carrier !== "sovereign");

  const centennialHeir =
    centennialDismissedMonth === monthOrdinal(liveState.calendar)
      ? null
      : liveState.resources.bloodline.heirs.find((h) => centennialDue(h, liveState.calendar)) ?? null;

  // 逐条生产：取当前到产的第一条胎息，生产提交后重渲染再取下一条。
  const dueGest = dueGestation(db, liveState);
  const activeBirthPlan = dueGest ? buildBirth(db, liveState, dueGest) : null;
  const birthSpeaker = activeBirthPlan
    ? activeBirthPlan.bearer === "sovereign" ||
      activeBirthPlan.bearerOutcome === "bearer_dies" ||
      activeBirthPlan.bearerOutcome === "both"
      ? "sili_nvguan"
      : activeBirthPlan.bearer
    : "sili_nvguan";

  const commitBirth = () => {
    const plan = activeBirthPlan;
    if (!plan) return;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    const heirsNow = store.getState().resources.bloodline.heirs;
    const newborn = heirsNow[heirsNow.length - 1];
    if (newborn && plan.bearerOutcome !== "child_dies" && plan.bearerOutcome !== "both") {
      setNamePetHeirId(newborn.id);
    }
    if (plan.bearerOutcome === "safe" && plan.bearer !== "sovereign" && plan.bearer !== "feng_hou") {
      setReaction({
        speakerId: "feng_hou",
        lines: ["恭喜陛下喜得麟儿。立功侍君劳苦功高，可愿晋升以彰圣眷？"],
      });
      setPostBirthPromoteId(plan.bearer);
    } else if (plan.bearerOutcome === "safe") {
      setReaction({ speakerId: "feng_hou", lines: ["恭喜陛下喜得麟儿，宗祧有继，举国同庆。"] });
    }
  };

  const abortPregnancy = () => {
    setPhysicianOpen(false);
    const r = store.applyEffects(db, [{ type: "pregnancy_abort" }]);
    if (r.ok) {
      doAutosave();
      setReaction({ speakerId: "sili_nvguan", lines: ["太医奉旨调理，陛下凤体已无大碍。此事到此为止。"] });
    }
  };

  // 候选承嗣注释管理（御书房）：同时段只能一位候选；传嗣/流产会自动清除。
  const addCandidate = (charId: string) => {
    const r = store.applyEffects(db, [{ type: "heir_candidate", op: "add", char: charId }]);
    if (r.ok) doAutosave();
  };
  const removeCandidate = (charId: string) => {
    const r = store.applyEffects(db, [{ type: "heir_candidate", op: "remove", char: charId }]);
    if (r.ok) doAutosave();
  };

  // 御书房·行动：批阅奏折（耗 2 行动点，提升朝堂资源）。
  const reviewMemorials = () => {
    setSummonedConsortId(null);
    if (store.getState().calendar.ap < 2) return; // 行动点不足
    const applied = store.applyEffects(db, [
      { type: "resource", pillar: "court", field: "authority", delta: 5 },
      { type: "resource", pillar: "court", field: "publicSupport", delta: 3 },
      { type: "resource", pillar: "court", field: "factionPressure", delta: -3 },
    ]);
    if (!applied.ok) return;
    const { spend, decreeBeats } = spendAp(2);
    if (!spend.ok) return;
    doAutosave();
    const own: DecreeReaction[] = spend.value.rolledOver
      ? []
      : [{ speakerId: "sili_nvguan", lines: ["奏折已批阅毕。陛下勤政忧国，朝野称颂，圣威日隆。"] }];
    playReactions([...own, ...decreeBeats], spend.value.rolledOver);
  };

  // 御书房·行动：独自休息（弃当旬剩余行动点，直接进入次旬早上）。
  const restAlone = () => {
    setSummonedConsortId(null);
    const spend = store.dispatch({ type: "SKIP_REMAINDER" });
    if (!spend.ok) return;
    doAutosave();
    const beats = rollTaihouIllness();
    if (beats.length) playReactions(beats, true);
    else runCheckpoints(true);
  };

  // 召见皇嗣（耗 1 行动点）：舞台感知反应台词 +20 宠爱。
  const summonHeir = (heirId: string) => {
    const plan = buildHeirSummon(db, store.getState(), heirId);
    if (!plan) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    setHeirListOpen(false);
    if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
    if (spend.value.rolledOver) setReactionRollover(true);
    setChildReaction(plan);
  };

  // 上书房·问功课（耗 1 行动点）：轮换一科 + 宠爱。
  const heirLesson = (heirId: string) => {
    const plan = buildHeirLesson(db, store.getState(), heirId);
    if (!plan) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
    if (spend.value.rolledOver) setReactionRollover(true);
    setChildReaction(plan);
  };

  // 上书房·问先生（耗 1 行动点）：汇报功课，不改属性。
  const tutorReport = (heirId: string) => {
    const lines = buildTutorReport(db, store.getState(), heirId);
    if (!lines) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    doAutosave();
    playReactions([{ speakerId: "sili_nvguan", lines }, ...decreeBeats], spend.value.rolledOver);
  };

  const adoptHeir = (heirId: string, fatherId: string) => {
    const heir = store.getState().resources.bloodline.heirs.find((h) => h.id === heirId);
    if (!heir) return;
    const reactions = buildAdoptionReaction(db, store.getState(), heir, fatherId);
    const spend = store.dispatch({ type: "SPEND_AP", amount: 1 });
    if (!spend.ok) return;
    const applied = store.applyEffects(db, [{ type: "heir_adopt", heirId, fatherId }]);
    if (!applied.ok) return;
    doAutosave();
    if (spend.value.rolledOver) setReactionRollover(true);
    const [first, ...rest] = reactions;
    setReactionQueue(rest);
    if (first) setReaction(first);
  };

  // 与在场侍君对话（耗 1 行动点）：脚本化反应台词。
  const converse = (charId: string) => {
    const lines = buildConversation(db, store.getState(), charId);
    if (!lines) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    setSummonedConsortId(null);
    doAutosave();
    playReactions([{ speakerId: charId, lines }, ...decreeBeats], spend.value.rolledOver);
  };

  const transferTo = (carrierId: string) => {
    setSuccessorOpen(false);
    const r = store.applyEffects(db, [{ type: "pregnancy_transfer", carrierId, atMonth: gestMonth }]);
    if (r.ok) {
      doAutosave();
      setReaction({ speakerId: carrierId, lines: ["臣领旨。臣定以血躯护持皇嗣，不负圣恩。"] });
    }
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
            setSummonedConsortId(null);
            setMapAtRoot(false); // open on the current board so 返回 climbs to 主图
            setView("map");
          }}
          onOpenSave={() => {
            setSummonedConsortId(null);
            setView("save");
          }}
          onStartEvent={startEvent}
          onManage={(id) => setManageCharId(id)}
          onBedchamber={(id) => beginBedchamber(id)}
          onFlipTablet={() => setFlipOpen(true)}
          onSummonZongzheng={canSummonZongzheng ? () => setSuccessorOpen(true) : undefined}
          onSummonPhysician={() => setPhysicianOpen(true)}
          onOpenHeirs={() => setHeirListOpen(true)}
          onOpenConsorts={() => setConsortListOpen(true)}
          onReviewMemorials={reviewMemorials}
          onRestAlone={restAlone}
          onConverse={converse}
          onOpenResources={() => setResourcePanelOpen(true)}
          summonedConsortId={summonedConsortId}
          onDismissSummon={() => setSummonedConsortId(null)}
        />
      )}
      {view === "shangshufang" && (
        <ShangshufangScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => {
            setMapAtRoot(false); // open on the current board so 返回 climbs to 主图
            setView("map");
          }}
          onOpenSave={() => setView("save")}
          onLesson={heirLesson}
          onTutorReport={tutorReport}
        />
      )}
      {view === "fengxiandian" && (
        <FengxiandianScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => { setMapAtRoot(false); setView("map"); }}
          onOpenSave={() => setView("save")}
          onAdopt={adoptHeir}
        />
      )}
      {view === "cining_gong" && (
        <CiningGongScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => { setMapAtRoot(false); setView("map"); }}
          onOpenSave={() => setView("save")}
          // ev_taihou_converse 用 checkpoint:"game_start" 故永不自动触发，只由此按钮手动开启；勿改成 location_enter（会变强制弹出）。
          onConverse={() => startEvent("ev_taihou_converse")}
          onOpenResources={() => setResourcePanelOpen(true)}
        />
      )}
      {view === "save" && (
        <SaveLoadScreen
          db={db}
          store={store}
          storage={storage}
          logger={logger}
          gameStarted
          onClose={enterCurrentLocation}
          onLoaded={() => { resetRollGuards(); enterCurrentLocation(); }}
        />
      )}
      {view === "map" && (
        <MapScreen
          db={db}
          store={store}
          registry={registry}
          atRoot={mapAtRoot}
          onTravelled={(rolledOver) => {
            doAutosave();
            const cal = store.getState().calendar;
            const key = `${store.getState().rngSeed}:${cal.dayIndex}:travel:${cal.ap}`;
            let beats: DecreeReaction[] = [];
            if (!rolledSlots.current.has(key)) {
              rolledSlots.current.add(key);
              const plan = buildEmpressDecree(db, store.getState(), key);
              if (plan) {
                const applied = store.applyEffects(db, plan.effects);
                if (applied.ok) beats = plan.reactions;
              }
            }
            if (rolledOver) beats = [...beats, ...rollTaihouIllness()];
            if (beats.length) playReactions(beats, rolledOver);
            else runCheckpoints(rolledOver);
          }}
          onEnterCurrent={enterCurrentLocation}
          onOpenView={(locationId) => {
            setFreeViewId(locationId);
            setView("freeview");
          }}
          onOpenSave={() => setView("save")}
          onClose={() => setView("location")}
          onOpenResources={() => setResourcePanelOpen(true)}
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
          onDone={(committed, rolledOver) => {
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
              // 若本场景消耗行动点导致转旬/转月，立刻触发 time_advance 事件，
              // 不必等玩家转换地图再 trigger。
              if (rolledOver) {
                // 场景提交导致转旬：补掷太后生病（其余转旬路径走 spendAp/travel/restAlone）。
                const illnessBeats = rollTaihouIllness();
                if (illnessBeats.length) {
                  const [first, ...rest] = illnessBeats;
                  setReactionQueue((q) => [...q, ...rest]);
                  setReaction(first!);
                }
                const t = pickNextEvent(db, store.getState(), "time_advance");
                if (t && chainDepth.current < MAX_EVENT_CHAIN) {
                  chainDepth.current += 1;
                  setActiveEventId(t.id);
                  return;
                }
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
          onDone={() => {
            setReaction(null);
            if (reactionQueue.length > 0) {
              const [nextLine, ...rest] = reactionQueue;
              setReactionQueue(rest);
              setReaction(nextLine!);
              return;
            }
            if (postBirthPromoteId) {
              const id = postBirthPromoteId;
              setPostBirthPromoteId(null);
              setManageCharId(id);
            } else if (reactionRollover) {
              setReactionRollover(false);
              runCheckpoints(true); // 对话耗尽行动点导致换旬 → 补跑时间推进 checkpoint
            }
          }}
        />
      )}
      {flipOpen && (
        <BedchamberPicker
          db={db}
          state={store.getState()}
          onPick={(id) => {
            setFlipOpen(false);
            setSummonedConsortId(id);
          }}
          onClose={() => setFlipOpen(false)}
        />
      )}
      {consortListOpen && (
        <ConsortListModal
          db={db}
          state={liveState}
          registry={registry}
          sovereignPregnant={preg.status !== "none"}
          onManage={(id) => setManageCharId(id)}
          onSummon={(id) => {
            setConsortListOpen(false);
            setSummonedConsortId(id);
          }}
          onAddCandidate={addCandidate}
          onRemoveCandidate={removeCandidate}
          onClose={() => setConsortListOpen(false)}
        />
      )}
      {bedchamberPickId && db.characters[bedchamberPickId] && (
        <BedchamberModal
          name={db.characters[bedchamberPickId]!.profile.name}
          passionAllowed={passionAllowed(store.getState(), bedchamberPickId)}
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
            <button
              type="button"
              onClick={() => {
                setFirstNightPromptId(null);
                if (reactionQueue.length > 0) {
                  // 先串播待播的凤后懿旨；其 onDone 会接手转旬补跑（reactionRollover 保留）。
                  const [next, ...rest] = reactionQueue;
                  setReactionQueue(rest);
                  setReaction(next!);
                } else if (reactionRollover) {
                  setReactionRollover(false);
                  runCheckpoints(true); // 初夜恰逢转旬 → 补跑时间推进 checkpoint
                }
              }}
            >
              暂且不必
            </button>
          </div>
        </div>
      )}
      {activeBirthPlan && (
        <BirthScreen
          db={db}
          store={store}
          registry={registry}
          speakerId={birthSpeaker}
          lines={activeBirthPlan.lines}
          onDone={commitBirth}
        />
      )}
      {jingshifangDue && (
        <JingshifangModal
          db={db}
          state={liveState}
          fatherCandidates={fatherCandidates}
          onSelfPregnancy={carrySelfPregnancy}
          onDesignate={designateCandidates}
        />
      )}
      {(successorAutoDue || successorOpen) && selfCarrying && (
        <SuccessorModal
          db={db}
          state={liveState}
          onTransfer={transferTo}
          onKeep={() => {
            setSuccessorOpen(false);
            setSuccessorDismissedMonth(monthOrdinal(liveState.calendar));
          }}
        />
      )}
      {physicianOpen && (
        <PhysicianModal
          selfCarrying={selfCarrying}
          consortCarrying={consortCarrying}
          onAbort={abortPregnancy}
          onClose={() => setPhysicianOpen(false)}
        />
      )}
      {heirListOpen && (
        <HeirListModal
          db={db}
          state={liveState}
          registry={registry}
          onSummon={summonHeir}
          canSummon={liveState.calendar.ap >= 1}
          onClose={() => setHeirListOpen(false)}
        />
      )}
      {namePetHeirId && (
        <HeirNameModal
          title="为新生皇嗣起个小名"
          hint="乳名一双字，亲昵相唤。"
          confirmLabel="起名"
          onRandom={() => randomPetName(store.getState().rngSeed, namePetHeirId)}
          onConfirm={(name) => {
            const id = namePetHeirId;
            setNamePetHeirId(null);
            const r = store.applyEffects(db, [{ type: "heir_name", heirId: id, field: "pet", name }]);
            if (r.ok) doAutosave();
          }}
        />
      )}
      {!namePetHeirId && centennialHeir && (
        <HeirNameModal
          title="百日宴 · 为皇嗣赐名"
          hint="皇嗣已满百日，请陛下赐下正名。"
          confirmLabel="赐名"
          onConfirm={(name) => {
            const r = store.applyEffects(db, [{ type: "heir_name", heirId: centennialHeir.id, field: "given", name }]);
            if (r.ok) {
              doAutosave();
              setReaction({ speakerId: "sili_nvguan", lines: [`司礼官高唱：皇嗣赐名「${name}」，宗祠登册，举宫同贺。`] });
            }
          }}
          onDismiss={() => setCentennialDismissedMonth(monthOrdinal(liveState.calendar))}
        />
      )}
      {childReaction && (
        <ChildReactionScreen
          db={db}
          store={store}
          registry={registry}
          portraitSet={childReaction.portraitSet}
          speakerName={childReaction.speakerName}
          lines={childReaction.lines}
          onDone={() => {
            setChildReaction(null);
            if (reactionQueue.length > 0) {
              const [next, ...rest] = reactionQueue;
              setReactionQueue(rest);
              setReaction(next!);
              return;
            }
            if (reactionRollover) {
              setReactionRollover(false);
              runCheckpoints(true);
            }
          }}
        />
      )}
      {resourcePanelOpen && (
        <ResourcePanel state={liveState} onClose={() => setResourcePanelOpen(false)} />
      )}
      <DebugPanel store={store} db={db} logger={logger} onForceEvent={startEvent} />
    </>
  );
}
