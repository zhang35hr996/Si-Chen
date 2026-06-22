import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type EventReturnTarget,
  MAX_EVENT_CHAIN,
  type RankAdminSession,
  canChain,
  checkpointReturnTarget,
  initialNavState,
  navReducer,
  type AutoCheckpointRequest,
  autoCheckpointTriggers,
  pendingReactionReducer,
  rankAdminContinuation,
  resolveReturnNavigation,
} from "./eventReturn";
import {
  type GlobalInterruptKind,
  pickNextGlobalInterrupt,
  timeSettlementReducer,
} from "./settlement";
import rawManifest from "../../assets/manifest.json";
import { assetManifestSchema } from "../engine/assets/manifest";
import { AssetRegistry } from "../engine/assets/registry";
import { loadGameContent } from "../engine/content/viteSource";
import { pickAutoStartEvent } from "../engine/events/router";
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
  daxuanDianxuanPromptFor, generateCandidates,
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

type View = "title" | "coronation" | "location" | "map" | "freeview" | "event" | "court" | "wenzhaodian" | "yuqing_gong" | "fengxiandian" | "cining_gong" | "courtyard" | "shop" | "dianxuan";

/**
 * 可安全消费大选 prompt/报告的自由活动视图（地图 + 各宫房间）。pendingDaxuan 由引擎持久
 * 探测，永不丢失；故在非安全视图（事件/朝会/殿选/标题等阻断流程）按兵不动、待回到这些
 * 视图再补出是安全的，且避免覆盖在进行中的事件/朝会之上将其挤掉。
 */
const DAXUAN_SAFE_VIEWS: readonly View[] = [
  "location", "map", "wenzhaodian", "yuqing_gong", "fengxiandian", "cining_gong", "courtyard",
];

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
  // 位分管理原子会话（charId + origin）。origin 决定结束后是否补跑被初夜搁置的转旬 checkpoint。
  const [rankAdmin, setRankAdmin] = useState<RankAdminSession>(null);
  const [relocateCharId, setRelocateCharId] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{ speakerId: string; lines: string[]; backgroundKey?: string; generatedLine?: DialogueLine } | null>(null);
  const [postBirthPromoteId, setPostBirthPromoteId] = useState<string | null>(null);
  // 过场（对话/反应/初夜提示）若耗尽行动点导致换旬，待过场关闭后再补跑 time_advance checkpoint。
  // 原 reactionRollover + reactionStayOnBoardId 合并为单一原子待处理上下文：null=无；非空={boardId}
  // 决定补跑落点（出宫携带权威板 ID，普通行动为 undefined）。杜绝两状态错位串台（§ deferred-reaction）。
  const [pendingReactionCheckpoint, pendingReactionDispatch] = useReducer(pendingReactionReducer, null);
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
  const [dianxuan, setDianxuan] = useState<{ candidates: Candidate[]; year: number } | null>(null);
  const lastBoardRef = useRef<string>("palace");
  // 事件返回上下文 + 链预算（scene-ui-narrative-refactor §3.4）：玩家发起覆盖 target 并重置
  // chainDepth；自动续接继承 target、不重置；整链结束/弃场恢复一次并清空；新游戏/读档/驾崩清空。
  const [navState, navDispatch] = useReducer(navReducer, initialNavState);
  // 时间推进后的全局中断结算（§ post-time-advance settlement）：成功转旬登记一次（携带返回上下文），
  // 待场内过场与全局中断逐个消化完毕后，再跑 time_advance 事件并恢复。
  const [pendingTimeSettlement, timeSettlementDispatch] = useReducer(timeSettlementReducer, null);
  const rolledSlots = useRef<Set<string>>(new Set());
  const shopRollover = useRef(false);
  // Accumulated transcript across choice-driven turns within one converse() session.
  const converseTranscriptRef = useRef<{ speaker: string; text: string }[]>([]);
  // Single-flight guard for onConverseChoice — prevents concurrent choice requests.
  const choiceInFlightRef = useRef(false);
  const [choicePending, setChoicePending] = useState(false);
  const storage = useMemo(() => createLocalStorageAdapter(), []);

  // BGM effect: compute zone defensively (content may not be ok)
  const bgmZone = content.ok ? content.value.locations[store.getState().playerLocation]?.zone : undefined;
  useEffect(() => {
    audioController.play(trackFor({ view, board: currentBoard, zone: bgmZone }));
  }, [view, currentBoard, bgmZone]);

  const reactiveState = useGameState(store);

  // 死者视图清理：被召见的侍君若在跨月健康 tick 中身故，清除召见态（不在死者宫中停留）。
  useEffect(() => {
    if (!summonedConsortId) return;
    if (reactiveState.standing[summonedConsortId]?.lifecycle === "deceased") {
      setSummonedConsortId(null);
    }
  }, [reactiveState.standing, summonedConsortId]);

  // 大选日历事件消费（单点）：pendingDaxuan 由时间事务统一入口在任意推进路径置位，
  // 与房间视图、具体行动路径均解耦。当前有反应/任一 prompt 占场时按兵不动——pendingDaxuan
  // 持久，待清场后由本 effect 补出。announce 原子落 flag + 播报；dianxuan 弹选择 prompt
  // （flag 留待玩家选定时写，见 onDaxuanChoose）。
  useEffect(() => {
    if (!content.ok) return;
    const pd = reactiveState.pendingDaxuan;
    if (!pd) return;
    if (reaction || daxuanPrompt || dianxuan || prompt) return;
    if (!DAXUAN_SAFE_VIEWS.includes(view)) return; // 待回到自由活动视图再消费（事件不丢失）
    if (pd.kind === "announce") {
      const beats = store.consumeDaxuanAnnounce(content.value);
      doAutosave(); // 消费已改写状态（落 flag + 清/续 pending）→ 持久化，避免重载重播
      if (beats.length) { setReaction(beats[0]!); setReactionQueue(beats.slice(1)); }
    } else if (store.getState().flags[daxuanDianxuanFlagKey(pd.year)]) {
      store.clearPendingDaxuan(); // 陈旧：该年殿选已决 → 调和清除，避免 sticky 永久阻塞下一大选年
      doAutosave();
    } else {
      setDaxuanPrompt(daxuanDianxuanPromptFor(pd.year)); // 按 pending.year 构造（年份权威，不取当前日历年）
    }
  }, [reactiveState.pendingDaxuan, reaction, daxuanPrompt, dianxuan, prompt, view]);

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

  /** Player-initiated event start: overwrite the return target and reset the chain budget. */
  const startEvent = (eventId: string, returnTarget: EventReturnTarget) => {
    // 上朝是一场会话而非单个事件：进殿即扣 1 行动点，随机抽 2–3 件事务逐件处理。
    // 上朝自带 xuanzhengdian 返回上下文（beginCourt 内设），忽略此处传入的 target。
    if (eventId === "ev_chaohui") {
      beginCourt();
      return;
    }
    navDispatch({ type: "playerStart", target: returnTarget }); // 覆盖旧 target + 重置 chainDepth
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
    navDispatch({ type: "playerStart", target: { kind: "xuanzhengdian" } }); // 上朝返回 → 宣政殿（当前落主图，PR4 接专用屏）
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

  /** Set the room view for a given location id (no entry-time flavor rolls — used on event return). */
  const setLocationView = (locId: string) => {
    if (locId === "cining_gong") {
      if (store.getState().taihou.deceased) { setNotice("太后已驾鹤西去。"); goHome(); return; }
      setView("cining_gong"); return;
    }
    setView(locId === "wenzhaodian" ? "wenzhaodian" : locId === "yuqing_gong" ? "yuqing_gong" : locId === "fengxiandian" ? "fengxiandian" : "location");
  };

  /** 落到返回上下文对应的视图（原样消费完整语义目标；未建成的专用屏暂用最近现有视图，字段不丢）。 */
  const navigateToReturnTarget = (target: EventReturnTarget) => {
    const nav = resolveReturnNavigation(target);
    if (nav.view === "map") {
      // atRoot=true 保留既有 goHome 行为（含 maybeAutumnHunt）；atRoot=false 恢复被打断的嵌套板（不置根、不掷秋猎）。
      if (nav.atRoot) { goHome(); return; }
      setMapAtRoot(false);
      if (nav.boardId) setCurrentBoard(nav.boardId);
      setView("map");
      return;
    }
    if (nav.view === "xuanzhengdian") { goHome(); return; } // 宣政殿专用屏未建（PR4）→ 暂回主图
    setLocationView(nav.locationId!); // location / zichendian（PR2）/ garden（PR3）→ 暂用对应 location 场景
  };

  /**
   * Restore the view after an event chain ends (or a scene is abandoned). Snapshots the return
   * target, consumes it exactly once, then navigates via the exact semantic target.
   */
  const restoreReturn = () => {
    const target = navState.target;
    navDispatch({ type: "consume" }); // clear exactly once; a stale target cannot leak to the next event
    if (!target) { goHome(); return; }
    navigateToReturnTarget(target);
  };

  /** Autosave hooks: scene commit + travel only (plan §9), never mid-scene. */
  const doAutosave = () => {
    if (storage) autosave(storage, db, store.getState(), { logger });
  };

  /** 若管理/搬迁是从「查看侍君」列表进入的，操作结束后重开列表（定位到该侍君）。 */
  const reopenConsortListIfReturning = () => {
    if (consortListReturnId) setConsortListOpen(true);
  };

  const applyRankOp = (charId: string, req: RankOpRequest, origin: "normal" | "first_night") => {
    const op = buildRankOp(db, store.getState(), charId, req);
    setRankAdmin(null);
    let outcome: "no_op" | "failed" | "reaction_created";
    if (!op) {
      reopenConsortListIfReturning(); // 无变化：直接回到列表
      outcome = "no_op";
    } else {
      const result = store.applyEffects(db, op.effects);
      if (result.ok) {
        doAutosave();
        setReaction({ speakerId: charId, lines: op.lines }); // 列表在反应播完后（onDone）重开
        outcome = "reaction_created";
      } else {
        reopenConsortListIfReturning();
        outcome = "failed";
      }
    }
    // 初夜来源：无反应（无变化/失败）须立即补跑被搁置的转旬 checkpoint；生成反应则交其 onDone 补跑。
    if (rankAdminContinuation(origin, outcome) === "flush_pending") flushPendingReactionCheckpoint();
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
      navDispatch({ type: "clear" }); // 读档清空事件返回上下文（场景态从不入档）
      pendingReactionDispatch({ type: "clear" });
      setRankAdmin(null);
      timeSettlementDispatch({ type: "clear" });
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

  /** 终结一段过场时统一消费待补跑上下文：快照→consume→（若有）把该 request 转入全局结算。 */
  const flushPendingReactionCheckpoint = () => {
    const pending = pendingReactionCheckpoint;
    pendingReactionDispatch({ type: "consume" });
    // 把延后的反应转旬请求转入全局结算：先排空全局中断，再按 request 跑相应 checkpoint + 恢复。
    if (pending) beginSettlement(pending.request);
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
  /**
   * 行动结算后的随机节拍：凤后懿旨 + 太后敲打 + 进贡（命中则改走 prompt）/ 乘风汇报。
   * 注：大选二月报告 / 四月殿选不在此处——它们由时间事务统一入口探测 pendingDaxuan，
   * 任意推进路径（含休息 / 旅行 / 看诊 / 承养）都会置位，由 pendingDaxuan 消费 effect 统一处理。
   */
  const rollActionBeats = (
    before: { apMax: number; ap: number; dayIndex: number },
    amount: number,
  ): DecreeReaction[] => {
    let beats = rollDecree(before, amount);
    beats = [...beats, ...rollRebuke(before, amount)];
    const tributeShown = rollTribute(before, amount);
    if (!tributeShown) beats = [...beats, ...rollChengFeng(before, amount)];
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
    navDispatch({ type: "clear" }); // 驾崩清场：清空事件返回上下文
    pendingReactionDispatch({ type: "clear" });
    setRankAdmin(null);
    timeSettlementDispatch({ type: "clear" });
    doAutosave();
    setView("title");
  };

  /**
   * 串播一组反应节拍（行动自身台词 + 凤后懿旨）。`request` 非空=本段为转旬，反应结束后须按该请求结算；
   * null=非转旬（覆盖清空任何旧待处理上下文，杜绝串台）。空队列：转旬即时进结算。
   */
  const playReactions = (beats: DecreeReaction[], request: AutoCheckpointRequest | null) => {
    if (beats.length === 0) {
      pendingReactionDispatch({ type: "consume" }); // 无队列：不留待处理上下文
      if (request) beginSettlement(request);
      return;
    }
    pendingReactionDispatch({ type: "begin", request }); // 非空登记请求；null 覆盖清空
    setReaction(beats[0]!);
    setReactionQueue(beats.slice(1));
  };

  const proceedAfterNewGame = () => {
    const state = store.getState();
    const pick = pickAutoStartEvent(db, state, "game_start", db.locations[state.playerLocation]);
    if (pick) startEvent(pick.id, { kind: "map", atRoot: true });
    else goHome();
  };

  const newGame = () => {
    store.newGame(db);
    resetRollGuards();
    navDispatch({ type: "clear" }); // 新游戏清空事件返回上下文
    pendingReactionDispatch({ type: "clear" });
    setRankAdmin(null);
    timeSettlementDispatch({ type: "clear" });
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
      pendingReactionDispatch({ type: "begin", request: spend.value.rolledOver ? stationaryRequest() : null }); // 非转旬亦覆盖清空旧 pending（初夜提示关闭后据此补跑）
      // 初夜弹窗在上：懿旨入队，待晋升后续反应或「暂且不必」时排空。
      if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
    } else {
      // 非初夜：懿旨台词即时串播（playReactions 内含转旬补跑；无懿旨且转旬也会补跑）。
      playReactions(decreeBeats, spend.value.rolledOver ? stationaryRequest() : null);
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
    pendingReactionDispatch({ type: "begin", request: settled.value.rolledOver ? stationaryRequest() : null }); // 非转旬亦覆盖清空旧 pending
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
    playReactions([...own, ...decreeBeats], spend.value.rolledOver ? stationaryRequest() : null);
  };

  // 御书房·行动：独自休息（弃当旬剩余行动点，直接进入次旬早上）。
  const restAlone = () => {
    setSummonedConsortId(null);
    const spend = store.advanceTime(db, { type: "SKIP_REMAINDER" });
    if (!spend.ok) return;
    if (spend.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    doAutosave();
    beginSettlement(stationaryRequest());
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
    pendingReactionDispatch({ type: "begin", request: settled.value.rolledOver ? stationaryRequest() : null }); // 非转旬亦覆盖清空旧 pending
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
    pendingReactionDispatch({ type: "begin", request: settled.value.rolledOver ? stationaryRequest() : null }); // 非转旬亦覆盖清空旧 pending
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
    playReactions([{ speakerId: "wei_sui", lines }, ...decreeBeats], spend.value.rolledOver ? stationaryRequest() : null);
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
    pendingReactionDispatch({ type: "begin", request: settled.value.rolledOver ? stationaryRequest() : null }); // 非转旬亦覆盖清空旧 pending
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
    // 上香在慈恩寺(ciensi)；求签移步正觉殿(zhengjuedian)。先由住持当面禀报签辞/祝祷，
    // 再由乘风回禀俗世应验（流言四起 / 民心归附）。
    const sceneBg = kind === "incense" ? "bg.ciensi" : "bg.zhengjuedian";
    playReactions(
      [
        { speakerId: "zhuchi", lines: plan.zhuchiLines, backgroundKey: sceneBg },
        { speakerId: "cheng_feng", lines: plan.chengfengLines, backgroundKey: sceneBg },
        ...decreeBeats,
      ],
      settled.value.rolledOver ? stationaryRequest() : null,
    );
  };

  // 进店（耗 1 行动点）：先切换到 shop 视图，再串播懿旨/乘风节拍（若有）。
  // 转旬 rollover 不在此即时结算，避免 checkpoint 视图抢占商铺界面（关店时再走结算 seam）。
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
    playReactions(decreeBeats, null);
  };

  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const [morningAfterOpen, setMorningAfterOpen] = useState(false);

  // ── 时间推进后全局中断结算（§ post-time-advance settlement）────────────────
  // 大选提示不再依赖 view==="location"：作为结算选择器的输入随状态派生（修复 view-gated 发现缺陷）。
  const grandSelectionPrompt =
    dianxuan || view === "dianxuan" ? null : buildDaxuanDianxuanPrompt(db, liveState);
  // 场内原子过场（对话/反应/侍寝/初夜/封赏/场景/朝会/即时 prompt）须先结束，全局中断才呈现。
  const atomicFlowInProgress =
    reaction !== null || childReaction !== null || physicianReaction !== null ||
    firstNightPromptId !== null || namePetHeirId !== null ||
    bedchamberRun !== null || bedchamberPickId !== null || rankAdmin !== null ||
    prompt !== null || successorOpen || morningAfterOpen || ceremonyOpen ||
    view === "event" || view === "court" || view === "dianxuan" ||
    view === "title" || view === "coronation"; // 标题/登基（开局前）不呈现全局中断
  // 同一时刻只呈现一个全局中断（确定性优先级）；场内过场进行中时一律不呈现。
  const activeGlobalInterrupt: GlobalInterruptKind | null = atomicFlowInProgress
    ? null
    : pickNextGlobalInterrupt({
        birthDue: activeBirthPlan !== null,
        pregnancyDisclosureDue: jingshifangDue,
        successorDue: successorAutoDue && selfCarrying,
        centennialDue: centennialHeir !== null,
        grandSelectionDue: grandSelectionPrompt !== null,
      });

  /** 原地行动转旬请求：只跑 time_advance；返回上下文 = 当前地点（或显式 board）。 */
  const stationaryRequest = (boardId?: string): AutoCheckpointRequest => ({
    source: "stationary_rollover",
    returnTarget: checkpointReturnTarget(boardId, store.getState().playerLocation),
  });

  /** 成功转旬后登记一次结算（携带完整 AutoCheckpointRequest）；完成由下方结算 effect 驱动。 */
  const beginSettlement = (request: AutoCheckpointRequest) => {
    timeSettlementDispatch({ type: "begin", request });
  };

  /**
   * 完成自动 checkpoint：按来源决定跑哪些 checkpoint（stationary 只 time_advance；travel 先
   * time_advance 后 location_enter；arrival 只 location_enter）；命中事件用「原样的返回上下文」启动，
   * 否则按该上下文恢复。绝不从 playerLocation 重建目标。
   */
  const completeAutoCheckpoint = (request: AutoCheckpointRequest) => {
    const state = store.getState();
    const location = db.locations[state.playerLocation];
    const t = autoCheckpointTriggers(request.source);
    const timeEvent = t.timeAdvance ? pickAutoStartEvent(db, state, "time_advance", location) : null;
    const locationEvent = !timeEvent && t.locationEnter ? pickAutoStartEvent(db, state, "location_enter", location) : null;
    const event = timeEvent ?? locationEvent;
    if (event) { startEvent(event.id, request.returnTarget); return; }
    // 无事件：按完整返回上下文恢复，并保留落点处的氛围掷骰（上书房秋猎 / 慈宁宫侍疾）。
    navigateToReturnTarget(request.returnTarget);
    const nav = resolveReturnNavigation(request.returnTarget);
    if (nav.view === "location") {
      const loc2 = store.getState().playerLocation;
      if (loc2 === "wenzhaodian") maybeAutumnHunt();
      else if (loc2 === "cining_gong" && !store.getState().taihou.deceased) maybeShizhi();
    }
  };

  // 结算完成：无场内过场、无待处理全局中断时，消费结算 → 按 request 跑相应 checkpoint → 恢复一次。
  // 不在此 effect 内开浮层（浮层由渲染体按 activeGlobalInterrupt 声明式呈现）；此处只做「排空后完成」。
  useEffect(() => {
    if (!pendingTimeSettlement) return;
    if (atomicFlowInProgress || activeGlobalInterrupt) return;
    const request = pendingTimeSettlement.request;
    timeSettlementDispatch({ type: "consume" });
    completeAutoCheckpoint(request);
  }, [pendingTimeSettlement, atomicFlowInProgress, activeGlobalInterrupt]);

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
            converseTranscriptRef.current = []; // reset transcript for new conversation
            const generativeBeat = { speakerId: charId, lines: [generatedLine.text], generatedLine };
            playReactions([generativeBeat, ...decreeBeats], spend.value.rolledOver ? stationaryRequest() : null);
            return;
          }
          // CAS failed: DIALOGUE_STATE_STALE — fall through to fallback
        }
        // produceDialogueTurn failed — fall through to fallback (AP already spent)
      }
    }

    // Fallback path: scripted lines
    playReactions([{ speakerId: charId, lines: fallbackLines }, ...decreeBeats], spend.value.rolledOver ? stationaryRequest() : null);
  };

  // Handles a player choice click during a generative conversation turn.
  // No extra AP is spent here — AP was already spent in converse().
  const onConverseChoice = useCallback(async (choice: { id: string; text: string; tone?: string }) => {
    if (!dialogueProvider || !reaction?.generatedLine) return;
    // Single-flight guard: prevent concurrent choice requests (double-tap, etc.)
    if (choiceInFlightRef.current) return;
    choiceInFlightRef.current = true;
    setChoicePending(true);

    const currentLine = reaction.generatedLine;
    const speakerId = reaction.speakerId;

    try {
      // Append speaker's last line + player's chosen response
      const transcript = [
        ...converseTranscriptRef.current,
        { speaker: speakerId, text: currentLine.text },
        { speaker: "player", text: choice.text },
      ];
      converseTranscriptRef.current = transcript;

      // Re-snapshot state AFTER previous CAS was committed
      const expectedState = store.getState();
      const reqResult = assembleDialogueRequest(db, expectedState, speakerId, expectedState.playerLocation, { transcript });
      if (!reqResult.ok) {
        // Assembly failed — strip generatedLine so normal onDone drains the queue/rollover
        setReaction({ speakerId, lines: ["（对话暂时中断）"] });
        return;
      }

      const turnResult = await produceDialogueTurn(db, dialogueProvider, reqResult.value, expectedState, logger);
      if (!turnResult.ok) {
        // Turn failed — same graceful path
        setReaction({ speakerId, lines: ["（对话暂时中断）"] });
        return;
      }

      const committed = store.commitDialogueState(expectedState, turnResult.value.nextState);
      if (!committed) {
        // CAS failed (stale state) — same graceful path
        setReaction({ speakerId, lines: ["（对话暂时中断）"] });
        return;
      }

      doAutosave();
      const nextLine = turnResult.value.line;
      // Update reaction state with the new generated line; carry decree beats from the queue
      setReaction({ speakerId, lines: [nextLine.text], generatedLine: nextLine });
    } finally {
      choiceInFlightRef.current = false;
      setChoicePending(false);
    }
  }, [dialogueProvider, reaction, store, db, logger]);

  const transferTo = (carrierId: string) => {
    setSuccessorOpen(false);
    const r = store.applyEffects(db, planPregnancyTransfer(liveState, carrierId, gestMonth, { ...liveState.calendar }));
    if (r.ok) {
      doAutosave();
      setReaction({ speakerId: carrierId, lines: ["臣领旨。臣定以血躯护持皇嗣，不负圣恩。"] });
    }
  };

  /** 旅行结算（MapScreen.onTravelled 与院子 enterConsortQuarters 共用）。 */
  const onTravelledSettle = (rolledOver: boolean, spentAp: boolean, sovereignDied = false, stayOnMapBoardId?: string) => {
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
    // 移动结算：转旬=travel_rollover（time_advance 优先，无则 location_enter）；非转旬=arrival（仅 location_enter）。
    const travelTarget = checkpointReturnTarget(stayOnMapBoardId, store.getState().playerLocation);
    const travelReq: AutoCheckpointRequest = { source: "travel_rollover", returnTarget: travelTarget };
    if (beats.length) playReactions(beats, rolledOver ? travelReq : null);
    else if (rolledOver) beginSettlement(travelReq);
    else completeAutoCheckpoint({ source: "arrival", returnTarget: travelTarget });
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
    if (action.type === "daxuanEnter") {
      // store 校验完整性不变量后再扣 1AP（殿选原子流程，advanceTime 不掷随机节拍）。
      const enter = store.enterDaxuan(db, action.year);
      if (!enter.ok) {
        // 行动点不足：保留 prompt + pending、不写 flag，提示原因（可改委托或养足精神再去）。
        if (enter.error.some((e) => e.code === "AP_INSUFFICIENT")) {
          setNotice("行动点不足，无法移驾体元殿。可改由太后皇后决定，或养足精神再去。");
          return;
        }
        setDaxuanPrompt(null); // 无匹配 pending（陈旧/重复点击等）：静默收起，不重复执行
        return;
      }
      setDaxuanPrompt(null); // 扣点成功后才关 prompt；flag + pending 已由 enterDaxuan 原子落定
      if (enter.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
      const cands = generateCandidates(db, store.getState(), action.year);
      setDianxuan({ candidates: cands, year: action.year });
      setView("dianxuan");
      doAutosave(); // 殿选已决落盘（避免重载重弹 prompt）
    } else if (action.type === "daxuanDelegate") {
      // 仅当真正消费了「该年未决」pending 才执行委托业务，杜绝陈旧/重复点击二次留牌/重播。
      const resolved = store.resolveDaxuanDianxuan(action.year);
      setDaxuanPrompt(null);
      if (!resolved) return;
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
          onStartEvent={(id) => startEvent(id, { kind: "location", locationId: store.getState().playerLocation })}
          onManage={(id) => setRankAdmin({ charId: id, origin: "normal" })}
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
          onConverse={() => startEvent("ev_taihou_converse", { kind: "location", locationId: "cining_gong" })}
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
          onOpenCourtyard={(loc) => {
            // 长门宫（冷宫）是 free-view 居所：以冷宫场景直接呈现住客，不走院子→travel
            // （changmengong 非 travel 节点，进院子点殿会落空回主图）。
            if (loc.id === "changmengong") { setFreeViewId(loc.id); setView("freeview"); return; }
            setCourtyardLocId(loc.id);
            setView("courtyard");
          }}
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
            // 店在京城（free-entry，playerLocation 未变）：转旬补跑亦须留在地图。currentBoard 此刻已稳定
            // （进店前 onBoardChange 早已生效，无卸载时序问题），作为显式权威板传入；无转旬则直接回该板。
            if (shopRollover.current) { shopRollover.current = false; beginSettlement(stationaryRequest(currentBoard)); }
            else { setView("map"); }
          }} />
      )}
      {view === "freeview" && freeViewId && (
        <FreeViewScreen
          db={db}
          store={store}
          registry={registry}
          locationId={freeViewId}
          onStartEvent={(id) => startEvent(id, { kind: "map", atRoot: true })}
          onClose={() => setView("map")}
          onOfferIncense={() => templeAction("incense")}
          onDrawFortune={() => templeAction("fortune")}
          onViewProfile={(id) => setProfileCharId(id)}
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
              const sceneEndState = store.getState();
              const pick = pickAutoStartEvent(db, sceneEndState, "scene_end", db.locations[sceneEndState.playerLocation]);
              if (pick) {
                if (canChain(navState)) {
                  navDispatch({ type: "chainAdvance" }); // 链事件继承 target、不重置、不消费
                  setActiveEventId(pick.id);
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
                const taState = store.getState();
                const t = pickAutoStartEvent(db, taState, "time_advance", db.locations[taState.playerLocation]);
                if (t && canChain(navState)) {
                  navDispatch({ type: "chainAdvance" });
                  setActiveEventId(t.id);
                  return;
                }
              }
              restoreReturn(); // 整链结束 → 按返回上下文恢复（消费一次）
              return;
            }
            // Abandoned mid-scene (零代价离开): restore via the same return target (consumes it).
            restoreReturn();
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
            restoreReturn(); // 上朝结束 / 退朝 → 按返回上下文（xuanzhengdian，当前落主图）恢复
          }}
        />
      )}
      {rankAdmin && store.getState().standing[rankAdmin.charId] && (
        <RankAdminModal
          db={db}
          character={db.characters[rankAdmin.charId]!}
          standing={store.getState().standing[rankAdmin.charId]!}
          onApply={(req) => applyRankOp(rankAdmin.charId, req, rankAdmin.origin)}
          onClose={() => {
            const origin = rankAdmin.origin;
            setRankAdmin(null);
            // 初夜来源关闭（未应用）：补跑被搁置的转旬 checkpoint，杜绝丢失；普通来源不因关闭补跑。
            if (rankAdminContinuation(origin, "close") === "flush_pending") flushPendingReactionCheckpoint();
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
          onChoice={reaction?.generatedLine && dialogueProvider ? onConverseChoice : undefined}
          choicePending={choicePending}
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
              setRankAdmin({ charId: id, origin: "normal" }); // 产后晋升：普通来源，不因关闭补跑转旬
            } else {
              flushPendingReactionCheckpoint(); // 对话耗尽行动点导致换旬 → 统一补跑（无 pending 则空操作）
            }
          }}
        />
      )}
      {prompt && !reaction && (
        <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={prompt} onChoose={resolvePromptAction} />
      )}
      {activeGlobalInterrupt === "grand_selection" && grandSelectionPrompt && (
        <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={grandSelectionPrompt} onChoose={onDaxuanChoose} />
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
            setRankAdmin({ charId: id, origin: "normal" });
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
                setRankAdmin({ charId: id, origin: "first_night" }); // 初夜晋升：来源 first_night，须接管搁置的转旬补跑
              }}
            >
              晋升
            </button>
            <button
              type="button"
              onClick={() => {
                setFirstNightPromptId(null);
                if (reactionQueue.length > 0) {
                  // 先串播待播的凤后懿旨；其 onDone 会接手转旬补跑（pending 上下文保留）。
                  const [next, ...rest] = reactionQueue;
                  setReactionQueue(rest);
                  setReaction(next!);
                } else {
                  flushPendingReactionCheckpoint(); // 初夜「暂且不必」且无队列 → 统一补跑（无 pending 则空操作）
                }
              }}
            >
              暂且不必
            </button>
          </div>
        </div>
      )}
      {activeGlobalInterrupt === "birth" && activeBirthPlan && (
        <BirthScreen
          db={db}
          store={store}
          registry={registry}
          speakerId={birthSpeaker}
          lines={activeBirthPlan.lines}
          onDone={commitBirth}
        />
      )}
      {activeGlobalInterrupt === "pregnancy_disclosure" && (
        <JingshifangModal
          db={db}
          state={liveState}
          fatherCandidates={fatherCandidates}
          onSelfPregnancy={carrySelfPregnancy}
          onDesignate={designateCandidates}
        />
      )}
      {((activeGlobalInterrupt === "successor") || successorOpen) && selfCarrying && (
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
      {activeGlobalInterrupt === "centennial_heir" && centennialHeir && (
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
            flushPendingReactionCheckpoint();
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
            flushPendingReactionCheckpoint();
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
          onLoaded={() => { resetRollGuards(); navDispatch({ type: "clear" }); pendingReactionDispatch({ type: "clear" }); setRankAdmin(null); timeSettlementDispatch({ type: "clear" }); setSettingsOpen(false); enterCurrentLocation(); }}
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
      <DebugPanel store={store} db={db} logger={logger} onForceEvent={(id) => startEvent(id, { kind: "map", atRoot: true })} />
    </>
  );
}
