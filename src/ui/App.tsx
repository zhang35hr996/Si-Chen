import { useEffect, useMemo, useRef, useState } from "react";
import rawManifest from "../../assets/manifest.json";
import { assetManifestSchema } from "../engine/assets/manifest";
import { AssetRegistry } from "../engine/assets/registry";
import { loadGameContent } from "../engine/content/viteSource";
import { pickNextEvent } from "../engine/events/engine";
import { assetError, stateError } from "../engine/infra/errors";
import type { RingBufferLogger } from "../engine/infra/logger";
import { autosave, listSaves, loadWithRecovery } from "../engine/save/saveSystem";
import { createLocalStorageAdapter } from "../engine/save/storage";
import { greetingAttendees } from "../engine/characters/greeting";
import type { GameStore } from "../store/gameStore";
import { buildRankOp, type RankOpRequest } from "../store/rankOps";
import { monthOrdinal, isGreetingSlot } from "../engine/calendar/time";
import { getCharacterLocation } from "../engine/characters/presence";
import { buildBedchamber, passionAllowed, type BedchamberPlan } from "../store/bedchamber";
import { buildConversation } from "../store/conversation";
import { assembleDialogueRequest, produceDialogueTurn } from "../engine/dialogue/orchestrator";
import type { DialogueLine, DialogueProvider } from "../engine/dialogue/types";
import { buildHeirSummon, buildHeirLesson, buildTutorReport, type HeirInteractionPlan } from "../store/heirInteraction";
import { buildEmpressDecree, type DecreeReaction } from "../store/empressDecree";
import { buildChengFengGossip, chengFengHaremGreeting } from "../store/chengFeng";
import { buildProvinceTribute, buildMinisterTribute } from "../store/tribute";
import { buildAutumnHuntPrompt } from "../store/autumnHunt";
import { ChengFengPromptScreen } from "./screens/ChengFengPromptScreen";
import { DianxuanScreen } from "./screens/DianxuanScreen";
import {
  buildDaxuanAnnounce, buildDaxuanDianxuanPrompt, generateCandidates,
  npcKeepOnDelegate, npcKeepOnLeave, daxuanDianxuanFlagKey,
  type Candidate,
} from "../store/grandSelection";
import { useGameState } from "../store/useGameState";
import { BestowModal } from "./components/BestowModal";
import { MORNING_SLOT, AFTERNOON_SLOT } from "../engine/calendar/time";
import type { ChengFengPrompt, PromptAction } from "../store/prompt";
import { buildIncense, buildFortune } from "../store/temple";
import { buildShizhiEncounter, buildTaihouRebuke } from "../store/taihou";
import { audioController } from "./audio/AudioController";
import { trackFor } from "./audio/trackFor";
import { CourtyardScreen } from "./screens/CourtyardScreen";
import { buildTravelBatch } from "../engine/map/travel";
import { ShangshufangScreen } from "./screens/ShangshufangScreen";
import { YuqingGongScreen } from "./screens/YuqingGongScreen";
import { FengxiandianScreen } from "./screens/FengxiandianScreen";
import { CiningGongScreen } from "./screens/CiningGongScreen";
import { buildAdoptionReaction } from "../store/adoption";
import { CharacterReactionScreen } from "./screens/CharacterReactionScreen";
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
import { courtPhysician } from "../engine/characters/taiyi";
import { planPhysicianVisit, buildConsultOptions, physicianVisitedThisMonth, type PhysicianSubject } from "../store/physician";
import { livingConsortIds } from "../store/healthRoster";
import { heirPortraitSet, heirAge, listHeirsBySex } from "../engine/characters/heirs";
import { SuccessorModal } from "./components/SuccessorModal";
import { BedchamberScene } from "./screens/BedchamberScene";
import type { BedchamberMode, ChamberId } from "../engine/state/types";
import { RankAdminModal } from "./components/RankAdminModal";
import { RelocateModal } from "./components/RelocateModal";
import { GreetingCeremonyOverlay } from "./components/GreetingCeremonyOverlay";
import { MorningAfterOverlay } from "./components/MorningAfterOverlay";
import { buildRelocate } from "../store/relocate";
import { planPregnancyTransfer } from "../store/pregnancyCost";
import { canHoldCourt, canBedchamber } from "../store/gating";
import { CharacterProfileDrawer } from "./components/CharacterProfileDrawer";
import { DebugPanel } from "./debug/DebugPanel";
import { ResourcePanel } from "./components/ResourcePanel";
import { BootErrorScreen } from "./screens/BootErrorScreen";
import { pickCourtAffairs } from "../engine/court/affairs";
import { DialogueScreen } from "./screens/DialogueScreen";
import { FreeViewScreen } from "./screens/FreeViewScreen";
import { LocationScreen } from "./screens/LocationScreen";
import { MapScreen } from "./screens/MapScreen";
import { ReactionScreen } from "./screens/ReactionScreen";
import { SettingsMenu } from "./components/SettingsMenu";
import { TitleScreen } from "./screens/TitleScreen";
import { CoronationScreen } from "./screens/CoronationScreen";
import { StorehouseScreen } from "./screens/StorehouseScreen";
import { ShopScreen } from "./screens/ShopScreen";

/** Cap on scene_end→event chains per player action (plan §10 #9 latent guard). */
const MAX_EVENT_CHAIN = 3;

type View = "title" | "coronation" | "location" | "map" | "freeview" | "event" | "court" | "wenzhaodian" | "yuqing_gong" | "fengxiandian" | "cining_gong" | "courtyard" | "shop" | "dianxuan";

/** 上朝会话：进殿即扣 1 行动点，随机抽取的 2–3 件事务逐件处理；可随时退朝。 */
interface CourtSession {
  queue: string[];
  index: number;
}

export function App({ store, logger, dialogueProvider }: { store: GameStore; logger?: RingBufferLogger; dialogueProvider?: DialogueProvider }) {
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
  const [court, setCourt] = useState<CourtSession | null>(null);
  const [freeViewId, setFreeViewId] = useState<string | null>(null);
  const [manageCharId, setManageCharId] = useState<string | null>(null);
  const [relocateCharId, setRelocateCharId] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{ speakerId: string; lines: string[]; backgroundKey?: string; generatedLine?: DialogueLine } | null>(null);
  const [postBirthPromoteId, setPostBirthPromoteId] = useState<string | null>(null);
  // 对话/反应/初夜提示等过场若耗尽行动点导致换旬，待过场关闭后再补跑 time_advance checkpoint。
  const [reactionRollover, setReactionRollover] = useState(false);
  // 出宫结算若需延后补跑 checkpoint（懿旨过场后换旬），记下「留在地图」意图，
  // 使补跑不按 playerLocation 把视图切回房间（玩家在京城板，位置未变）。
  const [reactionStayOnMap, setReactionStayOnMap] = useState(false);
  // 侍寝流程：选人 → 选模式 → 播放体验 → 提交（→ 初夜晋升）
  const [flipOpen, setFlipOpen] = useState(false);
  const [bedchamberPickId, setBedchamberPickId] = useState<string | null>(null);
  const [bedchamberRun, setBedchamberRun] = useState<BedchamberPlan | null>(null);
  const [firstNightPromptId, setFirstNightPromptId] = useState<string | null>(null);
  // The 皇城主地图 is home: 新游戏 and 事件结束 land here (atRoot); the location's
  // 宫城图 button opens the map on the current board instead (atRoot=false).
  const [mapAtRoot, setMapAtRoot] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  // 轻量系统提示横幅（如太后已薨时进慈宁宫）。非角色台词，独立于视图渲染。
  const [notice, setNotice] = useState<string | null>(null);
  const [successorOpen, setSuccessorOpen] = useState(false);
  const [successorDismissedMonth, setSuccessorDismissedMonth] = useState<number | null>(null);
  const [centennialDismissedMonth, setCentennialDismissedMonth] = useState<number | null>(null);
  const [physicianOpen, setPhysicianOpen] = useState(false);
  const [heirListOpen, setHeirListOpen] = useState(false);
  const [consortListOpen, setConsortListOpen] = useState(false);
  // 从「查看侍君」列表进入封号管理/搬迁时记录该侍君：先关列表（两个弹窗叠层会互相遮挡点击），
  // 操作（或取消）结束后据此重开列表并定位回同一位侍君。非列表入口（紫宸殿卡片/召见）保持 null。
  const [consortListReturnId, setConsortListReturnId] = useState<string | null>(null);
  const [summonedConsortId, setSummonedConsortId] = useState<string | null>(null);
  const [physicianReaction, setPhysicianReaction] = useState<{ portraitSet: string; speakerName: string; lines: string[] } | null>(null);
  const [physicianConsortPickerOpen, setPhysicianConsortPickerOpen] = useState(false);
  const [physicianHeirPickerOpen, setPhysicianHeirPickerOpen] = useState(false);
  const [childReaction, setChildReaction] = useState<HeirInteractionPlan | null>(null);
  const [namePetHeirId, setNamePetHeirId] = useState<string | null>(null);
  const [reactionQueue, setReactionQueue] = useState<{ speakerId: string; lines: string[]; backgroundKey?: string; generatedLine?: DialogueLine }[]>([]);
  const [resourcePanelOpen, setResourcePanelOpen] = useState(false);
  // 国库与国情一致：浮层，任意画面可开，关闭后回到原处（不切 view）。
  const [storehouseOpen, setStorehouseOpen] = useState(false);
  const [profileCharId, setProfileCharId] = useState<string | null>(null);
  const [courtyardLocId, setCourtyardLocId] = useState<string | null>(null);
  const [focusConsortId, setFocusConsortId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shopId, setShopId] = useState<"wanbaolou" | "zuixianlou" | null>(null);
  const [currentBoard, setCurrentBoard] = useState<string>("palace");
  const [prompt, setPrompt] = useState<ChengFengPrompt | null>(null);
  const [giftItemId, setGiftItemId] = useState<string | null>(null);
  const [daxuanPrompt, setDaxuanPrompt] = useState<ChengFengPrompt | null>(null);
  const [dianxuan, setDianxuan] = useState<{ candidates: Candidate[]; year: number } | null>(null);
  const lastBoardRef = useRef<string>("palace");
  const chainDepth = useRef(0);
  const rolledSlots = useRef<Set<string>>(new Set());
  const shopRollover = useRef(false);
  const storage = useMemo(() => createLocalStorageAdapter(), []);

  // BGM effect: compute zone defensively (content may not be ok)
  const bgmZone = content.ok ? content.value.locations[store.getState().playerLocation]?.zone : undefined;
  useEffect(() => {
    audioController.play(trackFor({ view, board: currentBoard, zone: bgmZone }));
  }, [view, currentBoard, bgmZone]);

  // 大选·四月 prompt：进入房间且到节点时声明式弹出（reactiveState 订阅日历驱动重算）。
  const reactiveState = useGameState(store);

  // 死者视图清理：被召见的侍君若在跨月健康 tick 中身故，清除召见态（不在死者宫中停留）。
  useEffect(() => {
    if (!summonedConsortId) return;
    if (reactiveState.standing[summonedConsortId]?.lifecycle === "deceased") {
      setSummonedConsortId(null);
    }
  }, [reactiveState.standing, summonedConsortId]);
  useEffect(() => {
    if (!content.ok) return;
    if (view !== "location" || daxuanPrompt || dianxuan) return;
    const p = buildDaxuanDianxuanPrompt(content.value, store.getState());
    if (p) setDaxuanPrompt(p);
  }, [reactiveState.calendar.dayIndex, reactiveState.calendar.ap, view, daxuanPrompt, dianxuan]);

  if (!content.ok || !manifest.success) {
    const errors = [
      ...(content.ok ? [] : content.error),
      ...(manifest.success
        ? []
        : [assetError("SCHEMA", `assets/manifest.json: ${manifest.error.message}`, { severity: "fatal" })]),
    ];
    return <BootErrorScreen errors={errors} />;
  }
  // 合并殿选落库的生成侍君，使其在房间/院子等界面可见（每渲染重算，开销低）。
  const db = {
    ...content.value,
    characters: { ...content.value.characters, ...store.getState().generatedConsorts },
  };

  const startEvent = (eventId: string) => {
    // 上朝是一场会话而非单个事件：进殿即扣 1 行动点，随机抽 2–3 件事务逐件处理。
    if (eventId === "ev_chaohui") {
      beginCourt();
      return;
    }
    chainDepth.current = 0; // player-initiated start resets the chain budget
    setActiveEventId(eventId);
    setView("event");
  };

  /**
   * 开启上朝会话：背书校验（卯时首个行动点且充足）→ 一次性扣 1 行动点 →
   * 按 rngSeed+当日 抽取 2–3 件朝政事务 → 进入逐件处理。整场只此一次扣点；
   * 卯时满点扣 1 不会转旬，故无需处理 rollover。
   */
  const beginCourt = () => {
    const courtGate = canHoldCourt(store.getState());
    if (!courtGate.ok) { setReaction({ speakerId: "wei_sui", lines: [courtGate.reason] }); return; }
    const before = store.getState();
    const ev = db.events["ev_chaohui"];
    if (!ev || before.calendar.ap < ev.apCost || before.calendar.ap !== before.calendar.apMax) return;
    // 进殿即扣 apCost；满点扣点不会转旬/跨月，故 healthOutcome 必为 null（统一入口仍走一遍）。
    const spend = store.advanceTime(db, { type: "SPEND_AP", amount: ev.apCost });
    if (!spend.ok) return;
    if (spend.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    const cal = store.getState().calendar;
    const queue = pickCourtAffairs(db, `court:${store.getState().rngSeed}:${cal.dayIndex}`);
    doAutosave(); // 行动点已扣，先落盘，再进事务
    if (queue.length === 0) {
      goHome();
      return;
    }
    chainDepth.current = 0;
    setCourt({ queue, index: 0 });
    setView("court");
  };

  /** Return to the 皇城主地图 (home). Used by 新游戏 and after an event ends. */
  const goHome = () => {
    setMapAtRoot(true);
    setView("map");
    maybeAutumnHunt();
  };

  /** Pick the right room view for the player's current location (specialized screens vs generic). */
  const enterCurrentLocation = () => {
    const loc = store.getState().playerLocation;
    if (loc === "cining_gong") {
      if (store.getState().taihou.deceased) { setNotice("太后已驾鹤西去。"); goHome(); return; }
      setView("cining_gong"); maybeShizhi(); return;
    }
    setView(loc === "wenzhaodian" ? "wenzhaodian" : loc === "yuqing_gong" ? "yuqing_gong" : loc === "fengxiandian" ? "fengxiandian" : "location");
    if (loc === "wenzhaodian") maybeAutumnHunt();
  };

  /** Autosave hooks: scene commit + travel only (plan §9), never mid-scene. */
  const doAutosave = () => {
    if (storage) autosave(storage, db, store.getState(), { logger });
  };

  /** 若管理/搬迁是从「查看侍君」列表进入的，操作结束后重开列表（定位到该侍君）。 */
  const reopenConsortListIfReturning = () => {
    if (consortListReturnId) setConsortListOpen(true);
  };

  const applyRankOp = (charId: string, req: RankOpRequest) => {
    const op = buildRankOp(db, store.getState(), charId, req);
    setManageCharId(null);
    if (!op) {
      reopenConsortListIfReturning(); // 无变化：直接回到列表
      return;
    }
    const result = store.applyEffects(db, op.effects);
    if (result.ok) {
      doAutosave();
      setReaction({ speakerId: charId, lines: op.lines }); // 列表在反应播完后（onDone）重开
    } else {
      reopenConsortListIfReturning();
    }
  };

  const applyRelocate = (charId: string, location: string, chamber: ChamberId) => {
    const effects = buildRelocate(db, store.getState(), charId, location, chamber);
    setRelocateCharId(null);
    if (!effects) {
      reopenConsortListIfReturning(); // 无变化 / 非法目标
      return;
    }
    const result = store.applyEffects(db, effects);
    if (result.ok) doAutosave();
    reopenConsortListIfReturning(); // 搬迁无反应，立即回到列表
  };

  const canContinue =
    storage !== null &&
    listSaves(storage).some(
      (s) => (s.slot === "auto" || s.slot === "auto.prev") && s.status === "ok" && !s.gameOver,
    );

  /** 重置每行动点的去重 ref：新游戏或读档后必须清空，否则旧局的 key（rngSeed 固定为 1）会压制本局掷骰。 */
  const resetRollGuards = () => {
    rolledSlots.current.clear();
  };

  const continueGame = () => {
    if (!storage) return;
    const result = loadWithRecovery(storage, db, { logger });
    if (result.ok) {
      store.loadState(result.value.state);
      resetRollGuards();
      // 先帝已崩：该存档是终局，不可继续。回 title 并提示开新局。
      if (store.getState().gameOver) {
        setContinueError("先帝已崩，请开新局。");
        setView("title");
        return;
      }
      setContinueError(result.value.warnings.map((w) => w.message).join("；") || null);
      goHome();
    } else {
      setContinueError(result.error.map((e) => e.message).join("；"));
    }
  };

  /** Checkpoint wiring: time_advance (after a rollover) wins over location_enter. */
  const runCheckpoints = (rolledOver: boolean, stayOnMap = false) => {
    const state = store.getState();
    const pick =
      (rolledOver ? pickNextEvent(db, state, "time_advance") : null) ??
      pickNextEvent(db, state, "location_enter");
    if (pick) startEvent(pick.id);
    // 出宫：玩家位置未变（仍在紫宸殿），无 event 时须留在京城地图板，
    // 不能按 playerLocation 切回房间视图。
    else if (stayOnMap) setView("map");
    else if (store.getState().playerLocation === "wenzhaodian") setView("wenzhaodian");
    else if (store.getState().playerLocation === "yuqing_gong") setView("yuqing_gong");
    else if (store.getState().playerLocation === "fengxiandian") setView("fengxiandian");
    else if (store.getState().playerLocation === "cining_gong") {
      if (store.getState().taihou.deceased) { setNotice("太后已驾鹤西去。"); goHome(); }
      else { setView("cining_gong"); maybeShizhi(); }
    }
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

  /** 每行动点掷乘风八卦汇报（至多一条/行动）。返回台词节拍。 */
  const rollChengFeng = (before: { apMax: number; ap: number; dayIndex: number }, amount: number): DecreeReaction[] => {
    for (let i = 0; i < amount; i++) {
      const slot = before.apMax - before.ap + i;
      const key = `chengfeng:${store.getState().rngSeed}:${before.dayIndex}:${slot}`;
      if (rolledSlots.current.has(key)) continue;
      rolledSlots.current.add(key);
      const plan = buildChengFengGossip(db, store.getState(), key);
      if (plan) {
        const applied = store.applyEffects(db, plan.effects);
        if (applied.ok) return [plan.beat];
      }
    }
    return [];
  };

  /** 二月大选报告（节拍，设 flag）；每大选年一次。返回节拍。 */
  const rollDaxuanAnnounce = (): DecreeReaction[] => {
    const r = buildDaxuanAnnounce(db, store.getState());
    if (!r) return [];
    const applied = store.applyEffects(db, r.effects);
    if (!applied.ok) return [];
    return r.beats;
  };

  /** action 解释器：玩家在进贡/秋猎 prompt 中的选择。 */
  const resolvePromptAction = (action: PromptAction) => {
    switch (action.type) {
      case "stash":
        store.applyGrantItem(action.itemId);
        setPrompt(null);
        break;
      case "gift":
        // 先将贡品入库，再开赏赐弹窗（BestowModal 调 applyBestow 时扣库存净效果：+1 -1 = 0）。
        store.applyGrantItem(action.itemId);
        setGiftItemId(action.itemId);
        setPrompt(null);
        break;
      case "huntJoin": {
        const spend = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
        if (!spend.ok) { setPrompt(null); return; }
        if (spend.value.healthOutcome?.sovereignDied) { setPrompt(null); onSovereignDeath(); return; }
        const furs = store.applyAutumnHunt(`hunt:${store.getState().rngSeed}:${store.getState().calendar.year}`);
        const counts = new Map<string, number>();
        for (const id of furs) counts.set(id, (counts.get(id) ?? 0) + 1);
        const summary = [...counts].map(([id, n]) => `${db.items[id]?.name ?? id}×${n}`).join("、");
        setPrompt(null);
        // 秋猎归来：乘风在围场（qiulie 背景）汇报所获皮毛。
        setReaction({
          speakerId: "cheng_feng",
          lines: [`陛下今秋围猎尽兴，猎得${summary}，已尽数收入库房。`],
          backgroundKey: "bg.qiulie",
        });
        break;
      }
      case "huntDecline":
        store.declineAutumnHunt();
        setPrompt(null);
        break;
    }
  };

  /** 每行动点掷进贡 prompt（属地早上/大臣下午；每旬大臣至多一次）。命中则设 prompt 并返回 true。 */
  const rollTribute = (before: { apMax: number; ap: number; dayIndex: number }, amount: number): boolean => {
    for (let i = 0; i < amount; i++) {
      const slot = before.apMax - before.ap + i;
      const key = `tribute:${store.getState().rngSeed}:${before.dayIndex}:${slot}`;
      if (rolledSlots.current.has(key)) continue;
      let p: ChengFengPrompt | null = null;
      if (slot === MORNING_SLOT) p = buildProvinceTribute(db, store.getState(), key);
      else if (slot === AFTERNOON_SLOT) {
        const dedupe = `tributeMinister:${before.dayIndex}`;
        if (!store.getState().flags[dedupe]) {
          p = buildMinisterTribute(db, store.getState(), key);
          if (p) store.dispatch({ type: "SET_FLAG", key: dedupe, value: true });
        }
      }
      if (p) { rolledSlots.current.add(key); setPrompt(p); return true; }
    }
    return false;
  };

  /** 秋猎询问：9月中旬下午进入主地图/御书房时检查一次。命中则设 prompt 并返回 true。 */
  const maybeAutumnHunt = (): boolean => {
    const p = buildAutumnHuntPrompt(store.getState(), `hunt:${store.getState().rngSeed}`);
    if (p) { setPrompt(p); return true; }
    return false;
  };


  /** 进慈宁宫且太后病中：掷侍疾遭遇，命中即应用并串播。返回是否已起反应。 */
  const maybeShizhi = (): boolean => {
    if (store.getState().taihou.deceased) return false; // 太后已薨：不再侍疾。
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

  /**
   * 集中化行动点消耗：经统一时间入口扣点（含跨月健康 tick / 皇帝死亡同事务写 gameOver）
   * + 凤后懿旨掷骰 + 太后敲打掷骰 + 进贡掷骰 + 乘风汇报。返回扣点结果、台词、皇帝是否崩逝。
   * 皇帝崩逝时不再掷后续节拍（落在已 gameOver 的局上无意义），交调用方 short-circuit 回 title。
   */
  /** 行动结算后的随机节拍：凤后懿旨 + 太后敲打 + 进贡（命中则改走 prompt）/ 乘风汇报 + 大选报告。 */
  const rollActionBeats = (
    before: { apMax: number; ap: number; dayIndex: number },
    amount: number,
  ): DecreeReaction[] => {
    let beats = rollDecree(before, amount);
    beats = [...beats, ...rollRebuke(before, amount)];
    const tributeShown = rollTribute(before, amount);
    if (!tributeShown) beats = [...beats, ...rollChengFeng(before, amount)];
    beats = [...beats, ...rollDaxuanAnnounce()];
    return beats;
  };

  const spendAp = (amount: number) => {
    const before = store.getState().calendar;
    const spend = store.advanceTime(db, { type: "SPEND_AP", amount });
    const sovereignDied = spend.ok && spend.value.healthOutcome?.sovereignDied === true;
    const decreeBeats: DecreeReaction[] =
      spend.ok && !sovereignDied ? rollActionBeats(before, amount) : [];
    return { spend, decreeBeats, sovereignDied };
  };

  /** 皇帝崩逝表现层（最简，Task 6 集中化/加固）：清场回 title。gameOver 已在事务内写入。 */
  const onSovereignDeath = () => {
    setReaction(null);
    setReactionQueue([]);
    doAutosave();
    setView("title");
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

  const proceedAfterNewGame = () => {
    const pick = pickNextEvent(db, store.getState(), "game_start");
    if (pick) startEvent(pick.id);
    else goHome();
  };

  const newGame = () => {
    store.newGame(db);
    resetRollGuards();
    setView("coronation");
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
    const g = canBedchamber(store.getState()); // re-check with fresh state (state may have changed while scene was open)
    if (!g.ok) { setBedchamberRun(null); setReaction({ speakerId: "wei_sui", lines: [g.reason] }); return; }
    setBedchamberRun(null);
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    const { spend, decreeBeats, sovereignDied } = spendAp(1);
    if (!spend.ok) return; // AP guard backstop — don't autosave an un-spent encounter
    if (sovereignDied) { onSovereignDeath(); return; }
    store.recordOvernight(db, plan.charId, spend.value.rolledOver);
    setSummonedConsortId(null);
    doAutosave();
    const firstNight = plan.isFirstNight && plan.charId !== "shen_zhibai";
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

  const ov = liveState.overnightWith;
  const morningAfterCharId =
    ov &&
    ov.morningDayIndex === liveState.calendar.dayIndex &&
    isGreetingSlot(liveState.calendar) &&
    getCharacterLocation(db, liveState, ov.charId) === liveState.playerLocation
      ? ov.charId
      : null;

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
      ? "wei_sui"
      : activeBirthPlan.bearer
    : "wei_sui";

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
    if (plan.bearerOutcome === "safe" && plan.bearer !== "sovereign" && plan.bearer !== "shen_zhibai") {
      setReaction({
        speakerId: "shen_zhibai",
        lines: ["恭喜陛下喜得麟儿。立功侍君劳苦功高，可愿晋升以彰圣眷？"],
      });
      setPostBirthPromoteId(plan.bearer);
    } else if (plan.bearerOutcome === "safe") {
      setReaction({ speakerId: "shen_zhibai", lines: ["恭喜陛下喜得麟儿，宗祧有继，举国同庆。"] });
    }
  };

  const abortPregnancy = () => {
    setPhysicianOpen(false);
    const r = store.applyEffects(db, [{ type: "pregnancy_abort" }]);
    if (r.ok) {
      doAutosave();
      setReaction({ speakerId: "wei_sui", lines: ["太医奉旨调理，陛下凤体已无大碍。此事到此为止。"] });
    }
  };

  // 看诊执行（耗 1 AP，行动先于时间）。
  const doConsult = (subject: PhysicianSubject) => {
    const plan = planPhysicianVisit(liveState, subject, { ...liveState.calendar });
    if (!plan) return; // 目标不可看诊（已故/本月已看），UI 不应发起
    const settled = store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount: 1 });
    if (!settled.ok) return;
    if (settled.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    setPhysicianOpen(false);
    setPhysicianConsortPickerOpen(false);
    setPhysicianHeirPickerOpen(false);
    doAutosave();
    const physician = courtPhysician(store.getState().rngSeed);
    const lines: string[] = [];
    if (plan.cured) lines.push("太医诊脉施治，药石见效，病气已退。");
    if (plan.actualHealing > 0) lines.push(`调理一番，气色稍复（健康 +${plan.actualHealing}）。`);
    if (lines.length === 0) lines.push("太医诊脉后嘱咐，仍需静养调理。"); // 主体中性（太后/侍君/皇嗣皆可用，不写「陛下」）
    setPhysicianReaction({ portraitSet: physician.portraitSet, speakerName: physician.name, lines });
    if (settled.value.rolledOver) setReactionRollover(true);
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
      { type: "resource", pillar: "sovereign", field: "diligence", delta: 5 },
      { type: "resource", pillar: "nation", field: "governance", delta: 3 },
      { type: "resource", pillar: "nation", field: "publicSupport", delta: 3 },
    ]);
    if (!applied.ok) return;
    const { spend, decreeBeats, sovereignDied } = spendAp(2);
    if (!spend.ok) return;
    if (sovereignDied) { onSovereignDeath(); return; }
    doAutosave();
    const own: DecreeReaction[] = spend.value.rolledOver
      ? []
      : [{ speakerId: "wei_sui", lines: ["奏折已批阅毕。陛下勤政忧国，朝野称颂，圣威日隆。"] }];
    playReactions([...own, ...decreeBeats], spend.value.rolledOver);
  };

  // 御书房·行动：独自休息（弃当旬剩余行动点，直接进入次旬早上）。
  const restAlone = () => {
    setSummonedConsortId(null);
    const spend = store.advanceTime(db, { type: "SKIP_REMAINDER" });
    if (!spend.ok) return;
    if (spend.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    doAutosave();
    runCheckpoints(true);
  };

  // 召见皇嗣（耗 1 行动点）：舞台感知反应台词 +20 宠爱。行动先于时间，跨月 tick 不会杀死再宠爱。
  const summonHeir = (heirId: string) => {
    const plan = buildHeirSummon(db, store.getState(), heirId);
    if (!plan) return;
    const before = store.getState().calendar;
    const settled = store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount: 1 });
    if (!settled.ok) return;
    if (settled.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    const decreeBeats = rollActionBeats(before, 1);
    doAutosave();
    setHeirListOpen(false);
    if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
    if (settled.value.rolledOver) setReactionRollover(true);
    setChildReaction(plan);
  };

  // 上书房·问功课（耗 1 行动点）：轮换一科 + 宠爱。行动先于时间。
  const heirLesson = (heirId: string) => {
    const plan = buildHeirLesson(db, store.getState(), heirId);
    if (!plan) return;
    const before = store.getState().calendar;
    const settled = store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount: 1 });
    if (!settled.ok) return;
    if (settled.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    const decreeBeats = rollActionBeats(before, 1);
    doAutosave();
    if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
    if (settled.value.rolledOver) setReactionRollover(true);
    setChildReaction(plan);
  };

  // 上书房·问先生（耗 1 行动点）：汇报功课，不改属性。
  const tutorReport = (heirId: string) => {
    const lines = buildTutorReport(db, store.getState(), heirId);
    if (!lines) return;
    const { spend, decreeBeats, sovereignDied } = spendAp(1);
    if (!spend.ok) return;
    if (sovereignDied) { onSovereignDeath(); return; }
    doAutosave();
    playReactions([{ speakerId: "wei_sui", lines }, ...decreeBeats], spend.value.rolledOver);
  };

  const adoptHeir = (heirId: string, fatherId: string) => {
    const heir = store.getState().resources.bloodline.heirs.find((h) => h.id === heirId);
    if (!heir) return;
    const reactions = buildAdoptionReaction(db, store.getState(), heir, fatherId);
    // 行动先于时间：承养落库后再推进时间（跨月 tick 不会先杀死再承养）。
    const settled = store.resolveTimedAction(
      db,
      [{ type: "heir_adopt", heirId, fatherId }],
      { type: "SPEND_AP", amount: 1 },
    );
    if (!settled.ok) return;
    if (settled.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    doAutosave();
    if (settled.value.rolledOver) setReactionRollover(true);
    const [first, ...rest] = reactions;
    setReactionQueue(rest);
    if (first) setReaction(first);
  };

  // 寺庙·上香/求签（各耗 1 行动点）：确定性随机 effects + 旁白，复用 spendAp/playReactions。
  const templeAction = (kind: "incense" | "fortune") => {
    const before = store.getState();
    if (before.calendar.ap < 1) return;
    const cal = before.calendar;
    const key = `temple:${kind}:${before.rngSeed}:${cal.dayIndex}:${cal.ap}`;
    const plan = kind === "incense" ? buildIncense(db, before, key) : buildFortune(db, before, key);
    // 行动先于时间：上香/求签 effects 落在仍在世的皇帝身上，再推进时间。
    const settled = store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount: 1 });
    if (!settled.ok) return;
    if (settled.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    const decreeBeats = rollActionBeats(before.calendar, 1);
    doAutosave();
    playReactions([{ speakerId: "wei_sui", lines: plan.lines }, ...decreeBeats], settled.value.rolledOver);
  };

  // 进店（耗 1 行动点）：先切换到 shop 视图，再串播懿旨/乘风节拍（若有）。
  // 转旬 rollover 不触发 runCheckpoints，避免 checkpoint 视图抢占商铺界面。
  const enterShop = (id: "wanbaolou" | "zuixianlou") => {
    if (store.getState().calendar.ap < 1) return;
    const { spend, decreeBeats, sovereignDied } = spendAp(1);
    if (!spend.ok) return;
    if (sovereignDied) { onSovereignDeath(); return; }
    setShopId(id);
    setView("shop");
    doAutosave();
    shopRollover.current = spend.value.rolledOver;
    // 节拍串播以 rolledOver=false 调用，确保播完后不切走商铺视图。
    // 转旬 checkpoint 延迟到关店时执行（见 ShopScreen onClose）。
    playReactions(decreeBeats, false);
  };

  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const [morningAfterOpen, setMorningAfterOpen] = useState(false);

  const enterGreeting = () => {
    const { spend, decreeBeats, sovereignDied } = spendAp(1);
    if (!spend.ok) return;
    if (sovereignDied) { onSovereignDeath(); return; }
    doAutosave();
    setCeremonyOpen(true);
    // 懿旨等转旬反应入队，待 ceremony 关闭后随正常流程消化（此处仅记一旬动作）。
    if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
  };

  const exitGreeting = () => {
    goHome(); // 退出坤宁宫，回地图；不耗行动点
  };

  // 离开后宫居所：若是留宿宫且卯时，先弹二选一；否则正常回地图。
  const leavePalace = () => {
    if (morningAfterCharId) setMorningAfterOpen(true);
    else goHome();
  };

  const restExcuse = () => {
    if (morningAfterCharId) store.applyExcuseGreeting(db, morningAfterCharId);
    setMorningAfterOpen(false);
    goHome();
  };

  const silentLeave = () => {
    store.dismissOvernight();
    setMorningAfterOpen(false);
    goHome();
  };

  // 与在场侍君对话（耗 1 行动点）：脚本化反应台词；若 dialogueProvider 可用则走生成式路径。
  const converse = async (charId: string) => {
    const fallbackLines = buildConversation(db, store.getState(), charId);
    if (!fallbackLines) return;
    const { spend, decreeBeats, sovereignDied } = spendAp(1);
    if (!spend.ok) return;
    if (sovereignDied) { onSovereignDeath(); return; }
    store.recordOvernight(db, charId, spend.value.rolledOver);
    setSummonedConsortId(null);
    doAutosave();

    // Generative path: assemble request, snapshot expected state, produce turn, CAS
    if (dialogueProvider) {
      const expectedState = store.getState();
      const reqResult = assembleDialogueRequest(db, expectedState, charId, expectedState.playerLocation);
      if (reqResult.ok) {
        const turnResult = await produceDialogueTurn(db, dialogueProvider, reqResult.value, expectedState, logger);
        if (turnResult.ok) {
          const committed = store.commitDialogueState(expectedState, turnResult.value.nextState);
          if (committed) {
            doAutosave();
            const generatedLine = turnResult.value.line;
            playReactions([{ speakerId: charId, lines: [generatedLine.text] }, ...decreeBeats], spend.value.rolledOver);
            return;
          }
          // CAS failed: DIALOGUE_STATE_STALE — fall through to fallback
        }
        // produceDialogueTurn failed — fall through to fallback (AP already spent)
      }
    }

    // Fallback path: scripted lines
    playReactions([{ speakerId: charId, lines: fallbackLines }, ...decreeBeats], spend.value.rolledOver);
  };

  const transferTo = (carrierId: string) => {
    setSuccessorOpen(false);
    const r = store.applyEffects(db, planPregnancyTransfer(liveState, carrierId, gestMonth, { ...liveState.calendar }));
    if (r.ok) {
      doAutosave();
      setReaction({ speakerId: carrierId, lines: ["臣领旨。臣定以血躯护持皇嗣，不负圣恩。"] });
    }
  };

  /** 旅行结算（MapScreen.onTravelled 与院子 enterConsortQuarters 共用）。 */
  const onTravelledSettle = (rolledOver: boolean, spentAp: boolean, sovereignDied = false, stayOnMap = false) => {
    if (sovereignDied) { onSovereignDeath(); return; } // 跨月旅行皇帝崩逝：清场回 title。
    doAutosave();
    // 宫内免行动点移动：保存位置即可，不掷凤后懿旨/太后敲打、不跑转旬 checkpoint。
    if (!spentAp) return;
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
    if (beats.length) { setReactionStayOnMap(stayOnMap); playReactions(beats, rolledOver); }
    else runCheckpoints(rolledOver, stayOnMap);
  };

  const enterConsortQuarters = (palaceId: string, consortId: string) => {
    setFocusConsortId(consortId);
    setCourtyardLocId(null);
    const here = store.getState().playerLocation === palaceId;
    if (here) { enterCurrentLocation(); return; }
    const batch = buildTravelBatch(db, store.getState(), palaceId);
    if (!batch.ok) { setView("map"); return; }
    const moveCommands = batch.value.filter((c) => c.type !== "SPEND_AP");
    const spend = batch.value.find(
      (c): c is { type: "SPEND_AP"; amount: number } => c.type === "SPEND_AP",
    );
    if (spend) {
      // 出宫等耗行动点的移动：经统一时间入口（移动 + 扣点 + 跨月健康 tick + gameOver）。
      const result = store.travelAndAdvance(db, moveCommands, spend);
      if (!result.ok) { setView("map"); return; } // 兜底：勿滞留在已置空的院子视图（黑屏）
      if (result.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
      onTravelledSettle(result.value.rolledOver, true);
    } else {
      const result = store.dispatchBatch(moveCommands);
      if (!result.ok) { setView("map"); return; } // 兜底：勿滞留在已置空的院子视图（黑屏）
      // 宫内免行动点移动：onTravelledSettle 对 !spentAp 仅落盘即返回，不设视图，
      // 故此处显式进入该宫房间（否则 view 滞留 courtyard 而 courtyardLocId 已空 → 黑屏）。
      doAutosave();
      enterCurrentLocation();
    }
  };

  /** 大选·四月 prompt 选择：进殿选（扣 1AP）或委托太后皇后（不扣 AP）。 */
  const onDaxuanChoose = (action: PromptAction) => {
    setDaxuanPrompt(null);
    if (action.type === "daxuanEnter") {
      // 设决定 flag + 扣 1AP，打开殿选。
      store.setFlag(daxuanDianxuanFlagKey(action.year), true);
      const { spend, decreeBeats, sovereignDied } = spendAp(1);
      if (!spend.ok) return;
      if (sovereignDied) { onSovereignDeath(); return; }
      const cands = generateCandidates(db, store.getState(), action.year);
      setDianxuan({ candidates: cands, year: action.year });
      setView("dianxuan");
      // 殿选为原子流程：扣点产生的节拍此处先忽略串播。
      void decreeBeats;
    } else if (action.type === "daxuanDelegate") {
      store.setFlag(daxuanDianxuanFlagKey(action.year), true);
      const kept = npcKeepOnDelegate(db, store.getState(), action.year);
      if (kept.length > 0) store.commitDaxuanKept(db, kept);
      const beats: DecreeReaction[] = kept.length > 0
        ? kept.map((k) => ({
            speakerId: "cheng_feng",
            lines: [`陛下，太后与皇后做主，留了${k.candidate.content.profile.name}的牌子，封为${db.ranks[k.rank]?.name ?? ""}，已迁入储秀宫。`],
          }))
        : [{ speakerId: "cheng_feng", lines: ["陛下，此次大选，太后与皇后看过，未有特别中意的，便都撂了牌子。"] }];
      doAutosave();
      const [first, ...rest] = beats;
      if (first) { setReaction(first); setReactionQueue(rest); }
    }
  };

  /** 殿选结束：落库选中侍君；早退场则从未审阅池随机留 1 位 NPC（约 20%）。 */
  const onDianxuanDone = (
    kept: { candidate: Candidate; rank: string }[],
    leftEarly: boolean,
    reviewedCount: number,
  ) => {
    const year = dianxuan?.year ?? store.getState().calendar.year;
    for (const k of kept) store.commitDaxuanConsort(db, k.candidate, k.rank);
    const beats: DecreeReaction[] = [];
    if (leftEarly && dianxuan) {
      const reviewedIds = new Set(kept.map((k) => k.candidate.content.id));
      const remaining = dianxuan.candidates
        .slice(reviewedCount)
        .filter((c) => !reviewedIds.has(c.content.id));
      const npc = npcKeepOnLeave(remaining, store.getState(), year);
      if (npc) {
        store.commitDaxuanKept(db, [npc]);
        beats.push({
          speakerId: "cheng_feng",
          lines: [`陛下留步——有一位${npc.candidate.announce.replace(/，年.*$/, "")}颇得太后青眼，太后留了他的牌子，封为${db.ranks[npc.rank]?.name ?? ""}。`],
        });
      }
    }
    setDianxuan(null);
    doAutosave();
    goHome();
    if (beats.length > 0) { const [f, ...rest] = beats; setReaction(f!); setReactionQueue(rest); }
  };

  return (
    <>
      {notice && (
        <div
          role="status"
          onClick={() => setNotice(null)}
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            padding: "10px 20px",
            background: "rgba(20,16,12,0.92)",
            color: "#f4e8d0",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          {notice}
        </div>
      )}
      {view === "title" && (
        <TitleScreen
          registry={registry}
          onNewGame={newGame}
          onContinue={continueGame}
          canContinue={canContinue}
          continueError={continueError}
        />
      )}
      {view === "coronation" && (
        <CoronationScreen
          registry={registry}
          onConfirm={(era) => {
            store.setEraName(era);
            proceedAfterNewGame();
          }}
        />
      )}
      {view === "location" && (
        <LocationScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => {
            setSummonedConsortId(null);
            setFocusConsortId(null);
            setMapAtRoot(false); // open on the current board so 返回 climbs to 主图
            setView("map");
          }}
          onOpenSettings={() => {
            setSummonedConsortId(null);
            setSettingsOpen(true);
          }}
          onStartEvent={startEvent}
          onManage={(id) => setManageCharId(id)}
          onRelocate={(id) => setRelocateCharId(id)}
          onBedchamber={(id) => beginBedchamber(id)}
          onFlipTablet={() => {
            const g = canBedchamber(store.getState());
            if (!g.ok) { setReaction({ speakerId: "wei_sui", lines: [g.reason] }); return; }
            setFlipOpen(true);
          }}
          onSummonZongzheng={canSummonZongzheng ? () => setSuccessorOpen(true) : undefined}
          onSummonPhysician={() => setPhysicianOpen(true)}
          onOpenHeirs={() => setHeirListOpen(true)}
          onOpenConsorts={() => {
            setConsortListReturnId(null); // 新开列表：从列表根开始（非管理返回）
            setConsortListOpen(true);
          }}
          onReviewMemorials={reviewMemorials}
          onRestAlone={restAlone}
          onConverse={converse}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
          onViewProfile={(id) => setProfileCharId(id)}
          summonedConsortId={summonedConsortId}
          onDismissSummon={() => setSummonedConsortId(null)}
          focusConsortId={focusConsortId}
          greetingAttendeeCount={greetingAttendees(db, store.getState()).length}
          onEnterGreeting={enterGreeting}
          onExitGreeting={exitGreeting}
          onLeavePalace={leavePalace}
        />
      )}
      {view === "wenzhaodian" && (
        <ShangshufangScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => {
            setMapAtRoot(false); // open on the current board so 返回 climbs to 主图
            setView("map");
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onLesson={heirLesson}
          onTutorReport={tutorReport}
        />
      )}
      {view === "yuqing_gong" && (
        <YuqingGongScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => { setMapAtRoot(false); setView("map"); }}
          onOpenSettings={() => setSettingsOpen(true)}
          onSummon={summonHeir}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
        />
      )}
      {view === "fengxiandian" && (
        <FengxiandianScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => { setMapAtRoot(false); setView("map"); }}
          onOpenSettings={() => setSettingsOpen(true)}
          onAdopt={adoptHeir}
        />
      )}
      {view === "cining_gong" && (
        <CiningGongScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => { setMapAtRoot(false); setView("map"); }}
          onOpenSettings={() => setSettingsOpen(true)}
          // ev_taihou_converse 用 checkpoint:"game_start" 故永不自动触发，只由此按钮手动开启；勿改成 location_enter（会变强制弹出）。
          onConverse={() => startEvent("ev_taihou_converse")}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
        />
      )}
      {view === "map" && (
        <MapScreen
          db={db}
          store={store}
          registry={registry}
          atRoot={mapAtRoot}
          resumeBoardId={currentBoard}
          onTravelled={onTravelledSettle}
          onEnterCurrent={enterCurrentLocation}
          onOpenView={(locationId) => {
            setFreeViewId(locationId);
            setView("freeview");
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => { setFocusConsortId(null); setView("location"); }}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
          onOpenCourtyard={(loc) => { setCourtyardLocId(loc.id); setView("courtyard"); }}
          onEnterShop={enterShop}
          onBoardChange={(boardId) => {
            setCurrentBoard(boardId);
            if (boardId === "hougong" && lastBoardRef.current !== "hougong" && db.characters["cheng_feng"]) {
              setReaction(chengFengHaremGreeting());
            }
            lastBoardRef.current = boardId;
          }}
        />
      )}
      {view === "courtyard" && courtyardLocId && db.locations[courtyardLocId] && (
        <CourtyardScreen
          db={db}
          state={liveState}
          registry={registry}
          location={db.locations[courtyardLocId]!}
          onPickHall={(consortId) => enterConsortQuarters(courtyardLocId!, consortId)}
          onBack={() => { setCourtyardLocId(null); setMapAtRoot(false); setView("map"); }}
        />
      )}
      {view === "dianxuan" && dianxuan && (
        <DianxuanScreen
          registry={registry}
          db={db}
          store={store}
          candidates={dianxuan.candidates}
          year={dianxuan.year}
          onDone={onDianxuanDone}
        />
      )}
      {view === "shop" && shopId && (
        <ShopScreen db={db} store={store} registry={registry} shopId={shopId}
          onClose={() => {
            setShopId(null);
            // 店在京城（free-entry，playerLocation 未变）：转旬补跑亦须留在地图，
            // 否则会按 playerLocation 落回紫宸殿；无转旬则直接回京城板。
            if (shopRollover.current) { shopRollover.current = false; runCheckpoints(true, true); }
            else { setView("map"); }
          }} />
      )}
      {view === "freeview" && freeViewId && (
        <FreeViewScreen
          db={db}
          store={store}
          registry={registry}
          locationId={freeViewId}
          onStartEvent={startEvent}
          onClose={() => setView("map")}
          onOfferIncense={() => templeAction("incense")}
          onDrawFortune={() => templeAction("fortune")}
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
      {view === "court" && court && (
        <DialogueScreen
          key={`court:${court.index}`}
          db={db}
          store={store}
          registry={registry}
          eventId={court.queue[court.index]!}
          logger={logger}
          quitLabel="退朝"
          quitTitle="退朝即回紫禁城；已处置之事照准（本次上朝已耗 1 行动点，不再退还）"
          onDone={(committed) => {
            // committed=true：本件事务已处置（效果已通过 resolveEvent 入账）。
            // committed=false：玩家退朝——已处置之事保留，余下事务作罢。
            const nextIndex = court.index + 1;
            if (committed && nextIndex < court.queue.length) {
              doAutosave(); // 每件事务提交后落盘
              setCourt({ queue: court.queue, index: nextIndex });
              return;
            }
            if (committed) doAutosave();
            setCourt(null);
            goHome(); // 上朝结束 / 退朝 → 直接回到紫禁城主地图
          }}
        />
      )}
      {manageCharId && store.getState().standing[manageCharId] && (
        <RankAdminModal
          db={db}
          character={db.characters[manageCharId]!}
          standing={store.getState().standing[manageCharId]!}
          onApply={(req) => applyRankOp(manageCharId, req)}
          onClose={() => {
            setManageCharId(null);
            reopenConsortListIfReturning(); // 取消也回到列表
          }}
        />
      )}
      {relocateCharId && db.characters[relocateCharId] && store.getState().standing[relocateCharId] && (
        <RelocateModal
          db={db}
          state={liveState}
          character={db.characters[relocateCharId]!}
          onRelocate={(location, chamber) => applyRelocate(relocateCharId, location, chamber)}
          onClose={() => {
            setRelocateCharId(null);
            reopenConsortListIfReturning(); // 取消也回到列表
          }}
        />
      )}
      {reaction && (
        <ReactionScreen
          db={db}
          store={store}
          registry={registry}
          speakerId={reaction.speakerId}
          lines={reaction.lines}
          backgroundKey={reaction.backgroundKey}
          generatedLine={reaction.generatedLine}
          onChoice={undefined}
          onDone={() => {
            setReaction(null);
            if (reactionQueue.length > 0) {
              const [nextLine, ...rest] = reactionQueue;
              setReactionQueue(rest);
              setReaction(nextLine!);
              return;
            }
            // 封号管理（自列表进入）的反应播完 → 回到列表并定位回该侍君。
            // 仅列表入口会置 consortListReturnId，故不影响其它反应来源。
            reopenConsortListIfReturning();
            if (postBirthPromoteId) {
              const id = postBirthPromoteId;
              setPostBirthPromoteId(null);
              setManageCharId(id);
            } else if (reactionRollover) {
              setReactionRollover(false);
              setReactionStayOnMap(false);
              runCheckpoints(true, reactionStayOnMap); // 对话耗尽行动点导致换旬 → 补跑时间推进 checkpoint
            }
          }}
        />
      )}
      {prompt && !reaction && (
        <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={prompt} onChoose={resolvePromptAction} />
      )}
      {daxuanPrompt && !reaction && (
        <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={daxuanPrompt} onChoose={onDaxuanChoose} />
      )}
      {giftItemId && (
        <BestowModal db={db} store={store} itemId={giftItemId}
          onClose={() => setGiftItemId(null)} onConfirmed={() => setGiftItemId(null)} />
      )}
      {flipOpen && (
        <BedchamberPicker
          db={db}
          state={store.getState()}
          registry={registry}
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
          initialSelectedId={consortListReturnId}
          onManage={(id) => {
            setConsortListReturnId(id); // 操作后回到列表并定位回此侍君
            setConsortListOpen(false); // 先关列表，避免与封号管理弹窗叠层互相遮挡
            setManageCharId(id);
          }}
          onRelocate={(id) => {
            setConsortListReturnId(id);
            setConsortListOpen(false);
            setRelocateCharId(id);
          }}
          onSummon={(id) => {
            setConsortListReturnId(null);
            setConsortListOpen(false);
            setSummonedConsortId(id);
          }}
          onAddCandidate={addCandidate}
          onRemoveCandidate={removeCandidate}
          onClose={() => {
            setConsortListReturnId(null);
            setConsortListOpen(false);
          }}
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
          physicianName={courtPhysician(liveState.rngSeed).name}
          consults={buildConsultOptions(db, liveState)}
          onConsult={(k) => doConsult({ kind: k })}
          onPickConsort={() => { setPhysicianConsortPickerOpen(true); }}
          onPickHeir={() => { setPhysicianHeirPickerOpen(true); }}
          onAbort={abortPregnancy}
          onClose={() => { setPhysicianOpen(false); setPhysicianConsortPickerOpen(false); setPhysicianHeirPickerOpen(false); }}
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
              setReaction({ speakerId: "wei_sui", lines: [`司礼官高唱：皇嗣赐名「${name}」，宗祠登册，举宫同贺。`] });
            }
          }}
          onDismiss={() => setCentennialDismissedMonth(monthOrdinal(liveState.calendar))}
        />
      )}
      {childReaction && (
        <CharacterReactionScreen
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
      {physicianReaction && (
        <CharacterReactionScreen
          db={db}
          store={store}
          registry={registry}
          portraitSet={physicianReaction.portraitSet}
          speakerName={physicianReaction.speakerName}
          lines={physicianReaction.lines}
          onDone={() => {
            setPhysicianReaction(null);
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
      {physicianConsortPickerOpen && (
        <div className="modal-backdrop" onClick={() => setPhysicianConsortPickerOpen(false)}>
          <div className="heir-list" onClick={(e) => e.stopPropagation()}>
            <h2>为侍君请脉</h2>
            <ul className="consort-list">
              {livingConsortIds(db, liveState)
                .map((id) => db.characters[id] ?? liveState.generatedConsorts[id]!)
                .map((c) => {
                const visited = physicianVisitedThisMonth(liveState, { kind: "consort", id: c.id });
                const portrait = registry.portrait(c.portraitSet, "neutral");
                return (
                  <li key={c.id} className="consort-list__row">
                    <button
                      type="button"
                      className="consort-list__pick"
                      disabled={visited}
                      onClick={() => doConsult({ kind: "consort", id: c.id })}
                    >
                      <img
                        className="consort-detail__portrait"
                        src={portrait.url}
                        alt={c.profile.name}
                        data-fallback={portrait.isFallback || undefined}
                      />
                      <span className="consort-list__name">{c.profile.name}</span>
                      {visited && <span className="consort-list__rank">本月已请脉</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={() => setPhysicianConsortPickerOpen(false)}>取消</button>
          </div>
        </div>
      )}
      {physicianHeirPickerOpen && (
        <div className="modal-backdrop" onClick={() => setPhysicianHeirPickerOpen(false)}>
          <div className="heir-list" onClick={(e) => e.stopPropagation()}>
            <h2>为皇嗣请脉</h2>
            {(() => {
              const heirs = liveState.resources.bloodline.heirs.filter((h) => h.lifecycle === "alive");
              const named = [...listHeirsBySex(heirs, "daughter"), ...listHeirsBySex(heirs, "son")];
              return (
                <ul className="consort-list">
                  {named.map(({ heir, name }) => {
                    const visited = physicianVisitedThisMonth(liveState, { kind: "heir", id: heir.id });
                    const portrait = registry.portrait(heirPortraitSet(heir, liveState.calendar), "neutral");
                    return (
                      <li key={heir.id} className="consort-list__row">
                        <button
                          type="button"
                          className="consort-list__pick"
                          disabled={visited}
                          onClick={() => doConsult({ kind: "heir", id: heir.id })}
                        >
                          <img
                            className="consort-detail__portrait"
                            src={portrait.url}
                            alt={name}
                            data-fallback={portrait.isFallback || undefined}
                          />
                          <span className="consort-list__name">{name}　{heirAge(heir, liveState.calendar)}岁</span>
                          {visited && <span className="consort-list__rank">本月已请脉</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
            <button type="button" onClick={() => setPhysicianHeirPickerOpen(false)}>取消</button>
          </div>
        </div>
      )}
      {resourcePanelOpen && (
        <ResourcePanel state={liveState} onClose={() => setResourcePanelOpen(false)} />
      )}
      {storehouseOpen && (
        <StorehouseScreen db={db} store={store} onClose={() => setStorehouseOpen(false)} />
      )}
      {profileCharId && db.characters[profileCharId] && (
        <CharacterProfileDrawer
          db={db}
          state={liveState}
          character={db.characters[profileCharId]!}
          onClose={() => setProfileCharId(null)}
        />
      )}
      {settingsOpen && (
        <SettingsMenu
          db={db}
          store={store}
          storage={storage}
          logger={logger}
          registry={registry}
          onLoaded={() => { resetRollGuards(); setSettingsOpen(false); enterCurrentLocation(); }}
          onReturnTitle={() => { doAutosave(); setSettingsOpen(false); setView("title"); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {ceremonyOpen && (
        <GreetingCeremonyOverlay
          empressName={db.characters.shen_zhibai?.profile.name ?? "皇后"}
          onDone={() => {
            setCeremonyOpen(false);
            if (reactionQueue.length > 0) {
              const [first, ...rest] = reactionQueue;
              setReaction(first!);
              setReactionQueue(rest);
            }
          }}
        />
      )}
      {morningAfterOpen && morningAfterCharId && (
        <MorningAfterOverlay
          consortName={db.characters[morningAfterCharId]?.profile.name ?? "爱卿"}
          onRest={restExcuse}
          onSilent={silentLeave}
        />
      )}
      <DebugPanel store={store} db={db} logger={logger} onForceEvent={startEvent} />
    </>
  );
}
