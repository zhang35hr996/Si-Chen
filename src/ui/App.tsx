import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type EventReturnTarget,
  MAX_EVENT_CHAIN,
  type RankAdminSession,
  type RankAdminOrigin,
  type RankAdminOutcome,
  canChain,
  checkpointReturnTarget,
  firstNightRankDrainAction,
  initialNavState,
  navReducer,
  type AutoCheckpointRequest,
  autoCheckpointTriggers,
  deferredAutoCheckpointMode,
  eventSceneCompletionPlan,
  pendingReactionReducer,
  resolveReturnNavigation,
} from "./eventReturn";
import {
  type DialogueOpState,
  finishDialogueOp,
  initialDialogueOpState,
  invalidateDialogueOps,
  isCurrentDialogueOp,
  startDialogueOp,
} from "./dialogueOp";
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

import { autosave, listSaves, loadWithRecovery } from "../engine/save/saveSystem";
import { createLocalStorageAdapter } from "../engine/save/storage";
import { greetingAttendees } from "../engine/characters/greeting";
import { getGreetingHostView } from "../engine/characters/haremAdministration";
import type { GameStore } from "../store/gameStore";
import { buildRankOp, type RankOpRequest } from "../store/rankOps";

import type { HaremAdministrationTarget } from "../store/haremAdminTransfer";
import { monthOrdinal, isGreetingSlot, timeOfDay } from "../engine/calendar/time";
import { getCharacterLocation } from "../engine/characters/presence";
import {
  audienceCount,
  audienceReconciliationEffects,
  clearAudience,
  defer,
  deferredAudienceCount,
  getAudienceQueue,
  getDeferredAudienceQueue,
} from "../engine/events/audience";
import { GameShell } from "./components/GameShell";
import { breadcrumbFor } from "./components/breadcrumb";
import { sovereignGestationDisplay } from "./format/gestationDisplay";
import { ZichendianScreen } from "./screens/ZichendianScreen";
import {
  audienceItemToPendingView,
  audienceItemToView,
  selectActiveAudience,
  shouldClearAudienceOnCommit,
  summonedConsortToView,
  zichendianExternalBusy,
} from "./zichendianView";
import { buildBedchamber, passionAllowed, type BedchamberPlan } from "../store/bedchamber";
import { buildConversation } from "../store/conversation";
import { assembleDialogueRequest, produceDialogueTurn } from "../engine/dialogue/orchestrator";
import { toDialogueTurnOptions, type DialogueRuntimeDeps } from "../engine/dialogue/runtimeDeps";
import { deriveConverseSceneContext, type ConverseSceneContext } from "./converseScene";
import type { DialogueLine } from "../engine/dialogue/types";
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
import { planHeirCustodyTransfer } from "../store/heirCustody";
import { CharacterReactionScreen } from "./screens/CharacterReactionScreen";
import { buildBirth, collectNewbornIds, dueGestation } from "../store/gestation";
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
// HaremAdminRankModal removed — harem admin decisions are NPC-autonomous (PR #73A)
import { PunishmentModal } from "./components/PunishmentModal";
import { ColdPalaceRestoreModal } from "./components/ColdPalaceModal";
import type { ColdPalaceLiftReason } from "./components/ColdPalaceModal";
import { ColdPalaceIncidentModal } from "./components/ColdPalaceIncidentModal";
import { ColdPalaceCriticalIncidentModal } from "./components/ColdPalaceCriticalIncidentModal";
import { ColdPalaceInterventionModal } from "./components/ColdPalaceInterventionModal";
import { ColdPalaceMadnessModal } from "./components/ColdPalaceMadnessModal";
import { oldestPresentableIncident } from "../engine/characters/coldPalaceIncidents";
import type { ColdPalaceInterventionKind } from "../engine/state/types";
import type { ImperialCommand } from "../store/imperialCommands";
import { RelocateModal } from "./components/RelocateModal";
import { GreetingCeremonyOverlay } from "./components/GreetingCeremonyOverlay";
import { MorningAfterOverlay } from "./components/MorningAfterOverlay";
import { buildRelocate } from "../store/relocate";
import { planPregnancyTransfer } from "../store/pregnancyCost";
import { canHoldCourt, canBedchamber } from "../store/gating";
import { CharacterProfileDrawer } from "./components/CharacterProfileDrawer";
import { DebugPanel, type DialogueKnowledgeDiagnostic } from "./debug/DebugPanel";
import { ResourcePanel } from "./components/ResourcePanel";
import { BootErrorScreen } from "./screens/BootErrorScreen";
import { pickCourtAffairs } from "../engine/court/affairs";
import { DialogueScreen } from "./screens/DialogueScreen";
import { FreeViewScreen } from "./screens/FreeViewScreen";
import { LocationScreen } from "./screens/LocationScreen";
import { GardenOverviewScreen, type GardenSubAreaView } from "./screens/GardenOverviewScreen";
import { XuanzhengdianScreen } from "./screens/XuanzhengdianScreen";
import { OfficialsScreen } from "./officials/OfficialsScreen";
import { ExaminationScreen } from "./officials/ExaminationScreen";
import { PersonnelDecisionsScreen } from "./officials/PersonnelDecisionsScreen";
import { getPendingPersonnelDecisions } from "../engine/officials/personnelDecisions";
import { MemorialsScreen } from "./court/MemorialsScreen";
import { getPendingMemorials } from "../engine/court/memorials";
import { getHighVacancyPosts } from "../engine/officials/selectors";
import { getUnacknowledgedExaminationResults } from "../engine/officials/examination";
import { pickSubLocationEvent, subLocationEventAffordable } from "../engine/map/subLocations";
import { presentBarItems, focusedCharacterView, reconcileSelection } from "./sceneView";
import { courtAgendaPreview, snapshotCourtMetrics, diffCourtMetrics, type CourtMetrics, type CourtMetricsDiff } from "../engine/court/agenda";
import { buildCourtSummary, courtHoldGate } from "./xuanzhengView";
import { MapScreen } from "./screens/MapScreen";
import { ReactionScreen } from "./screens/ReactionScreen";
import { SettingsMenu } from "./components/SettingsMenu";
import { TitleScreen } from "./screens/TitleScreen";
import { CoronationScreen } from "./screens/CoronationScreen";
import { StorehouseScreen } from "./screens/StorehouseScreen";
import { ShopScreen } from "./screens/ShopScreen";

type View = "title" | "coronation" | "location" | "map" | "freeview" | "event" | "court" | "wenzhaodian" | "yuqing_gong" | "fengxiandian" | "cining_gong" | "courtyard" | "shop" | "dianxuan" | "zichendian" | "garden" | "xuanzhengdian" | "officials" | "examination" | "personnelDecisions" | "courtMemorials";

/** 上朝会话：进殿即扣 1 行动点，随机抽取的 2–3 件事务逐件处理；可随时退朝。 */
interface CourtSession {
  queue: string[];
  index: number;
}

export function App({ store, dialogueRuntime }: { store: GameStore; dialogueRuntime?: DialogueRuntimeDeps }) {
  const logger = dialogueRuntime?.logger;
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
  // 宣政殿朝议结果（真实快照 diff）；非空 = 结果态。朝议前快照存 ref（不入存档）。
  const [courtResult, setCourtResult] = useState<CourtMetricsDiff | null>(null);
  const courtSnapshotRef = useRef<CourtMetrics | null>(null);
  const [freeViewId, setFreeViewId] = useState<string | null>(null);
  // 御花园：当前进入的子地点（null = 总览）+ 园中在场人物选中态。
  const [gardenSubLocationId, setGardenSubLocationId] = useState<string | null>(null);
  const [gardenSelectedId, setGardenSelectedId] = useState<string | null>(null);
  // 位分管理原子会话（charId + origin）。origin 决定结束后是否补跑被初夜搁置的转旬 checkpoint。
  const [rankAdmin, setRankAdmin] = useState<RankAdminSession>(null);
  const [punishCharId, setPunishCharId] = useState<string | null>(null);
  // 六宫行政位分管理：actorId = 协理侍君 charId。
  // haremAdminActorId removed — harem admin rank changes are now NPC-autonomous
  // 禁足令在侍君宫殿内发布后需回主图：confinement 成功 + 人在该宫→ 反应播完后 goHome。
  const [punishGoHome, setPunishGoHome] = useState(false);
  const [relocateCharId, setRelocateCharId] = useState<string | null>(null);
  const [restoreCharId, setRestoreCharId] = useState<string | null>(null);
  const [coldPalaceInterventionTarget, setColdPalaceInterventionTarget] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{ speakerId: string; lines: string[]; backgroundKey?: string; generatedLine?: DialogueLine } | null>(null);
  const [postBirthPromoteId, setPostBirthPromoteId] = useState<string | null>(null);
  // 过场（对话/反应/初夜提示）若耗尽行动点导致换旬，待过场关闭后再补跑 time_advance checkpoint。
  // 原 reactionRollover + reactionStayOnBoardId 合并为单一原子待处理上下文：null=无；非空={boardId}
  // 决定补跑落点（出宫携带权威板 ID，普通行动为 undefined）。杜绝两状态错位串台（§ deferred-reaction）。
  const [pendingReactionCheckpoint, pendingReactionDispatch] = useReducer(pendingReactionReducer, null);
  // 侍寝流程：选人 → 选模式 → 播放体验 → 提交（→ 初夜晋升）
  const [flipOpen, setFlipOpen] = useState(false);
  // 选人盘呈现语义：bedchamber=翻牌子（侍寝，默认，含 canBedchamber 背书）；summon=召见侍君（叙话/临场，无侍寝门槛）。
  const [flipMode, setFlipMode] = useState<"bedchamber" | "summon">("bedchamber");
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
  // 传乘风「交付六宫主理权」：true 时 ConsortListModal 显示「委以六宫」选项。
  const [haremTransferPending, setHaremTransferPending] = useState(false);
  // Non-persistent debug-only snapshot of the most recent dialogue knowledge retrieval.
  // Never saved to GameState or localStorage.
  const [recentKnowledge, setRecentKnowledge] = useState<DialogueKnowledgeDiagnostic | undefined>(undefined);
  const [summonedConsortId, setSummonedConsortId] = useState<string | null>(null);
  const [physicianReaction, setPhysicianReaction] = useState<{ portraitSet: string; speakerName: string; lines: string[] } | null>(null);
  const [physicianConsortPickerOpen, setPhysicianConsortPickerOpen] = useState(false);
  const [physicianHeirPickerOpen, setPhysicianHeirPickerOpen] = useState(false);
  const [childReaction, setChildReaction] = useState<HeirInteractionPlan | null>(null);
  const [namePetHeirIds, setNamePetHeirIds] = useState<string[]>([]);
  const namePetHeirId = namePetHeirIds[0] ?? null;
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
  // 殿选（四月）选择 prompt。pendingDaxuan（持久）经结算系统选中 grand_selection 时由消费 effect 置位；
  // 既是当前 atomicFlow（防其它全局中断抢占），又驱动 ChengFengPromptScreen 渲染。
  const [daxuanPrompt, setDaxuanPrompt] = useState<ChengFengPrompt | null>(null);
  const lastBoardRef = useRef<string>("palace");
  // 事件返回上下文 + 链预算（scene-ui-narrative-refactor §3.4）：玩家发起覆盖 target 并重置
  // chainDepth；自动续接继承 target、不重置；整链结束/弃场恢复一次并清空；新游戏/读档/驾崩清空。
  const [navState, navDispatch] = useReducer(navReducer, initialNavState);
  // 时间推进后的全局中断结算（§ post-time-advance settlement）：成功转旬登记一次（携带返回上下文），
  // 待场内过场与全局中断逐个消化完毕后，再跑 time_advance 事件并恢复。
  const [pendingTimeSettlement, timeSettlementDispatch] = useReducer(timeSettlementReducer, null);
  // 生成式对话在 await provider 期间的 in-flight 标记（计入 atomicFlowInProgress，避免孕/产提示插队）。
  const [dialogueInFlight, setDialogueInFlight] = useState(false);
  // 对话操作所有权状态机（唯一 token + 单活动操作）：拒绝并发、防 stale async 串播、旧操作不清新操作忙碌位。
  const dialogueOpRef = useRef<DialogueOpState>(initialDialogueOpState);
  const rolledSlots = useRef<Set<string>>(new Set());
  const shopRollover = useRef(false);
  // Accumulated transcript across choice-driven turns within one converse() session.
  const converseTranscriptRef = useRef<{ speaker: string; text: string }[]>([]);
  // Presence/privacy scene context derived once per converse() session, reused by
  // the opening turn and every choice-driven continuation.
  const converseSceneCtxRef = useRef<ConverseSceneContext | null>(null);
  // 续接（onConverseChoice）的 UI pending 也归 token 所有：choiceOpTokenRef=当前续接 op 的 token（同步 owner 判定），
  // choicePendingToken!==null 驱动 ReactionScreen 禁用选项。并发门只由 startDialogueOp（activeOp!=null 即拒）把守，
  // 不再用独立布尔。生命周期失效（invalidateDialogue）立即清两者；旧续接的 finally 仅在仍持有同一 token 时清。
  const choiceOpTokenRef = useRef<number | null>(null);
  const [choicePendingToken, setChoicePendingToken] = useState<number | null>(null);
  const storage = useMemo(() => createLocalStorageAdapter(), []);

  // BGM effect: compute zone defensively (content may not be ok)
  const bgmZone = content.ok ? content.value.locations[store.getState().playerLocation]?.zone : undefined;
  useEffect(() => {
    audioController.play(trackFor({ view, board: currentBoard, zone: bgmZone }));
  }, [view, currentBoard, bgmZone]);

  const reactiveState = useGameState(store);

  // 御花园选中态调和写回：园中在场人物变化后，把陈旧 charId 真正从 state 清掉（取下一个在场者或清空），
  // 不只是渲染期派生——杜绝她离场后旧 ID 残留、再次出现自动抢回焦点。
  useEffect(() => {
    if (view !== "garden") return;
    const ids = presentBarItems(db, reactiveState, "yuhuayuan").map((i) => i.id);
    setGardenSelectedId((prev) => (prev == null ? null : reconcileSelection(ids, prev)));
  }, [view, reactiveState]);

  // 死者视图清理：被召见的侍君若在跨月健康 tick 中身故，清除召见态（不在死者宫中停留）。
  useEffect(() => {
    if (!summonedConsortId) return;
    if (reactiveState.standing[summonedConsortId]?.lifecycle === "deceased") {
      setSummonedConsortId(null);
    }
  }, [reactiveState.standing, summonedConsortId]);

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
      // 无可议事务（理论上 升朝 已被议程空状态禁用）：回宣政殿议程屏，不留空 court 会话。
      setCourtResult(null);
      enterXuanzhengdianView();
      return;
    }
    // 朝议前抓一次权威指标快照，结束后 diff 真实差值作结果摘要。
    courtSnapshotRef.current = snapshotCourtMetrics(store.getState());
    navDispatch({ type: "playerStart", target: { kind: "xuanzhengdian" } }); // 上朝返回 → 宣政殿专用屏（结果态）
    setCourt({ queue, index: 0 });
    setView("court");
  };

  /** Return to the 皇城主地图 (home). Used by 新游戏 and after an event ends. */
  const goHome = () => {
    setMapAtRoot(true);
    setView("map");
    maybeAutumnHunt();
  };

  /**
   * 进紫宸殿：先在「进入时」对账（清掉属本殿但已不合法的 pending），再进专用屏。
   * 仅本 host 对账（audienceReconciliationEffects 内部跳过他 host）；不在渲染期、不在每次状态更新的宽 effect 里跑。
   * 普通进入与事件语义返回都经此（reconcile-on-entry）。
   */
  const enterZichendianView = () => {
    setSummonedConsortId(null);
    const effects = audienceReconciliationEffects(db, store.getState(), "zichendian");
    if (effects.length > 0) {
      const applied = store.applyEffects(db, effects);
      if (applied.ok) doAutosave();
    }
    setView("zichendian");
  };

  /** 进入宣政殿专用屏：清召见态，落 xuanzhengdian 视图（结果态由 courtResult 决定，不在此清）。 */
  const enterXuanzhengdianView = () => {
    setSummonedConsortId(null);
    setView("xuanzhengdian");
  };

  /** 进入御花园总览（或指定子地点）：清召见态/选中态，落 garden 视图。 */
  const enterGardenView = (subId: string | null) => {
    setSummonedConsortId(null);
    setGardenSelectedId(null);
    setGardenSubLocationId(subId);
    setView("garden");
  };

  /**
   * 普通/后宫地点直入：若有符合条件的 auto_on_enter 事件，直接开始（取代旧「是否处理」阻断弹窗）。
   * 仅在「显式进入（非事件返回）」的无 checkpoint 路径调用，故不会与旅行结算的 checkpoint 重复启动。
   * request_audience/exploration/manual/scheduled 不会被 pickAutoStartEvent 选中。
   */
  const autoStartOnEntry = (): boolean => {
    const s = store.getState();
    const loc = s.playerLocation;
    const ev = pickAutoStartEvent(db, s, "location_enter", db.locations[loc]);
    if (!ev) return false;
    startEvent(ev.id, { kind: "location", locationId: loc }); // ev_chaohui 走 startEvent 内 beginCourt 特例
    return true;
  };

  /** Pick the right room view for the player's current location (specialized screens vs generic). */
  const enterCurrentLocation = () => {
    const loc = store.getState().playerLocation;
    if (loc === "zichendian") { enterZichendianView(); return; }
    if (loc === "xuanzhengdian") { setCourtResult(null); enterXuanzhengdianView(); return; }
    if (loc === "yuhuayuan") { enterGardenView(null); return; }
    if (loc === "cining_gong") {
      if (store.getState().taihou.deceased) { setNotice("太后已驾鹤西去。"); goHome(); return; }
      setView("cining_gong"); maybeShizhi(); return;
    }
    if (loc === "wenzhaodian") { setView("wenzhaodian"); maybeAutumnHunt(); return; }
    if (loc === "yuqing_gong") { setView("yuqing_gong"); return; }
    if (loc === "fengxiandian") { setView("fengxiandian"); return; }
    // 普通/后宫地点：进入即直入符合条件的 auto_on_enter 事件（无弹窗）；否则停留场景。
    setView("location");
    autoStartOnEntry();
  };

  /** Set the room view for a given location id (no entry-time flavor rolls — used on event return). */
  const setLocationView = (locId: string) => {
    if (locId === "zichendian") { enterZichendianView(); return; } // 候见事件返回须落专用屏并对账
    if (locId === "xuanzhengdian") { enterXuanzhengdianView(); return; } // 宣政殿事件返回落专用屏（保留结果态）
    if (locId === "yuhuayuan") { enterGardenView(gardenSubLocationId); return; } // 御花园事件返回落回（子）地点
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
    if (nav.view === "xuanzhengdian") { enterXuanzhengdianView(); return; } // 宣政殿专用屏（朝议结果态由 courtResult 决定）
    if (nav.view === "garden") { enterGardenView(nav.subLocationId ?? null); return; } // 精确回到 garden 子地点
    setLocationView(nav.locationId!); // location / zichendian（PR2）→ 对应专用/通用场景
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

  /**
   * 生命周期作废（新游戏/读档/驾崩/回标题）统一收口：纪元自增使任何进行中 token 永不再 current，并**立即**
   * 解除对话/续接的 in-flight 与 UI pending（不等旧 provider promise settle）。旧续接的 finally 因 token 不再
   * current 而不会清新会话状态。
   */
  const invalidateDialogue = () => {
    dialogueOpRef.current = invalidateDialogueOps(dialogueOpRef.current);
    setDialogueInFlight(false);
    choiceOpTokenRef.current = null;
    setChoicePendingToken(null);
    // Lifecycle cleanup: drop any retained converse scene context so a new game,
    // load, sovereign death, or return-to-title cannot leak the old conversation's
    // presence/privacy into the next one.
    converseSceneCtxRef.current = null;
  };

  /** 若管理/搬迁是从「查看侍君」列表进入的，操作结束后重开列表（定位到该侍君）。 */
  const reopenConsortListIfReturning = () => {
    if (consortListReturnId) setConsortListOpen(true);
  };

  const applyRankOp = (charId: string, req: RankOpRequest, origin: "normal" | "first_night") => {
    const state = store.getState();
    const op = buildRankOp(db, state, charId, req, { kind: "sovereign", actorId: "player" as const });
    setRankAdmin(null);
    let outcome: "no_op" | "failed" | "reaction_created";
    if (!op) {
      reopenConsortListIfReturning(); // 无变化：直接回到列表
      outcome = "no_op";
    } else if (op.kind === "demote" || op.kind === "strip_title") {
      // 惩罚性降位/褫号 — 触发后果规划器并播放旁观者反应
      const result = store.applyPunitiveRankChangeWithConsequences(db, charId, req, {});
      if (result.ok) {
        doAutosave();
        const { baseLines, reactionBeats } = result.value;
        const beats: DecreeReaction[] = [
          { speakerId: charId, lines: baseLines },
          ...reactionBeats,
        ];
        // 初夜来源：不覆盖 deferred checkpoint；普通来源：清空旧 pending。
        playReactions(beats, origin === "first_night" ? "preserve" : null);
        outcome = "reaction_created";
      } else {
        reopenConsortListIfReturning();
        outcome = "failed";
      }
    } else {
      // 普通位分管理（册封/晋升）——不触发惩罚后果
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
    // 初夜来源：无反应（无变化/失败）须先播完排队反应（懿旨），末条 onDone 再补跑被搁置的转旬；
    // 生成反应（reaction_created）则交其 onDone 补跑。统一经纯决策收尾。
    applyFirstNightRankDrain(origin, outcome);
  };

  // applyHaremAdminRankOp removed — harem admin decisions are NPC-autonomous (PR #73A)

  /** 惩罚命令（禁足/解除/赐死）统一入口；紫宸殿与侍君宫殿共用。 */
  const applyImperialCommand = (charId: string, command: ImperialCommand) => {
    setPunishCharId(null);

    if (command.type === "impose_confinement" || command.type === "execute") {
      // 惩罚性命令 — 触发后果规划器（fear/loyalty/旁观者反应）；punishmentId 由 Store 内部生成
      const result = store.applyImperialPunishmentWithConsequences(db, command, {});
      if (result.ok) {
        doAutosave();
        if (command.type === "impose_confinement") {
          const newState = store.getState();
          const charHome = newState.standing[charId]?.residence ??
            ((db.characters[charId] ?? newState.generatedConsorts[charId])?.defaultLocation);
          if (charHome && newState.playerLocation === charHome) {
            setPunishGoHome(true);
          }
          if (summonedConsortId === charId) setSummonedConsortId(null);
        }
        const { baseLines, reactionBeats } = result.value;
        playReactions([{ speakerId: charId, lines: baseLines }, ...reactionBeats], null);
      } else {
        reopenConsortListIfReturning();
      }
    } else {
      // 非惩罚性指令（lift_confinement 等）— 不触发后果规划
      const result = store.applyImperialCommand(db, command);
      if (result.ok) {
        doAutosave();
        setReaction({ speakerId: charId, lines: result.value.lines });
      } else {
        reopenConsortListIfReturning();
      }
    }
  };

  const applySendToColdPalace = (charId: string): string | null => {
    const result = store.sendConsortToColdPalace(db, charId, {
      sourceLocation: store.getState().playerLocation ?? undefined,
    });
    if (result.ok) {
      setPunishCharId(null); // close only on success
      doAutosave();
      const char = db.characters[charId] ?? store.getState().generatedConsorts[charId];
      const st = store.getState().standing[charId];
      const rk = st ? db.ranks[st.rank] : undefined;
      const name = char
        ? (st?.title ? `${st.title}${char.profile.name}` : (rk ? `${rk.name}${char.profile.name}` : char.profile.name))
        : charId;
      setReaction({ speakerId: charId, lines: [`${name}奉旨迁居长门宫。`] });
      return null;
    } else {
      return result.error[0]?.message ?? "操作失败，请重试。";
    }
  };

  const applyRestoreFromColdPalace = (charId: string, reason: ColdPalaceLiftReason): string | null => {
    const result = store.restoreFromColdPalace(db, charId, reason);
    if (result.ok) {
      setRestoreCharId(null); // close only on success
      doAutosave();
      const label = reason === "pardoned" ? "特旨赦免" : "奉旨召回";
      setReaction({ speakerId: charId, lines: [`叩首谢恩，${label}。`] });
      return null;
    } else {
      return result.error[0]?.message ?? "操作失败，请重试。";
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
      navDispatch({ type: "clear" }); // 读档清空事件返回上下文（场景态从不入档）
      pendingReactionDispatch({ type: "clear" });
      setRankAdmin(null);

      timeSettlementDispatch({ type: "clear" });
      invalidateDialogue(); // 作废 await 中的旧对话与续接（含 UI pending）
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
    // 反应队列结束后续接：arrival 即时完成（仅 location_enter，不排空全局中断）；转旬进结算排空。
    if (pending) completeDeferredAutoCheckpoint(pending.request);
  };

  /**
   * 初夜位分会话结束（close/no_op/failed/reaction_created）的统一收尾。纯决策 firstNightRankDrainAction
   * 决定动作：有排队反应（皇后懿旨等）→ 先播队列（末条 onDone 再补跑结算，绝不抢跑/遗留）；无队列 → 直接
   * flush；reaction_created/normal → 交由反应 onDone 或不补跑。
   */
  const applyFirstNightRankDrain = (origin: RankAdminOrigin, outcome: RankAdminOutcome) => {
    const action = firstNightRankDrainAction(origin, outcome, reactionQueue.length);
    if (action === "flush_now") { flushPendingReactionCheckpoint(); return; }
    if (action === "play_queue") {
      const [next, ...rest] = reactionQueue;
      setReactionQueue(rest);
      setReaction(next!); // 反应 onDone 续播剩余队列并在末条补跑 pending（见 ReactionScreen onDone）
    }
  };

  /** 为本次行动消耗的每个行动点掷骰皇后懿旨（命中即应用，至多一道/次）。返回台词节拍。 */
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
   * + 皇后懿旨掷骰 + 太后敲打掷骰 + 进贡掷骰 + 乘风汇报。返回扣点结果、台词、皇帝是否崩逝。
   * 皇帝崩逝时不再掷后续节拍（落在已 gameOver 的局上无意义），交调用方 short-circuit 回 title。
   */
  /**
   * 行动结算后的随机节拍：皇后懿旨 + 太后敲打 + 进贡（命中则改走 prompt）/ 乘风汇报。
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
    invalidateDialogue(); // 作废 await 中的旧对话与续接（含 UI pending）
    doAutosave();
    setView("title");
  };

  /**
   * 串播一组反应节拍（行动自身台词 + 皇后懿旨）。
   * - `request` 非空 = 本段为转旬，反应结束后须按该请求结算；
   * - null = 非转旬（覆盖清空任何旧待处理上下文，杜绝串台）；
   * - "preserve" = 不修改 pendingReactionCheckpoint（用于初夜惩罚降位，避免清除已有 deferred checkpoint）。
   * 空队列：转旬即时进结算；"preserve" 模式下空队列为空操作。
   */
  const playReactions = (beats: DecreeReaction[], request: AutoCheckpointRequest | null | "preserve") => {
    if (beats.length === 0) {
      if (request !== "preserve") {
        pendingReactionDispatch({ type: "consume" }); // 无队列：不留待处理上下文
        if (request) completeDeferredAutoCheckpoint(request);
      }
      return;
    }
    if (request !== "preserve") {
      pendingReactionDispatch({ type: "begin", request }); // 非空登记请求；null 覆盖清空
    }
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
    invalidateDialogue(); // 作废 await 中的旧对话与续接（含 UI pending）
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
  // 孕三月自动弹宗正寺（全局中断）。手动「召见宗正寺」入口随紫宸殿迁出 LocationScreen 而移除——
  // 见 PR 描述「已知非阻塞项」：孕四–九月手动召见入口待 ZichendianScreen 补回（PR2 既存缺口，非本 PR 引入）。
  const successorAutoDue =
    selfCarrying && gestMonth === 3 && successorDismissedMonth !== monthOrdinal(liveState.calendar);
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
    const beforeCount = store.getState().resources.bloodline.heirs.length;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    const childSurvives = plan.bearerOutcome !== "child_dies" && plan.bearerOutcome !== "both";
    if (childSurvives) {
      const heirsNow = store.getState().resources.bloodline.heirs;
      setNamePetHeirIds(collectNewbornIds(beforeCount, heirsNow));
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

  const transferHeirCustody = (heirId: string, toCustodianId: string) => {
    // Build reactions from current state before applying effects
    const before = store.getState();
    const heir = before.resources.bloodline.heirs.find((h) => h.id === heirId);
    if (!heir) return;
    const planResult = planHeirCustodyTransfer(db, before, { heirId, toCustodianId, source: "fengxiandian" });
    if (!planResult.ok) return;
    const reactions = planResult.value.reactions;
    // 行动先于时间：抚养权落库后再推进时间（跨月 tick 不会先处置再赋权）。
    const settled = store.transferHeirCustodyAndAdvance(db, { heirId, toCustodianId, source: "fengxiandian" });
    if (!settled.ok) return;
    if (settled.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
    doAutosave();
    pendingReactionDispatch({ type: "begin", request: settled.value.rolledOver ? stationaryRequest() : null });
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
  // 场内原子过场（对话/反应/侍寝/初夜/封赏/场景/朝会/商铺/进贡/赏赐/生成式对话/殿选 prompt）须先结束，全局中断才呈现。
  // 用状态而非 view 字符串判定：事件结束时 activeEventId 先置 null（view 可能仍是 "event"），避免结算死锁。
  const atomicFlowInProgress =
    reaction !== null || childReaction !== null || physicianReaction !== null ||
    firstNightPromptId !== null || namePetHeirId !== null ||
    bedchamberRun !== null || bedchamberPickId !== null || rankAdmin !== null ||
    prompt !== null || daxuanPrompt !== null || giftItemId !== null || successorOpen || morningAfterOpen || ceremonyOpen ||
    activeEventId !== null || court !== null || dianxuan !== null ||
    shopId !== null || view === "shop" || dialogueInFlight ||
    view === "title" || view === "coronation"; // 标题/登基（开局前）不呈现全局中断
  // 同一时刻只呈现一个全局中断（确定性优先级）；场内过场进行中时一律不呈现。
  // 大选由持久 pendingDaxuan 驱动（PR#24 架构）：作为最低优先级全局中断接入结算系统，授权窗口为 grand_selection。
  const activeGlobalInterrupt: GlobalInterruptKind | null = atomicFlowInProgress
    ? null
    : pickNextGlobalInterrupt({
        birthDue: activeBirthPlan !== null,
        pregnancyDisclosureDue: jingshifangDue,
        successorDue: successorAutoDue && selfCarrying,
        centennialDue: centennialHeir !== null,
        coldPalaceReportDue: oldestPresentableIncident(liveState) !== undefined,
        grandSelectionDue: liveState.pendingDaxuan !== undefined,
      });

  // 大选消费（单点）：仅当结算系统在所有更高优先级全局中断之后选中 grand_selection 时消费 pendingDaxuan——
  // 改用 PR#25 的「状态原子所有权 + 选中中断种类」门，**不**用旧的安全视图白名单（避免 activeEventId
  // 已清而 view 仍为 "event" 时把 grand_selection 永久选中却拒绝消费的死锁）。announce 原子落 flag + 经反应所有权
  // 路径播报（可链 dianxuan）；该年殿选已决的陈旧 pending 调和清除；否则按 pending.year 弹殿选 prompt（年份权威）。
  // 一经置 daxuanPrompt / reaction，atomicFlow 即真、grand_selection 退出，杜绝重复消费。
  useEffect(() => {
    if (!content.ok) return;
    if (activeGlobalInterrupt !== "grand_selection") return;
    const pd = store.getState().pendingDaxuan;
    if (!pd) return;
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
  }, [activeGlobalInterrupt]);

  // 紫宸殿外部 busy 归属（§9）：atomicFlow 之外、本殿仍可触达的浮层/选择器/全局中断一并计入。
  // 复用权威 atomicFlowInProgress，不另立第二套原子流程定义。
  const zichendianBusy = zichendianExternalBusy({
    atomicFlowInProgress,
    settlementPending: pendingTimeSettlement !== null, // 刻意独立于 atomicFlow（结算 effect 等 atomicFlow=false 才排空）
    relocateOpen: relocateCharId !== null,
    consortPickerOpen: flipOpen,
    consortListOpen,
    physicianOpen,
    physicianPickerOpen: physicianConsortPickerOpen || physicianHeirPickerOpen,
    heirListOpen,
    resourcePanelOpen,
    storehouseOpen,
    profileOpen: profileCharId !== null,
    settingsOpen,
    choicePending: choicePendingToken !== null,
    globalInterruptActive: activeGlobalInterrupt !== null,
  });

  /** 原地行动转旬请求：只跑 time_advance；返回上下文 = 当前地点（或显式 board）；开新链。 */
  const stationaryRequest = (boardId?: string): AutoCheckpointRequest => ({
    source: "stationary_rollover",
    returnTarget: checkpointReturnTarget(boardId, store.getState().playerLocation),
    dispatch: "new_chain",
  });

  /** 成功转旬后登记一次结算（携带完整 AutoCheckpointRequest）；完成由下方结算 effect 驱动。 */
  const beginSettlement = (request: AutoCheckpointRequest) => {
    timeSettlementDispatch({ type: "begin", request });
  };

  /**
   * 反应队列/过场结束后统一续接：arrival（未转旬，仅 location_enter）即时完成、不进全局结算排空；
   * 其余（转旬）进结算排空全局中断后再补跑。
   */
  const completeDeferredAutoCheckpoint = (request: AutoCheckpointRequest) => {
    if (deferredAutoCheckpointMode(request) === "complete_now") completeAutoCheckpoint(request);
    else beginSettlement(request);
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
    if (event) {
      if (request.dispatch === "continue_chain") {
        // 事件场景转旬产生的 time_advance：留在当前链（chainAdvance，不重置 chainDepth、不消费返回上下文）。
        if (canChain(navState)) {
          navDispatch({ type: "chainAdvance" });
          setActiveEventId(event.id);
          setView("event");
        } else {
          logger?.logGameError(
            stateError("EVENT_CHAIN_LIMIT", `time_advance chain capped at ${MAX_EVENT_CHAIN}`, {
              severity: "warn",
              context: { deferred: event.id },
            }),
          );
          restoreReturn(); // 链满：恢复原始返回上下文一次
        }
      } else {
        startEvent(event.id, request.returnTarget); // 新链
      }
      return;
    }
    // 无事件：continue_chain 经 restoreReturn 消费导航上下文一次；new_chain 按完整目标恢复 + 落点氛围掷骰。
    if (request.dispatch === "continue_chain") { restoreReturn(); return; }
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
    if (dialogueOpRef.current.activeOp !== null) return; // 已有对话操作进行中：拒绝并发，且不扣行动点
    const fallbackLines = buildConversation(db, store.getState(), charId);
    if (!fallbackLines) return;
    const { spend, decreeBeats, sovereignDied } = spendAp(1);
    if (!spend.ok) return;
    if (sovereignDied) { onSovereignDeath(); return; }
    store.recordOvernight(db, charId, spend.value.rolledOver);
    setSummonedConsortId(null);
    doAutosave();

    // Generative path: assemble request, snapshot expected state, produce turn, CAS。
    // 期间标记 in-flight（计入 atomicFlowInProgress，孕/产等全局中断不得插队）；以操作令牌防 stale async：
    // 若 await 期间发生新游戏/读档/驾崩（令牌自增），则丢弃本次完成，不串播、不结算。
    if (dialogueRuntime) {
      const expectedState = store.getState();
      // Derive presence/privacy scene context once for this conversation; the same
      // object feeds the opening turn and every choice-driven continuation.
      const sceneContext = deriveConverseSceneContext(charId);
      converseSceneCtxRef.current = sceneContext;
      const reqResult = assembleDialogueRequest(db, expectedState, charId, expectedState.playerLocation, sceneContext);
      if (reqResult.ok) {
        const started = startDialogueOp(dialogueOpRef.current); // 唯一 token + 占用
        if (started.token !== null) {
          dialogueOpRef.current = started.state;
          const opToken = started.token;
          setDialogueInFlight(true);
          try {
            const turnResult = await produceDialogueTurn(db, dialogueRuntime.provider, reqResult.value, expectedState, toDialogueTurnOptions(dialogueRuntime));
            if (!isCurrentDialogueOp(dialogueOpRef.current, opToken)) return; // stale：读档/新局/驾崩已发生，忽略
            if (turnResult.ok) {
              const kw = turnResult.value.line.meta.knowledge;
              setRecentKnowledge({
                configured: dialogueRuntime.knowledgeRetriever !== undefined,
                chunkIds: kw?.chunkIds ?? [],
                degraded: kw?.degraded ?? false,
                degradationKind: kw?.degradationKind,
                degradationReason: kw?.degradationReason,
              });
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
          } finally {
            // 仅当 token 仍是当前操作才释放（旧操作绝不清新操作的忙碌位）。
            dialogueOpRef.current = finishDialogueOp(dialogueOpRef.current, opToken);
            if (dialogueOpRef.current.activeOp === null) setDialogueInFlight(false);
          }
        }
      }
    }

    // Fallback path: scripted lines
    playReactions([{ speakerId: charId, lines: fallbackLines }, ...decreeBeats], spend.value.rolledOver ? stationaryRequest() : null);
  };

  // Handles a player choice click during a generative conversation turn.
  // No extra AP is spent here — AP was already spent in converse().
  const onConverseChoice = useCallback(async (choice: { id: string; text: string; tone?: string }) => {
    if (!dialogueRuntime || !reaction?.generatedLine) return;
    // 续接也是一次 provider request：纳入对话操作所有权。并发门只由 startDialogueOp 把守（activeOp!=null → 拒绝），
    // 不再用独立布尔（杜绝失效后旧布尔卡死新续接）。若 await 期间发生新游戏/读档/驾崩（invalidateDialogue 自增纪元、
    // 清 choice token），token 不再 current → 丢弃本次完成：不提交 state、不设反应、不清新会话的忙碌位与 UI pending。
    const started = startDialogueOp(dialogueOpRef.current);
    if (started.token === null) return; // 已有活动对话操作（含正在进行的续接）：拒绝并发
    dialogueOpRef.current = started.state;
    const opToken = started.token;
    choiceOpTokenRef.current = opToken;
    setChoicePendingToken(opToken);
    setDialogueInFlight(true);

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
      // Reuse the conversation's scene context so presence/privacy stay stable across turns.
      const sceneContext = converseSceneCtxRef.current ?? deriveConverseSceneContext(speakerId);
      const reqResult = assembleDialogueRequest(db, expectedState, speakerId, expectedState.playerLocation, { ...sceneContext, transcript });
      if (!reqResult.ok) {
        if (!isCurrentDialogueOp(dialogueOpRef.current, opToken)) return; // stale：失效后不得改界面
        // Assembly failed — strip generatedLine so normal onDone drains the queue/rollover
        setReaction({ speakerId, lines: ["（对话暂时中断）"] });
        return;
      }

      const turnResult = await produceDialogueTurn(db, dialogueRuntime.provider, reqResult.value, expectedState, toDialogueTurnOptions(dialogueRuntime));
      if (!isCurrentDialogueOp(dialogueOpRef.current, opToken)) return; // stale：读档/新局/驾崩已发生，忽略本次完成
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
      const kw2 = nextLine.meta.knowledge;
      setRecentKnowledge({
        configured: dialogueRuntime.knowledgeRetriever !== undefined,
        chunkIds: kw2?.chunkIds ?? [],
        degraded: kw2?.degraded ?? false,
        degradationKind: kw2?.degradationKind,
        degradationReason: kw2?.degradationReason,
      });
      // Update reaction state with the new generated line; carry decree beats from the queue
      setReaction({ speakerId, lines: [nextLine.text], generatedLine: nextLine });
    } finally {
      // 全程 owner-scoped 收尾：仅当本 token 仍是当前 op 才释放忙碌位 + UI pending；旧（已失效/被接管的）续接
      // 绝不清新会话的 dialogueInFlight / choicePending。生命周期失效已由 invalidateDialogue 即时清两者。
      dialogueOpRef.current = finishDialogueOp(dialogueOpRef.current, opToken);
      if (dialogueOpRef.current.activeOp === null) setDialogueInFlight(false);
      if (choiceOpTokenRef.current === opToken) {
        choiceOpTokenRef.current = null;
        setChoicePendingToken(null);
      }
    }
  }, [dialogueRuntime, reaction, store, db]);

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
    // 宫内免行动点移动：保存位置即可，不掷皇后懿旨/太后敲打、不跑转旬 checkpoint。
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
    const travelTarget = checkpointReturnTarget(stayOnMapBoardId, store.getState().playerLocation);
    // 出宫/城内地图（stayOnMapBoardId）：玩家未进房间，playerLocation 只是未变留痕，绝不触发 location_enter
    // （否则刚点宫门就被司礼传月祭仪等房间事件拦下；承自 main 447b4c7）；仅转旬时跑 time_advance（stationary 语义）。
    // 真正抵达房间：转旬=travel_rollover（time_advance 优先，无则 location_enter）；未转旬=arrival（仅 location_enter）。
    // 两者都开新链；arrival 也须在反应队列结束后跑 location_enter（不可丢，见 Blocker 1）。
    const request: AutoCheckpointRequest | null = stayOnMapBoardId
      ? rolledOver
        ? { source: "stationary_rollover", returnTarget: travelTarget, dispatch: "new_chain" }
        : null
      : rolledOver
        ? { source: "travel_rollover", returnTarget: travelTarget, dispatch: "new_chain" }
        : { source: "arrival", returnTarget: travelTarget, dispatch: "new_chain" };
    if (request) {
      if (beats.length) playReactions(beats, request);
      else completeDeferredAutoCheckpoint(request);
    } else {
      // 出宫未转旬：无 checkpoint，先播完节拍，再落到目标地图板（不按 playerLocation 切回房间）。
      if (beats.length) playReactions(beats, null);
      setMapAtRoot(false);
      setCurrentBoard(stayOnMapBoardId!);
      setView("map");
    }
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
      // NPC 留牌（纯，基于当前 state 确定性算出），随后一次性原子提交：
      // [校验该年未决 pending → 落库 → 置 flag → 清 pending]，杜绝部分状态。
      const kept = npcKeepOnDelegate(db, store.getState(), action.year);
      const res = store.resolveDaxuanByDelegate(db, action.year, kept);
      if (!res.ok) {
        // NO_PENDING（陈旧/重复/错年）静默关闭 prompt；真正的落库冲突保留 prompt 允许原地重试，
        // 且不播成功文案、不 autosave。仅 Result.ok 才关界面。
        if (res.error.code === "NO_PENDING_DAXUAN") setDaxuanPrompt(null);
        else setNotice("殿选留牌出了岔子，本次未能留牌，请稍后再试。");
        return;
      }
      setDaxuanPrompt(null);
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
    // 玩家所选 + 早退场 NPC 留牌合并为同一批，整批原子提交（任一冲突全不落、界面不结束）。
    const batch: { candidate: Candidate; rank: string }[] = [...kept];
    const beats: DecreeReaction[] = [];
    let npcKept: { candidate: Candidate; rank: string } | null = null;
    if (leftEarly && dianxuan) {
      const reviewedIds = new Set(kept.map((k) => k.candidate.content.id));
      const remaining = dianxuan.candidates
        .slice(reviewedCount)
        .filter((c) => !reviewedIds.has(c.content.id));
      npcKept = npcKeepOnLeave(remaining, store.getState(), year);
      if (npcKept) batch.push(npcKept);
    }
    const res = store.commitDaxuanSelections(db, batch);
    if (!res.ok) {
      // 失败：保留殿选界面、不 autosave、不返回紫宸殿，提示重试/调整。
      setNotice("殿选留牌出了岔子（人选或位分冲突），尚未留牌，请重试或调整选择。");
      return;
    }
    if (npcKept) {
      beats.push({
        speakerId: "cheng_feng",
        lines: [`陛下留步——有一位${npcKept.candidate.announce.replace(/，年.*$/, "")}颇得太后青眼，太后留了他的牌子，封为${db.ranks[npcKept.rank]?.name ?? ""}。`],
      });
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
          onManage={(id) => setRankAdmin({ charId: id, origin: "normal" })}
          onPunish={(id) => setPunishCharId(id)}
          onRelocate={(id) => setRelocateCharId(id)}
              onRestoreFromColdPalace={(id) => setRestoreCharId(id)}
          onBedchamber={(id) => beginBedchamber(id)}
          onConverse={converse}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
          onViewProfile={(id) => setProfileCharId(id)}
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
          onTransferCustody={transferHeirCustody}
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
      {view === "zichendian" && (() => {
        // 紫宸殿专用屏：用订阅态（liveState）构建权威候见视图模型；专用屏外仍由 GameShell 提供顶栏/面包屑/国情/库房/设置/地图导航。
        const location = db.locations["zichendian"]!;
        const bg = registry.resolveVariant(location.backgroundKey, timeOfDay(liveState.calendar), "background");
        const queue = getAudienceQueue(db, liveState, "zichendian");
        const deferredQueue = getDeferredAudienceQueue(db, liveState, "zichendian");
        const activeItem = selectActiveAudience(queue);
        const summonedView = summonedConsortId ? summonedConsortToView(db, liveState, registry, summonedConsortId) : undefined;
        // 召见侍君 / 乘风召见妃嫔：开既有选人盘的 summon 模式（不套 canBedchamber 侍寝门槛——此路通向叙话/临场，
        // 非即时侍寝）；盘内仍按 canSummon 过滤不可召见者；选中后 onPick 置 summonedConsortId。
        const summonConsortPicker = () => { setFlipMode("summon"); setFlipOpen(true); };
        // 离开紫宸殿：清召见态，按既有非根地图行为开当前宫城板（返回可逐级回主图）。
        const leaveZichendian = () => { setSummonedConsortId(null); setMapAtRoot(false); setView("map"); };
        // 叙话需 1 行动点：AP 不足时叙话禁用并显原因（不暴露「可点却静默无效」按钮）。
        const canConverseSummoned = summonedConsortId !== null && liveState.calendar.ap >= 1;
        return (
          <GameShell
            calendar={liveState.calendar}
            crumbs={breadcrumbFor(db, "zichendian")}
            pregnancyMonth={sovereignGestationDisplay(liveState)?.month ?? undefined}
            onBack={leaveZichendian}
            onOpenResources={() => setResourcePanelOpen(true)}
            onOpenStorehouse={() => setStorehouseOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            className="location-shell scene-host-shell"
          >
            <ZichendianScreen
              background={bg.url}
              backgroundPosition={location.backgroundPosition}
              isFallbackBackground={bg.isFallback}
              audienceCount={audienceCount(db, liveState, "zichendian")}
              deferredAudienceCount={deferredAudienceCount(db, liveState, "zichendian")}
              activeAudience={activeItem ? audienceItemToView(db, liveState, registry, activeItem) : undefined}
              pendingAudienceItems={deferredQueue.map((i) => audienceItemToPendingView(db, liveState, registry, i))}
              summonedConsort={summonedView}
              onConverseSummonedConsort={summonedConsortId ? () => { const id = summonedConsortId; if (id) void converse(id); } : undefined}
              summonedConverseDisabledReason={summonedConsortId && !canConverseSummoned ? "行动力不足" : undefined}
              onDismissSummonedConsort={summonedConsortId ? () => setSummonedConsortId(null) : undefined}
              interruptible={!zichendianBusy}
              busy={zichendianBusy}
              onAdmitAudience={(eventId) => startEvent(eventId, { kind: "zichendian" })}
              onDeferAudience={(eventId) => {
                const applied = store.applyEffects(db, defer(eventId, store.getState().calendar.dayIndex));
                if (applied.ok) doAutosave(); // 仅成功延期后落盘；不清/完成事件、不本地删项——订阅态更新使提示自然消失
              }}
              onAdmitPendingAudience={(eventId) => startEvent(eventId, { kind: "zichendian" })}
              onReviewMemorials={reviewMemorials}
              onReviewPersonnel={() => setView("personnelDecisions")}
              personnelDecisionCount={getPendingPersonnelDecisions(liveState).length}
              onReviewCourtMemorials={() => setView("courtMemorials")}
              courtMemorialCount={getPendingMemorials(liveState).length}
              onSummonConsort={summonConsortPicker}
              onRest={restAlone}
              onLeave={leaveZichendian}
              onManageRank={() => { setConsortListReturnId(null); setConsortListOpen(true); }}
              onRelocate={() => { setConsortListReturnId(null); setConsortListOpen(true); }}
              onBestow={() => setStorehouseOpen(true)}
              onPhysician={() => setPhysicianOpen(true)}
              onTransferHaremAdministration={() => {
                setHaremTransferPending(true);
                setConsortListReturnId(null);
                setConsortListOpen(true);
              }}
            />
          </GameShell>
        );
      })()}
      {view === "garden" && (() => {
        // 御花园探索：总览（4 子地点 + 园中在场人物）/ 子地点普通游览。在场人物以 presentAt 为唯一权威。
        const loc = db.locations["yuhuayuan"]!;
        const bg = registry.resolveVariant(loc.backgroundKey, timeOfDay(liveState.calendar), "background");
        const presentItems = presentBarItems(db, liveState, "yuhuayuan");
        const presentIds = presentItems.map((i) => i.id);
        const effSel = gardenSelectedId == null ? null : reconcileSelection(presentIds, gardenSelectedId);
        const focused = effSel ? focusedCharacterView(db, liveState, registry, effSel) : undefined;
        const subAreas: GardenSubAreaView[] = (loc.subLocations ?? []).map((sa) => {
          const ev = pickSubLocationEvent(db, liveState, "yuhuayuan", sa.id);
          const sbg = registry.resolveVariant(sa.backgroundKey, timeOfDay(liveState.calendar), "background");
          const hint = ev?.presentation?.mode === "exploration" ? ev.presentation.eventHint : undefined;
          const affordable = ev ? subLocationEventAffordable(liveState, ev) : undefined;
          return {
            id: sa.id,
            name: sa.name,
            description: sa.description,
            background: sbg.url,
            isFallbackBackground: sbg.isFallback,
            backgroundPosition: sa.backgroundPosition,
            hasEvent: ev !== null,
            eventHint: hint,
            eventAffordable: affordable,
            eventReason: ev && affordable === false ? `行动力不足（需 ${ev.apCost} 行动点）。` : undefined,
          };
        });
        const activeSub = gardenSubLocationId ? subAreas.find((s) => s.id === gardenSubLocationId) ?? null : null;
        const leaveGarden = () => { setGardenSelectedId(null); setGardenSubLocationId(null); setMapAtRoot(false); setView("map"); };
        const enterGardenSubArea = (subId: string) => {
          // 子地点有可探索事件且可承担 → 进入即开始（返回上下文精确到该子地点）；
          // 有事件但行动力不足 → 进入子地点，显「行动力不足」（不伪装成普通游览）；
          // 无事件 → 普通游览（仍可与园中在场人物叙话）。
          const ev = pickSubLocationEvent(db, store.getState(), "yuhuayuan", subId);
          if (ev && subLocationEventAffordable(store.getState(), ev)) {
            startEvent(ev.id, { kind: "garden", subLocationId: subId });
            return;
          }
          setGardenSubLocationId(subId);
        };
        return (
          <GameShell
            calendar={liveState.calendar}
            crumbs={breadcrumbFor(db, "yuhuayuan")}
            pregnancyMonth={sovereignGestationDisplay(liveState)?.month ?? undefined}
            onBack={leaveGarden}
            onOpenResources={() => setResourcePanelOpen(true)}
            onOpenStorehouse={() => setStorehouseOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            className="location-shell scene-host-shell"
          >
            <GardenOverviewScreen
              background={bg.url}
              isFallbackBackground={bg.isFallback}
              backgroundPosition={loc.backgroundPosition}
              subAreas={subAreas}
              activeSubArea={activeSub}
              presentBar={presentItems}
              selectedId={effSel}
              focusedCharacter={focused}
              onSelectCharacter={setGardenSelectedId}
              onEnterSubArea={enterGardenSubArea}
              onExitSubArea={() => setGardenSubLocationId(null)}
              onBack={leaveGarden}
              onConverse={(id) => void converse(id)}
              onBedchamber={(id) => beginBedchamber(id)}
              onViewProfile={(id) => setProfileCharId(id)}
              onManage={(id) => setRankAdmin({ charId: id, origin: "normal" })}
              onRelocate={(id) => setRelocateCharId(id)}
                    />
          </GameShell>
        );
      })()}
      {view === "xuanzhengdian" && (() => {
        // 宣政殿专用屏：议程态（真实可议议程 + 升朝）/ 结果态（朝议真实 diff 摘要）。
        const loc = db.locations["xuanzhengdian"]!;
        const bg = registry.resolveVariant(loc.backgroundKey, timeOfDay(liveState.calendar), "background");
        const agenda = courtAgendaPreview(db, liveState);
        const summary = courtResult ? buildCourtSummary(db, courtResult) : null;
        // 升朝门槛：健康/服丧 + 卯时满行动力；无议程则禁用（不空跑扣点）。结果态不显升朝。
        const holdGate = agenda.length === 0 ? { ok: false as const, reason: "今日无政务可议。" } : courtHoldGate(liveState);
        const leaveXuan = () => { setCourtResult(null); setMapAtRoot(false); setView("map"); };
        return (
          <GameShell
            calendar={liveState.calendar}
            crumbs={breadcrumbFor(db, "xuanzhengdian")}
            pregnancyMonth={sovereignGestationDisplay(liveState)?.month ?? undefined}
            onBack={leaveXuan}
            onOpenResources={() => setResourcePanelOpen(true)}
            onOpenStorehouse={() => setStorehouseOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            className="location-shell scene-host-shell"
          >
            <XuanzhengdianScreen
              background={bg.url}
              isFallbackBackground={bg.isFallback}
              backgroundPosition={loc.backgroundPosition}
              agenda={agenda}
              holdGate={holdGate}
              onHoldCourt={beginCourt}
              onLeave={leaveXuan}
              summary={summary}
              onBackToHall={() => setCourtResult(null)}
              onBackToMap={leaveXuan}
              onOpenOfficials={() => setView("officials")}
              highVacancyCount={getHighVacancyPosts(liveState, db).length}
              onOpenExamination={() => setView("examination")}
              unacknowledgedExamCount={getUnacknowledgedExaminationResults(liveState).length}
            />
          </GameShell>
        );
      })()}
      {view === "officials" && (
        <GameShell
          calendar={liveState.calendar}
          crumbs={breadcrumbFor(db, "xuanzhengdian")}
          pregnancyMonth={sovereignGestationDisplay(liveState)?.month ?? undefined}
          onBack={() => setView("xuanzhengdian")}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          className="location-shell"
        >
          <OfficialsScreen db={db} store={store} onBack={() => setView("xuanzhengdian")} onCommitted={doAutosave} />
        </GameShell>
      )}
      {view === "examination" && (
        <GameShell
          calendar={liveState.calendar}
          crumbs={breadcrumbFor(db, "xuanzhengdian")}
          pregnancyMonth={sovereignGestationDisplay(liveState)?.month ?? undefined}
          onBack={() => setView("xuanzhengdian")}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          className="location-shell"
        >
          <ExaminationScreen db={db} store={store} onBack={() => setView("xuanzhengdian")} onCommitted={doAutosave} />
        </GameShell>
      )}
      {view === "personnelDecisions" && (
        <GameShell
          calendar={liveState.calendar}
          crumbs={breadcrumbFor(db, "zichendian")}
          pregnancyMonth={sovereignGestationDisplay(liveState)?.month ?? undefined}
          onBack={() => setView("zichendian")}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          className="location-shell"
        >
          <PersonnelDecisionsScreen db={db} store={store} onBack={() => setView("zichendian")} onCommitted={doAutosave} />
        </GameShell>
      )}
      {view === "courtMemorials" && (
        <GameShell
          calendar={liveState.calendar}
          crumbs={breadcrumbFor(db, "zichendian")}
          pregnancyMonth={sovereignGestationDisplay(liveState)?.month ?? undefined}
          onBack={() => setView("zichendian")}
          onOpenResources={() => setResourcePanelOpen(true)}
          onOpenStorehouse={() => setStorehouseOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          className="location-shell"
        >
          <MemorialsScreen db={db} store={store} onBack={() => setView("zichendian")} onCommitted={doAutosave} />
        </GameShell>
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
            // 宣政殿（free-view 节点）改走朝议专用屏（议程 + 升朝 + 结果），不再用通用 free-view「上朝」入口。
            if (locationId === "xuanzhengdian") { setCourtResult(null); enterXuanzhengdianView(); return; }
            setFreeViewId(locationId);
            setView("freeview");
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => {
            setFocusConsortId(null);
            // 关地图回房：紫宸殿落专用屏（并对账），御花园落探索总览，其余维持既有 location 行为。
            const here = store.getState().playerLocation;
            if (here === "zichendian") enterZichendianView();
            else if (here === "xuanzhengdian") { setCourtResult(null); enterXuanzhengdianView(); }
            else if (here === "yuhuayuan") enterGardenView(null);
            else setView("location");
          }}
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
            // 先离开 shop 视图回到被动地图板，再视情况结算——否则 shopId=null 但 view 仍 "shop" 会让
            // atomicFlow 永久判真、结算永不排空（§ Blocker 2 死锁）。currentBoard 此刻已稳定。
            const rolled = shopRollover.current;
            shopRollover.current = false;
            setShopId(null);
            setMapAtRoot(false);
            setView("map");
            if (rolled) beginSettlement(stationaryRequest(currentBoard));
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
          onRestoreFromColdPalace={(id) => setRestoreCharId(id)}
          onInterveneColdPalace={(charId) => setColdPalaceInterventionTarget(charId)}
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
            const completedEventId = activeEventId; // 快照：清 activeEventId 前留存，供清账判定
            setActiveEventId(null);
            if (!committed) {
              // 弃场：若链内前序事件已留下待结算（pendingTimeSettlement），不得消费/恢复导航上下文——
              // activeEventId 已清，交由既有结算 effect 排空并最终恢复一次；否则立即恢复。
              // 弃场绝不清候见账（仅打开未提交 ≠ 候见完成）。
              const abandonPlan = eventSceneCompletionPlan({
                committed: false,
                rolledOver: false,
                hasSceneEndEvent: false,
                canChain: false,
                hasPendingSettlement: pendingTimeSettlement !== null,
              });
              if (abandonPlan.restore) restoreReturn();
              return;
            }
            // 候见事件成功提交：清本殿候见账（pending/shownAt/remindAt）并对账，再落盘——持久态须含清账。
            // 仅 request_audience 且 host===zichendian 才清；他 host / 非候见事件不动。
            const completedEvent = completedEventId ? db.events[completedEventId] : undefined;
            if (completedEventId && shouldClearAudienceOnCommit(completedEvent, true, "zichendian")) {
              const applied = store.applyEffects(db, clearAudience(completedEventId));
              if (applied.ok) {
                const recon = audienceReconciliationEffects(db, store.getState(), "zichendian");
                if (recon.length > 0) store.applyEffects(db, recon);
              }
            }
            doAutosave(); // scene-commit autosave (plan §9) — 现已含候见清账
            const sceneEndState = store.getState();
            const pick = pickAutoStartEvent(db, sceneEndState, "scene_end", db.locations[sceneEndState.playerLocation]);
            const plan = eventSceneCompletionPlan({
              committed: true,
              rolledOver: rolledOver === true,
              hasSceneEndEvent: pick !== null,
              canChain: canChain(navState),
              hasPendingSettlement: pendingTimeSettlement !== null,
            });
            // 任一链内事件转旬都登记/刷新 continue_chain 结算（保留转旬至整条 scene_end 链走完才排空）。
            if (plan.beginSettlement) {
              beginSettlement({
                source: "stationary_rollover",
                returnTarget: navState.target ?? { kind: "map", atRoot: true },
                dispatch: "continue_chain",
              });
            }
            if (plan.startSceneEnd) {
              navDispatch({ type: "chainAdvance" }); // 续接 scene_end：继承 target、不重置、不消费；结算（若有）由 activeEventId 守住不排空
              setActiveEventId(pick!.id);
              return;
            }
            if (pick && !canChain(navState)) {
              logger?.logGameError(
                stateError("EVENT_CHAIN_LIMIT", `scene_end chain capped at ${MAX_EVENT_CHAIN}`, {
                  severity: "warn",
                  context: { deferred: pick.id },
                }),
              );
            }
            // 终端：有待结算则交结算 effect 排空全局中断 + 补跑 time_advance + 恢复一次（不在此 restoreReturn）；
            // 否则（无转旬、无 pending）立即恢复。
            if (plan.restore) restoreReturn();
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
            // 朝议毕：以朝议前后真实快照 diff 生成结果摘要（含退朝——已处置之事的真实差值）。
            if (courtSnapshotRef.current) {
              setCourtResult(diffCourtMetrics(courtSnapshotRef.current, snapshotCourtMetrics(store.getState())));
              courtSnapshotRef.current = null;
            }
            restoreReturn(); // → 宣政殿专用屏（结果态由 courtResult 决定）
          }}
        />
      )}
      {rankAdmin && store.getState().standing[rankAdmin.charId] && (
        <RankAdminModal
          db={db}
          character={db.characters[rankAdmin.charId]!}
          standing={store.getState().standing[rankAdmin.charId]!}
          usedEpithetChars={Object.entries(store.getState().standing)
            .filter(([id, st]) => id !== rankAdmin.charId && st.title)
            .flatMap(([, st]) => Array.from(st.title!))}
          onApply={(req) => applyRankOp(rankAdmin.charId, req, rankAdmin.origin)}
          onClose={() => {
            const origin = rankAdmin.origin;
            setRankAdmin(null);
            // 初夜来源关闭（未应用）：先播完排队反应（懿旨），末条 onDone 再补跑被搁置的转旬，杜绝遗留/抢跑；
            // 普通来源不因关闭补跑。
            applyFirstNightRankDrain(origin, "close");
            reopenConsortListIfReturning(); // 取消也回到列表
          }}
        />
      )}
      {punishCharId && (db.characters[punishCharId] ?? liveState.generatedConsorts[punishCharId]) && liveState.standing[punishCharId] && (
        <PunishmentModal
          db={db}
          state={liveState}
          character={(db.characters[punishCharId] ?? liveState.generatedConsorts[punishCharId])!}
          onCommand={(command) => applyImperialCommand(punishCharId, command)}
          onSendToColdPalace={applySendToColdPalace}
          onClose={() => {
            setPunishCharId(null);
            reopenConsortListIfReturning(); // 取消也回到列表
          }}
        />
      )}
      {coldPalaceInterventionTarget && (
        <ColdPalaceInterventionModal
          db={db}
          state={liveState}
          charId={coldPalaceInterventionTarget}
          onSelect={(kind: ColdPalaceInterventionKind) => {
            const before = store.getState().calendar;
            const result = store.interveneInColdPalace(db, coldPalaceInterventionTarget, kind);
            if (!result.ok) {
              return result.error[0]?.message ?? "操作失败";
            }
            setColdPalaceInterventionTarget(null);
            if (result.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return null; }
            const decreeBeats = rollActionBeats(before, 1);
            doAutosave();
            playReactions(decreeBeats, result.value.rolledOver ? stationaryRequest() : null);
            return null;
          }}
          onClose={() => setColdPalaceInterventionTarget(null)}
        />
      )}
      {restoreCharId && (db.characters[restoreCharId] ?? liveState.generatedConsorts[restoreCharId]) && liveState.standing[restoreCharId] && (
        <ColdPalaceRestoreModal
          db={db}
          state={liveState}
          charId={restoreCharId}
          onConfirm={(reason) => applyRestoreFromColdPalace(restoreCharId, reason)}
          onClose={() => setRestoreCharId(null)}
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
          onChoice={reaction?.generatedLine && dialogueRuntime ? onConverseChoice : undefined}
          choicePending={choicePendingToken !== null}
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
            if (punishGoHome) {
              // 禁足令在侍君宫殿发布：宫门已闭，皇帝需离宫回主图。
              setPunishGoHome(false);
              goHome();
            } else if (postBirthPromoteId) {
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
          mode={flipMode}
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
          onPunish={(id) => {
            setConsortListReturnId(id);
            setConsortListOpen(false);
            setPunishCharId(id);
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
          onTransferHaremAdmin={haremTransferPending ? (charId) => {
            setConsortListOpen(false);
            setHaremTransferPending(false);
            const target: HaremAdministrationTarget = { kind: "consort", charId };
            const result = store.transferHaremAdministration(db, { type: "transfer_harem_administration", target });
            if (result.ok) {
              doAutosave();
              playReactions(result.value.reactionBeats, null);
            }
          } : undefined}
          onClose={() => {
            setConsortListReturnId(null);
            setConsortListOpen(false);
            setHaremTransferPending(false);
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
                  // 先串播待播的皇后懿旨；其 onDone 会接手转旬补跑（pending 上下文保留）。
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
          key={namePetHeirId}
          title="为新生皇嗣起个小名"
          hint="乳名一双字，亲昵相唤。"
          confirmLabel="起名"
          onRandom={() => randomPetName(store.getState().rngSeed, namePetHeirId)}
          onConfirm={(name) => {
            const id = namePetHeirId;
            if (!id) return;
            const r = store.applyEffects(db, [{ type: "heir_name", heirId: id, field: "pet", name }]);
            if (!r.ok) return;
            doAutosave();
            setNamePetHeirIds((queue) => queue.slice(1));
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
      {activeGlobalInterrupt === "cold_palace_report" && restoreCharId === null && (() => {
        const incident = oldestPresentableIncident(liveState);
        if (!incident) return null;
        if (incident.kind === "critical_illness" && incident.status === "pending_response") {
          return (
            <ColdPalaceCriticalIncidentModal
              db={db}
              state={liveState}
              incident={incident}
              onPhysician={() => {
                const r = store.resolveColdPalaceCriticalIncident(db, incident.id, "physician");
                if (r.ok) doAutosave();
              }}
              onIgnore={() => {
                const r = store.resolveColdPalaceCriticalIncident(db, incident.id, "ignore");
                if (r.ok) doAutosave();
              }}
              onRestore={(charId) => setRestoreCharId(charId)}
            />
          );
        }
        if (incident.kind === "mental_breakdown") {
          return (
            <ColdPalaceMadnessModal
              db={db}
              state={liveState}
              incident={incident}
              onAcknowledge={() => { if (store.acknowledgeIncident(incident.id)) doAutosave(); }}
              onNavigate={() => { setFreeViewId("changmengong"); setView("freeview"); }}
            />
          );
        }
        return (
          <ColdPalaceIncidentModal
            db={db}
            state={liveState}
            incident={incident}
            onAcknowledge={() => { if (store.acknowledgeIncident(incident.id)) doAutosave(); }}
            onNavigate={() => { setFreeViewId("changmengong"); setView("freeview"); }}
            onRestore={(charId) => setRestoreCharId(charId)}
          />
        );
      })()}
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
          onLoaded={() => { resetRollGuards(); navDispatch({ type: "clear" }); pendingReactionDispatch({ type: "clear" }); setRankAdmin(null); timeSettlementDispatch({ type: "clear" }); invalidateDialogue(); setSettingsOpen(false); enterCurrentLocation(); }}
          onReturnTitle={() => { doAutosave(); invalidateDialogue(); setSettingsOpen(false); setView("title"); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {ceremonyOpen && (() => {
        const hostView = getGreetingHostView(db, store.getState());
        return hostView ? (
          <GreetingCeremonyOverlay
            hostView={hostView}
            onDone={() => {
              setCeremonyOpen(false);
              if (reactionQueue.length > 0) {
                const [first, ...rest] = reactionQueue;
                setReaction(first!);
                setReactionQueue(rest);
              }
            }}
          />
        ) : null;
      })()}
      {morningAfterOpen && morningAfterCharId && (
        <MorningAfterOverlay
          consortName={db.characters[morningAfterCharId]?.profile.name ?? "爱卿"}
          onRest={restExcuse}
          onSilent={silentLeave}
        />
      )}
      <DebugPanel store={store} db={db} logger={logger} recentKnowledge={recentKnowledge} onForceEvent={(id) => startEvent(id, { kind: "map", atRoot: true })} />
    </>
  );
}
