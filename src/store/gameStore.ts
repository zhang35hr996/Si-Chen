/**
 * Engine↔React bridge (DESIGN §2.1: "a 50-line emitter", no state library).
 * Plain TS — React coupling lives only in useGameState.ts.
 */
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import { applyEffects } from "../engine/effects/funnel";
import { TraceCollector, TraceHistory, diffGameState, type DebugTraceMode, type TraceSource, type TraceTransaction } from "../engine/trace";
import { resolveEvent, type EventResolution } from "../engine/events/resolve";
import { stateError, type GameError } from "../engine/infra/errors";
import type { RingBufferLogger } from "../engine/infra/logger";
import { err, ok, type Result } from "../engine/infra/result";
import { formatGameTime, fromTurnIndex, monthOrdinal, toGameTime } from "../engine/calendar/time";
import { activeConfinement, expiredUnrecordedConfinements, nextStatusEffectId } from "../engine/characters/confinement";
import { activeColdPalaceEffectFor, canRestoreFromColdPalace, isInColdPalace } from "../engine/characters/coldPalace";
import { getCharacterLocation } from "../engine/characters/presence";
import { appendCourtEvent } from "../engine/chronicle/append";
import { planImperialCommand, type ImperialCommand, type ImperialCommandPlan } from "./imperialCommands";
import { allocateJusticeIds } from "../engine/justice/ids";
import type { PunishmentRecord, PunishmentId, CaseId } from "../engine/justice/types";
import { planHaremAdminRankCommand, type HaremAdminRankCommand, type HaremAdminCommandPlan } from "./haremAdminCommands";
import { planPunishmentConsequences } from "../engine/punishments/consequencePlanner";
import { buildRankOp, type RankOpRequest } from "./rankOps";
import type { PunishmentOutcomeContext, PunishmentMeta, ReactionBeat } from "../engine/punishments/types";
import { punishmentSeverity, type PunishmentKind } from "../engine/punishments/types";
import type { CourtEvent } from "../engine/state/types";
import type { GameCommand } from "../engine/state/commands";
import { createInitialState, type InitialStateOverrides } from "../engine/state/initialState";
import { createNewGameState } from "../engine/state/newGame";
import { applyBatch, applyCommand, type CommandResult } from "../engine/state/reducer";
import type { GameState, NarrativeEntry, PendingDaxuan, TemplateEventRecord } from "../engine/state/types";
import { NARRATIVE_LOG_MAX } from "../engine/state/types";
import { buildMonthlyHealthTick, type MonthlyTickResult } from "./healthTick";
import { planHealthChange } from "./health";
import { assignOfficialPost } from "../engine/officials/assign";
import { dismissOfficial, restoreOfficialToActive, retireOfficial } from "../engine/officials/lifecycle";
import { buildOfficialYearlyTick } from "./officialsLifecycleTick";
import { EXAM_MONTH, acknowledgeExaminationResult, hasGeneratedExaminationForYear, settleAnnualExamination } from "../engine/officials/examination";
import { REVIEW_MONTH, buildAnnualReview, hasReviewedYear } from "../engine/officials/annualReview";
import { punishOfficial, promoteOfficialAdministratively, type OfficialPunishmentCommand } from "../engine/officials/officialPunishment";
import { resolvePersonnelDecision } from "../engine/officials/personnelDecisionResolve";
import { generateAnnualPersonnelEvents, generateFamilyImplication } from "../engine/officials/personnelDecisions";
import { maybeGenerateAnnualDisaster, maybeGenerateAnnualTreasuryMemorial, maybeGenerateAnnualMilitaryAssessment, resolveMemorial as resolveMemorialEngine } from "../engine/court/memorials";
import { settleQuarterlyTreasury } from "../engine/court/quarterlySettlement";
import { maybeScheduleBirthdayRitual } from "../engine/events/ritualSchedule";
import { applyTreasuryTransaction } from "../engine/court/treasuryLedger";
import type { PersonnelDecisionResolution } from "../engine/state/types";
import { appointOfficialCandidate } from "../engine/officials/appointment";
import { bestow, grantItem, type RecipientKind, type BestowResult } from "./treasury";
import { huntFurs, autumnHuntFlagKey } from "./autumnHunt";
import {
  addGeneratedConsort, daxuanAnnounceBeats, daxuanAnnounceFlagKey, daxuanDianxuanDueForYear,
  daxuanDianxuanFlagKey, initialFavorForRank, isPendingDaxuanResolved, matchesPendingDianxuan,
  nextPendingDaxuan, type KeptConsort,
} from "./grandSelection";
import type { DecreeReaction } from "./empressDecree";
import { excuseFromGreeting, dismissOvernight, recordOvernight } from "./greeting";
import {
  planHaremAdministrationTransfer,
  type TransferHaremAdministrationCommand,
} from "./haremAdminTransfer";
import {
  planHeirCustodyTransfer,
  type HeirCustodyTransferCommand,
  type HeirCustodyTransferPlan,
} from "./heirCustody";
import {
  hasHaremAdminReviewForYear,
  isHaremAdminReviewWindow,
  settleAnnualHaremAdminReview,
} from "./haremAdminAnnualReview";
import { deriveQueueTraceEvents } from "../engine/trace/queueDiff";
import { captureEligibilityTransitions } from "../engine/trace/eligibilityDiff";
import type { QueueTraceEvent } from "../engine/trace/domainEvents";
import { applyJusticePlan, type JusticePlan } from "../engine/justice/mutations";
import { CHAMBERED_PALACE_ORDER, CHAMBERS } from "../engine/characters/chambers";
import type { ChamberId, ColdPalaceCriticalIllnessIncident, ColdPalaceIntervention, ConfinementEffect } from "../engine/state/types";
import {
  planColdPalaceIncidents,
  planColdPalaceCriticalIncident,
  planColdPalaceMadnessBreakdown,
  staleIncidentIds,
  criticalIgnoreDelta,
  PHYSICIAN_RECOVERY_DELTA,
  canInterveneInColdPalace,
  coldPalaceInterventionId,
  COLD_PALACE_INTERVENTION_AP_COST,
  COLD_PALACE_VISIT_FAVOR_DELTA,
  COLD_PALACE_PHYSICIAN_HEALTH_DELTA,
} from "../engine/characters/coldPalaceIncidents";
import { planHaremDiscipline } from "../engine/characters/haremDisciplinePlanner";
import {
  resolveHaremDisciplineOccurrence,
  resolveHaremDiscipline,
  type ResolveHaremDisciplineInput,
} from "../engine/characters/haremDisciplineResolver";
import { settleHaremIntrigue } from "../engine/characters/haremIntrigueSettlement";
import { createIntrigueInvestigationCase, cancelIntrigueInvestigationCase } from "../engine/characters/haremInvestigation/createCase";
import { availableInvestigationActions, validateCanStartTask } from "../engine/characters/haremInvestigation/actions";
import { settleDueInvestigationTasks, nextTaskId } from "../engine/characters/haremInvestigation/settlement";
import { INVESTIGATION_METHOD_AP, INVESTIGATION_METHOD_DAYS } from "../engine/characters/haremInvestigation/types";
import type { InvestigationMethod } from "../engine/characters/haremInvestigation/types";

/** Diagnostics for the debug panel: what the last effect batch did. */
export interface EffectReport {
  effects: readonly EventEffect[];
  outcome: "applied" | "rejected";
  errors: GameError[];
}

/** Result of one atomic time transaction (resolveTimedAction / advanceTime). */
export interface TimedOutcome {
  /** The AP spend rolled the action-day (旬) over. */
  rolledOver: boolean;
  /** The advance crossed into a new month → the health tick ran once. */
  monthChanged: boolean;
  /** The monthly health tick result when monthChanged; null otherwise. */
  healthOutcome: MonthlyTickResult | null;
}

export interface GameStoreOptions {
  logger?: RingBufferLogger;
  initial?: InitialStateOverrides;
  /** Override trace mode. Defaults to "record" in dev builds, "off" in production. */
  traceMode?: DebugTraceMode;
  /** Override trace history capacity. Defaults to 200. */
  traceHistoryLimit?: number;
}

/** 推进日历的命令——必须经统一时间入口（带边界结算），不可裸 dispatch。 */
const isTimeCommand = (c: GameCommand): boolean => c.type === "SPEND_AP" || c.type === "SKIP_REMAINDER";
const rawTimeDispatchError: GameError = stateError(
  "RAW_TIME_DISPATCH",
  "time commands (SPEND_AP/SKIP_REMAINDER) must route through advanceTime/resolveTimedAction/travelAndAdvance",
);

export class GameStore {
  private state: GameState;
  private readonly listeners = new Set<() => void>();
  private readonly logger: RingBufferLogger | undefined;
  private readonly traceMode: DebugTraceMode;
  private readonly traceHistory: TraceHistory;

  constructor(options: GameStoreOptions = {}) {
    this.logger = options.logger;
    this.state = createInitialState(options.initial);
    const defaultMode: DebugTraceMode = typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV ? "record" : "off";
    this.traceMode = options.traceMode ?? defaultMode;
    this.traceHistory = new TraceHistory(options.traceHistoryLimit);
  }

  /** Dev-only: access the trace history ring buffer. Returns an empty history in production. */
  getTraceHistory(): TraceHistory {
    return this.traceHistory;
  }

  /**
   * Build a TraceTransaction from a completed (or rolled back) store operation.
   *
   * In strict mode, throws BEFORE any state commit if untracked mutations are
   * found — callers must validate before writing `this.state = candidate`.
   * In record mode, catches internal errors and logs them silently.
   */
  private buildTrace(
    beforeState: GameState,
    afterState: GameState,
    source: TraceSource,
    collector: TraceCollector,
    outcome: "committed" | "rolled_back",
    error?: string,
  ): TraceTransaction {
    const collectedMutations = [...collector.getMutations()];
    const warnings = [...collector.getWarnings()];

    // Final boundary diff: catches any mutation not already captured by the
    // collector (funnel instrumentation or phase-local capturePhaseScheduled).
    const diff = diffGameState(beforeState, afterState);
    const trackedPaths = new Set(collectedMutations.map((m) => m.path));
    const allMutations: typeof collectedMutations = [...collectedMutations];
    for (const d of diff) {
      if (!trackedPaths.has(d.path)) {
        allMutations.push({
          path: d.path,
          before: d.before,
          after: d.after,
          delta:
            typeof d.before === "number" && typeof d.after === "number"
              ? d.after - d.before
              : undefined,
          classification: "untracked",
          phase: "effects",
        });
      }
    }

    // strict: reject committed operations with genuinely unattributed mutations
    // (classification "untracked" = no phase, no funnel record).
    const untracked = allMutations.filter((m) => m.classification === "untracked");
    if (this.traceMode === "strict" && outcome === "committed" && untracked.length > 0) {
      throw new Error(
        `[strict] Untracked state mutations: ${untracked.map((m) => m.path).join(", ")}`,
      );
    }

    const directCount = allMutations.filter(
      (m) => m.classification === "direct" || m.classification === "derived",
    ).length;

    // Merge explicit domain events with auto-derived queue events.
    // Explicit collector events take precedence; auto-derived fills in the rest.
    const collectedDomainEvents = [...collector.getDomainEvents()];
    const derivedQueue = deriveQueueTraceEvents(beforeState, afterState);
    const explicitQueueKeys = new Set(
      collectedDomainEvents
        .filter((e): e is QueueTraceEvent => e.kind === "queue")
        .map((e) => `${e.queue}:${e.itemId}`),
    );
    for (const e of derivedQueue) {
      if (!explicitQueueKeys.has(`${e.queue}:${e.itemId}`)) {
        collectedDomainEvents.push(e);
      }
    }

    return {
      id: this.traceHistory.nextId(),
      timestamp: Date.now(),
      source,
      mutations: allMutations,
      warnings,
      outcome,
      error,
      gameTime: formatGameTime(afterState.calendar),
      directCount,
      untrackedCount: untracked.length,
      domainEvents: collectedDomainEvents,
    };
  }

  /** Create a TraceCollector if tracing is active, otherwise undefined. */
  private makeCollector(): TraceCollector | undefined {
    return this.traceMode !== "off" ? new TraceCollector() : undefined;
  }

  /**
   * Wrap a simple direct-state-set with boundary-diff tracing.
   * All mutations are labeled "scheduled" since no funnel is involved.
   * Used for store methods that bypass the effect funnel (setFlag, setEraName, etc.).
   */
  private tracedSet(nextState: GameState, source: TraceSource, extraDomainEvents?: readonly import("../engine/trace/domainEvents").TraceDomainEvent[]): void {
    if (this.traceMode !== "off") {
      const collector = new TraceCollector();
      if (extraDomainEvents) for (const e of extraDomainEvents) collector.recordDomainEvent(e);
      const beforeState = this.state;
      collector.capturePhaseScheduled("direct_mutation", diffGameState(beforeState, nextState));
      const tx = this.buildTrace(beforeState, nextState, source, collector, "committed");
      this.state = nextState;
      this.traceHistory.push(tx);
    } else {
      this.state = nextState;
    }
    this.emit();
  }

  getState = (): GameState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(command: GameCommand): CommandResult {
    if (isTimeCommand(command)) {
      this.logger?.logGameError(rawTimeDispatchError); // 拒绝绝不静默
      return err(rawTimeDispatchError);
    }
    if (this.traceMode === "off") return this.commit(applyCommand(this.state, command));
    const beforeState = this.state;
    const result = applyCommand(this.state, command);
    const source: TraceSource = { kind: "action", sourceId: command.type, label: `dispatch: ${command.type}` };
    const collector = new TraceCollector();
    const nextState = result.ok ? result.value.state : beforeState;
    collector.capturePhaseScheduled("command_dispatch", diffGameState(beforeState, nextState));
    if (!result.ok) collector.fail("command_dispatch", result.error);
    const tx = this.buildTrace(beforeState, nextState, source, collector,
      result.ok ? "committed" : "rolled_back",
      result.ok ? undefined : result.error.message);
    if (result.ok) { this.state = nextState; this.emit(); }
    else { this.logger?.logGameError(result.error); }
    this.traceHistory.push(tx);
    return result;
  }

  dispatchBatch(commands: readonly GameCommand[]): CommandResult {
    // 时间命令必须走统一入口（advanceTime/resolveTimedAction/travelAndAdvance）以保证边界结算；
    // 裸 dispatch 会绕过 settleCalendarAdvance，一律拒绝。
    if (commands.some(isTimeCommand)) {
      this.logger?.logGameError(rawTimeDispatchError);
      return err(rawTimeDispatchError);
    }
    if (this.traceMode === "off") return this.commit(applyBatch(this.state, commands));
    const beforeState = this.state;
    const result = applyBatch(this.state, commands);
    const source: TraceSource = { kind: "action", label: `dispatchBatch (${commands.length})` };
    const collector = new TraceCollector();
    const nextState = result.ok ? result.value.state : beforeState;
    collector.capturePhaseScheduled("command_dispatch", diffGameState(beforeState, nextState));
    if (!result.ok) collector.fail("command_batch_dispatch", result.error);
    const tx = this.buildTrace(beforeState, nextState, source, collector,
      result.ok ? "committed" : "rolled_back",
      result.ok ? undefined : result.error.message);
    if (result.ok) { this.state = nextState; this.emit(); }
    else { this.logger?.logGameError(result.error); }
    this.traceHistory.push(tx);
    return result;
  }

  reset(overrides: InitialStateOverrides = {}): void {
    this.state = createInitialState(overrides);
    this.traceHistory.clear();
    this.emit();
  }

  /** Start a fresh playthrough from validated content (skeleton-plan §5). */
  newGame(db: ContentDB): void {
    this.state = createNewGameState(db);
    this.lastEffectReport = null;
    this.traceHistory.clear();
    this.emit();
  }

  /** Replace state with a save-system-validated GameState (load/import). */
  loadState(state: GameState): void {
    this.state = state;
    this.lastEffectReport = null;
    this.traceHistory.clear();
    this.emit();
  }

  /** 登基设定年号（写入 calendar.eraName）。 */
  setEraName(name: string): void {
    this.tracedSet(
      { ...this.state, calendar: { ...this.state.calendar, eraName: name } },
      { kind: "action", sourceId: "setEraName", label: "setEraName" },
    );
  }

  /**
   * 安全任免官职（→品级→权势派生跟随）。经 assignOfficialPost 校验席位/存在/状态，
   * 仅在 ok 时落库；返回 Result 供调用方处理错误（v1 无 UI 调用方，仅留接口）。
   */
  assignOfficialPost(db: ContentDB, officialId: string, newPostId: string | null): Result<void, GameError> {
    const result = assignOfficialPost(this.state, db, officialId, newPostId, toGameTime(this.state.calendar));
    if (!result.ok) return result;
    this.tracedSet(result.value, { kind: "action", sourceId: "assignOfficialPost", label: `assignOfficialPost: ${officialId}` });
    return ok(undefined);
  }

  /** 准其告老：消费一条未决告老请求 → retireOfficial（状态 retired、释放席位、写历史）。 */
  approveRetirement(officialId: string): Result<void, GameError> {
    if (!this.state.pendingRetirements.some((p) => p.officialId === officialId)) {
      return err(stateError("NO_PENDING_RETIREMENT", `官员「${officialId}」无未决告老请求`, { context: { officialId } }));
    }
    const result = retireOfficial(this.state, officialId, toGameTime(this.state.calendar));
    if (!result.ok) return result;
    this.tracedSet(result.value, { kind: "action", sourceId: "approveRetirement", label: `approveRetirement: ${officialId}` }, [
      { kind: "queue", queue: "pendingRetirements", operation: "resolved", itemId: officialId, resolution: "approved", reason: "approved", phase: "direct_mutation" },
    ]);
    return ok(undefined);
  }

  /** 挽留一年：撤回该未决告老请求（来年可再请）。官员保持在任。 */
  retainRetirement(officialId: string): Result<void, GameError> {
    if (!this.state.pendingRetirements.some((p) => p.officialId === officialId)) {
      return err(stateError("NO_PENDING_RETIREMENT", `官员「${officialId}」无未决告老请求`, { context: { officialId } }));
    }
    const next = { ...this.state, pendingRetirements: this.state.pendingRetirements.filter((p) => p.officialId !== officialId) };
    this.tracedSet(next, { kind: "action", sourceId: "retainRetirement", label: `retainRetirement: ${officialId}` }, [
      { kind: "queue", queue: "pendingRetirements", operation: "resolved", itemId: officialId, resolution: "retained", reason: "retained_by_sovereign", phase: "direct_mutation" },
    ]);
    return ok(undefined);
  }

  /** 罢免：在任且有职官员去职（保留为可再任用）；写历史。 */
  dismissOfficial(officialId: string): Result<void, GameError> {
    const result = dismissOfficial(this.state, officialId, toGameTime(this.state.calendar));
    if (!result.ok) return result;
    this.state = result.value;
    this.emit();
    return ok(undefined);
  }

  /** 恢复为可任用：retired/imprisoned/exiled → active（postId 仍 null，须再 assignOfficialPost）。 */
  restoreOfficial(officialId: string): Result<void, GameError> {
    const result = restoreOfficialToActive(this.state, officialId, toGameTime(this.state.calendar));
    if (!result.ok) return result;
    this.state = result.value;
    this.emit();
    return ok(undefined);
  }

  /** 候补授官转正（PR3B）：eligible 候补 → active 正式官员占空缺官职；写历史。行政行为，非惩罚。 */
  appointOfficialCandidate(db: ContentDB, candidateId: string, postId: string): Result<void, GameError> {
    const result = appointOfficialCandidate(this.state, db, candidateId, postId, toGameTime(this.state.calendar));
    if (!result.ok) return result;
    this.tracedSet(result.value, { kind: "action", sourceId: "appointOfficialCandidate", label: `appoint candidate: ${candidateId}→${postId}` });
    return ok(undefined);
  }

  /** 皇帝亲发官员惩戒（降职/免官）：进 PUNISH 记录 + 独立后果 + 自动补缺（PR3C-3a）。 */
  punishOfficial(db: ContentDB, command: OfficialPunishmentCommand): Result<{ punishmentId: string }, GameError> {
    const r = punishOfficial(this.state, db, command, toGameTime(this.state.calendar));
    if (!r.ok) return r;
    this.state = r.value.state;
    this.emit();
    return ok({ punishmentId: r.value.punishmentId });
  }

  /** 行政升迁（不算惩罚，不创建 PunishmentRecord；PR3C-3a）。 */
  promoteOfficialAdministratively(db: ContentDB, officialId: string, toPostId: string): Result<void, GameError> {
    const r = promoteOfficialAdministratively(this.state, db, officialId, toPostId, toGameTime(this.state.calendar));
    if (!r.ok) return r;
    this.state = r.value;
    this.emit();
    return ok(undefined);
  }

  /**
   * 原子裁断一条人事决策（侍君请提拔亲族 / 获罪牵连 / 紫宸殿人事奏折；PR3C-3b）。升迁经行政 API，
   * 降职/免官经 PUNISH。失败 state 不变、不 emit；成功一次 emit，返回可选 punishmentId（降/免才有）。
   */
  resolvePersonnelDecision(db: ContentDB, decisionId: string, resolution: PersonnelDecisionResolution): Result<{ punishmentId?: string }, GameError> {
    const r = resolvePersonnelDecision(this.state, db, decisionId, resolution, toGameTime(this.state.calendar));
    if (!r.ok) return r;
    this.state = r.value.state;
    this.emit();
    return ok(r.value.punishmentId ? { punishmentId: r.value.punishmentId } : {});
  }

  /**
   * 原子批阅一条奏折（Phase 4A）：经正式 effect funnel 施加选项后果。失败 state 不变、不 emit；成功一次 emit。
   */
  resolveMemorial(db: ContentDB, memorialId: string, optionId: string): Result<void, GameError> {
    const r = resolveMemorialEngine(this.state, db, memorialId, optionId, toGameTime(this.state.calendar));
    if (!r.ok) return r;
    this.state = r.value.state;
    this.emit();
    return ok(undefined);
  }

  /**
   * 侍君获罪后即时生成「获罪牵连家族」待裁决策（PR3C-3b 生产 seam）。生成器内部已门控严重度
   * （severe/terminal）、母族在任官员、同源去重，故对不合格惩罚为纯 no-op（返回原 state）。作为
   * commitPlannedTransaction 的 postCommit 变换折进同一次提交与 emit（不额外 emit）。
   */
  private withFamilyImplication(db: ContentDB, punishmentId: string): (state: GameState) => GameState {
    return (state) => generateFamilyImplication(state, db, punishmentId, toGameTime(state.calendar))?.state ?? state;
  }

  /** 标记某年度科举榜单为已查看（PR3B）。幂等。 */
  acknowledgeExaminationResult(year: number): Result<void, GameError> {
    this.tracedSet(acknowledgeExaminationResult(this.state, year), { kind: "action", sourceId: "acknowledgeExaminationResult", label: `ack exam: ${year}` });
    return ok(undefined);
  }

  /** 赏赐：扣库存并提升目标恩宠/好感（不耗行动点）。 */
  applyBestow(db: ContentDB, itemId: string, recipient: { kind: RecipientKind; id: string }): BestowResult {
    const result = bestow(this.state, db, itemId, recipient);
    if (result.ok) {
      this.tracedSet(result.state, { kind: "action", sourceId: "applyBestow", label: `bestow: ${itemId}` });
    }
    return result;
  }

  /** 直接入库指定物品。 */
  applyGrantItem(itemId: string, count = 1): void {
    this.tracedSet(grantItem(this.state, itemId, count),
      { kind: "action", sourceId: "applyGrantItem", label: `grantItem: ${itemId}` });
  }

  /** 扣钱后入库；钱不足返回 false，state 不变。购买记入国库台账（shop_purchase 条目）。 */
  buyItem(itemId: string, price: number): boolean {
    if (!Number.isSafeInteger(price) || price <= 0) return false;
    const txResult = applyTreasuryTransaction(this.state, {
      delta: -price,
      at: toGameTime(this.state.calendar),
      source: { kind: "shop_purchase", itemId },
      reason: `购入${itemId}`,
    });
    if (!txResult.ok) return false;
    this.tracedSet(grantItem(txResult.value.state, itemId, 1),
      { kind: "action", sourceId: "buyItem", label: `buyItem: ${itemId}` });
    return true;
  }

  /** 按当前武力掷皮毛入库 + 设年度 flag；返回所得物品 id 列表。 */
  applyAutumnHunt(seedKey: string): string[] {
    const furs = huntFurs(this.state.resources.sovereign.martial, seedKey);
    let next = this.state;
    for (const id of furs) next = grantItem(next, id, 1);
    next = { ...next, flags: { ...next.flags, [autumnHuntFlagKey(next.calendar.year)]: true } };
    this.tracedSet(next, { kind: "action", sourceId: "applyAutumnHunt", label: "autumnHunt" });
    return furs;
  }

  /** 拒绝秋猎，仅设年度 flag。 */
  declineAutumnHunt(): void {
    const year = this.state.calendar.year;
    this.tracedSet(
      { ...this.state, flags: { ...this.state.flags, [autumnHuntFlagKey(year)]: true } },
      { kind: "action", sourceId: "declineAutumnHunt", label: "declineAutumnHunt" },
    );
  }

  /** 设/清一个布尔 flag（大选一次性标记）。 */
  setFlag(key: string, value: boolean): void {
    this.tracedSet(
      { ...this.state, flags: { ...this.state.flags, [key]: value } },
      { kind: "action", sourceId: `setFlag:${key}`, label: `setFlag: ${key}` },
    );
  }

  /**
   * 消费「二月大选报告」待消费态，按 pending.year（年份权威，不取当前日历年——跨年存档稳定）：
   *  - 该年 announce flag 已置 → 陈旧 pending，调和清除并返回 []（不重播）；
   *  - 否则原子落该年 announce flag，并链接：同年殿选已到点未决则续 dianxuan（跳过整个二—四月时
   *    立即挂上），否则清空。返回播报节拍。非 announce 待消费时返回 []。
   */
  consumeDaxuanAnnounce(_db: ContentDB): DecreeReaction[] {
    const pd = this.state.pendingDaxuan;
    if (pd?.kind !== "announce") return [];
    const pdId = `${pd.kind}:${pd.year}`;
    if (this.state.flags[daxuanAnnounceFlagKey(pd.year)]) {
      this.tracedSet({ ...this.state, pendingDaxuan: undefined },
        { kind: "system", sourceId: "consumeDaxuanAnnounce:stale", label: "consumeDaxuanAnnounce (stale reconcile)" },
        [{ kind: "queue", queue: "pendingDaxuan", operation: "cancelled", itemId: pdId, itemType: pd.kind, reason: "stale_reconcile", phase: "direct_mutation" }]);
      return [];
    }
    const flags = { ...this.state.flags, [daxuanAnnounceFlagKey(pd.year)]: true };
    const chained: PendingDaxuan | undefined = daxuanDianxuanDueForYear({ ...this.state, flags }, pd.year)
      ? { kind: "dianxuan", year: pd.year }
      : undefined;
    if (chained) {
      const chainedId = `${chained.kind}:${chained.year}`;
      this.tracedSet({ ...this.state, flags, pendingDaxuan: chained },
        { kind: "system", sourceId: "consumeDaxuanAnnounce", label: `consumeDaxuanAnnounce: year ${pd.year}` },
        [
          { kind: "queue", queue: "pendingDaxuan", operation: "replaced", itemId: pdId, itemType: pd.kind, reason: "chained_to_dianxuan", phase: "direct_mutation" },
          { kind: "queue", queue: "pendingDaxuan", operation: "enqueued", itemId: chainedId, itemType: chained.kind, phase: "direct_mutation" },
        ]);
    } else {
      this.tracedSet({ ...this.state, flags, pendingDaxuan: undefined },
        { kind: "system", sourceId: "consumeDaxuanAnnounce", label: `consumeDaxuanAnnounce: year ${pd.year}` },
        [{ kind: "queue", queue: "pendingDaxuan", operation: "resolved", itemId: pdId, itemType: pd.kind, reason: "announce_consumed", phase: "direct_mutation" }]);
    }
    return daxuanAnnounceBeats();
  }

  /**
   * 原子解决殿选 pending（enter 扣点成功后 / delegate 直接调用）。完整性不变量：仅当确有
   * 「该 year、未决」的 dianxuan 待消费事件时才置该年 flag + 清 pending + emit，返回 true；
   * 否则（无 pending / announce pending / 错年 / 已决）**不改 state、不 emit**，返回 false。
   * 据此拒绝陈旧/重复/错年点击，杜绝委托业务二次执行。
   */
  resolveDaxuanDianxuan(year: number): boolean {
    if (!matchesPendingDianxuan(this.state, year)) return false; // 无/announce/错年/已决(陈旧) → 不动、不 emit
    const pd = this.state.pendingDaxuan!;
    const pdId = `${pd.kind}:${pd.year}`;
    this.tracedSet(
      { ...this.state, flags: { ...this.state.flags, [daxuanDianxuanFlagKey(year)]: true }, pendingDaxuan: undefined },
      { kind: "system", sourceId: "resolveDaxuanDianxuan", label: `resolveDaxuanDianxuan: year ${year}` },
      [{ kind: "queue", queue: "pendingDaxuan", operation: "resolved", itemId: pdId, itemType: pd.kind, reason: "dianxuan_entered", phase: "direct_mutation" }],
    );
    return true;
  }

  /**
   * 殿选「前往」事务。先校验完整性不变量（确有该年未决 dianxuan pending）——不满足（陈旧/
   * 重复/错年）则返回 NO_PENDING_DAXUAN 错误且**不扣点、state 不变**，杜绝重复扣点。满足则
   * 扣 1AP（失败如行动点不足亦原子不变）；扣点成功后解决同一 pending（同步、经 advanceCandidate
   * sticky 保留，必成功；万一消失视为不变量破坏返回错误，绝不静默进殿选）。返回扣点结果。
   */
  enterDaxuan(db: ContentDB, year: number): Result<TimedOutcome, GameError[]> {
    if (!matchesPendingDianxuan(this.state, year)) {
      return err([stateError("NO_PENDING_DAXUAN", `no unresolved dianxuan pending for year ${year}`)]);
    }
    const spend = this.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    if (!spend.ok) return spend;
    if (!this.resolveDaxuanDianxuan(year)) {
      return err([stateError("DAXUAN_RESOLVE_FAILED", `dianxuan pending for year ${year} vanished after AP spend`)]);
    }
    return spend;
  }

  /** 清除待消费的大选事件（陈旧 dianxuan pending 调和用）。 */
  clearPendingDaxuan(): void {
    if (this.state.pendingDaxuan === undefined) return;
    const pd = this.state.pendingDaxuan;
    const pdId = `${pd.kind}:${pd.year}`;
    this.tracedSet({ ...this.state, pendingDaxuan: undefined },
      { kind: "system", sourceId: "clearPendingDaxuan", label: "clearPendingDaxuan" },
      [{ kind: "queue", queue: "pendingDaxuan", operation: "cancelled", itemId: pdId, itemType: pd.kind, reason: "stale_reconcile", phase: "direct_mutation" }]);
  }

  /** 施恩免请安（不耗行动点）。 */
  applyExcuseGreeting(db: ContentDB, charId: string): void {
    this.tracedSet(excuseFromGreeting(this.state, db, charId),
      { kind: "action", sourceId: "applyExcuseGreeting", label: `excuseGreeting: ${charId}` });
  }

  /** 「不说」：清留宿，侍君照常请安。 */
  dismissOvernight(): void {
    this.tracedSet(dismissOvernight(this.state),
      { kind: "action", sourceId: "dismissOvernight", label: "dismissOvernight" });
  }

  /** 子时侍寝/对话滚旬后记留宿（条件不满足则无副作用）。 */
  recordOvernight(db: ContentDB, charId: string, rolledOver: boolean): void {
    const next = recordOvernight(this.state, db, charId, rolledOver);
    if (next !== this.state) {
      this.tracedSet(next, { kind: "action", sourceId: "recordOvernight", label: `recordOvernight: ${charId}` });
    }
  }

  /** 追加对话历史日志条目（不经效果漏斗；append-only，超出上限时从头删除）。 */
  appendNarrativeLog(entries: NarrativeEntry[]): void {
    if (entries.length === 0) return;
    const current = this.state.narrativeLog ?? [];
    const merged = [...current, ...entries];
    const trimmed = merged.length > NARRATIVE_LOG_MAX ? merged.slice(merged.length - NARRATIVE_LOG_MAX) : merged;
    this.state = { ...this.state, narrativeLog: trimmed };
    // 不触发 tracedSet（避免污染 undo 历史）；autosave 会在下一次正式操作时持久化。
  }

  /** 在局部候选 state 上依次落库一批秀男；任一失败即整批回退（返回 err，调用方不得 emit）。 */
  private applyConsortBatch(db: ContentDB, kept: KeptConsort[]): Result<GameState, GameError> {
    let next = this.state;
    for (const k of kept) {
      const favor = initialFavorForRank(db.ranks[k.rank]?.order ?? 50);
      const result = addGeneratedConsort(next, db, k.candidate.content, k.rank, favor, k.candidate.motherOfficialId);
      if (!result.ok) return result;
      next = result.value;
    }
    return ok(next);
  }

  /**
   * 殿选落库（玩家手动留牌 + 早退场 NPC 留牌合并为一批）：原子全成或全不成。
   * 任一冲突 → state 不变、不 emit，调用方据 err 保留界面并提示重试。
   */
  commitDaxuanSelections(db: ContentDB, kept: KeptConsort[]): Result<void, GameError> {
    const batch = this.applyConsortBatch(db, kept);
    if (!batch.ok) return batch;
    this.tracedSet(batch.value, { kind: "system", sourceId: "commitDaxuanSelections", label: `commitDaxuanSelections (${kept.length})` });
    return ok(undefined);
  }

  /**
   * 委托太后皇后：在同一候选 state 上原子完成 [校验该年未决 pending → NPC 留牌落库 →
   * 置 dianxuan resolved flag → 清 pending]，全成功一次性替换并 emit；任一步失败则
   * state/flag/pending 均不变。
   */
  resolveDaxuanByDelegate(db: ContentDB, year: number, kept: KeptConsort[]): Result<void, GameError> {
    if (!matchesPendingDianxuan(this.state, year)) {
      return err(stateError("NO_PENDING_DAXUAN", `no unresolved dianxuan pending for year ${year}`, { context: { year } }));
    }
    const pd = this.state.pendingDaxuan!;
    const pdId = `${pd.kind}:${pd.year}`;
    const batch = this.applyConsortBatch(db, kept);
    if (!batch.ok) return batch;
    this.tracedSet(
      { ...batch.value, flags: { ...batch.value.flags, [daxuanDianxuanFlagKey(year)]: true }, pendingDaxuan: undefined },
      { kind: "system", sourceId: "resolveDaxuanByDelegate", label: `resolveDaxuanByDelegate: year ${year}` },
      [{ kind: "queue", queue: "pendingDaxuan", operation: "resolved", itemId: pdId, itemType: pd.kind, reason: "delegated_selection_completed", phase: "direct_mutation" }],
    );
    return ok(undefined);
  }

  /** 先入库 1 件再赏赐；bestow 失败返回 false，state 不变。 */
  giftTribute(db: ContentDB, itemId: string, recipient: { kind: RecipientKind; id: string }): boolean {
    const granted = grantItem(this.state, itemId, 1);
    const result = bestow(granted, db, itemId, recipient);
    if (!result.ok) return false;
    this.tracedSet(result.state, { kind: "action", sourceId: "giftTribute", label: `giftTribute: ${itemId}` });
    return true;
  }

  /**
   * THE single entry point for gameplay-state changes (skeleton-plan §6):
   * relationships, favor, resources, memory, and flags change only here,
   * through the effect funnel. Atomic: rejection leaves the state reference
   * untouched, notifies no one, and logs every collected error once.
   */
  applyEffects(db: ContentDB, effects: readonly EventEffect[]): Result<GameState, GameError[]> {
    const collector = this.makeCollector();
    const beforeState = this.state;
    const source: TraceSource = { kind: "action", label: "applyEffects" };
    const result = applyEffects(db, this.state, effects, collector ? { collector } : {});
    if (result.ok) {
      const candidateState = result.value;
      if (collector) {
        captureEligibilityTransitions(db, beforeState, candidateState, collector);
        // Build trace BEFORE committing state — strict mode may throw here.
        const tx = this.buildTrace(beforeState, candidateState, source, collector, "committed");
        this.state = candidateState;
        this.traceHistory.push(tx);
      } else {
        this.state = candidateState;
      }
      this.lastEffectReport = { effects, outcome: "applied", errors: [] };
      this.emit();
    } else {
      for (const error of result.error) this.logger?.logGameError(error);
      this.lastEffectReport = { effects, outcome: "rejected", errors: result.error };
      if (collector) {
        collector.fail("effects", result.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          result.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
    }
    return result;
  }

  getLastEffectReport(): EffectReport | null {
    return this.lastEffectReport;
  }

  /**
   * 皇帝指令（禁足/解除禁足/赐死）的唯一执行入口（任务 §10）。原子地：
   * 校验 → 漏斗应用效果 → append 编年史 → 单次提交。任一步失败 state 不变。
   * 紫宸殿与侍君宫殿两个 UI 入口都只调用这里。
   */
  applyImperialCommand(
    db: ContentDB,
    command: ImperialCommand,
  ): Result<ImperialCommandPlan, GameError[]> {
    // Route punitive commands through the formal record-creation path.
    if (command.type === "impose_confinement" || command.type === "execute") {
      const r = this.applyImperialPunishmentWithConsequences(db, command, {});
      if (!r.ok) return r;
      return ok({ command, charId: command.targetId, effects: [], chronicle: [], lines: r.value.baseLines });
    }

    const collector = this.makeCollector();
    const beforeState = this.state;
    const source: TraceSource = { kind: "imperial_command", sourceId: command.type, label: `imperial: ${command.type}` };
    const planned = planImperialCommand(db, this.state, command);
    if (!planned.ok) {
      const error = stateError("IMPERIAL_COMMAND_REJECTED", planned.reason);
      this.logger?.logGameError(error);
      if (collector) {
        collector.fail("planning_rejected", planned.reason);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back", planned.reason);
        this.traceHistory.push(tx);
      }
      return err([error]);
    }
    const plan = planned.plan;
    const applied = applyEffects(db, this.state, plan.effects, collector ? { collector } : {});
    if (!applied.ok) {
      for (const e of applied.error) this.logger?.logGameError(e);
      this.lastEffectReport = { effects: plan.effects, outcome: "rejected", errors: applied.error };
      if (collector) {
        collector.fail("effects", applied.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          applied.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return err(applied.error);
    }
    let candidate = applied.value;

    // lift_confinement: if the active confinement has a sourcePunishmentId, resolve its PunishmentRecord.
    if (command.type === "lift_confinement") {
      const active = this.state.statusEffects.find(
        (e): e is ConfinementEffect =>
          e.kind === "confinement" && e.characterId === command.targetId && e.liftedTurn === undefined,
      );
      if (active?.sourcePunishmentId) {
        const now = toGameTime(this.state.calendar);
        const alloc = allocateJusticeIds(this.state.justice, {});
        const liftPlan: JusticePlan = {
          mutations: [{
            type: "resolve_punishment",
            punishmentId: active.sourcePunishmentId,
            lifecycle: { status: "lifted", resolvedAt: now, resolution: "lifted_by_decree" },
          }],
          nextSeq: alloc.nextSeq,
        };
        const justiceResult = applyJusticePlan(candidate, liftPlan);
        if (!justiceResult.ok) {
          for (const e of justiceResult.error) this.logger?.logGameError(e);
          if (collector) {
            const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
              justiceResult.error.map((e) => e.message).join("; "));
            this.traceHistory.push(tx);
          }
          return err(justiceResult.error);
        }
        candidate = justiceResult.value;
      }
    }

    // lift_confinement: inject sourcePunishmentId into chronicle links if available.
    const liftSourcePunishmentId = command.type === "lift_confinement"
      ? this.state.statusEffects.find(
          (e): e is ConfinementEffect =>
            e.kind === "confinement" && e.characterId === command.targetId && e.liftedTurn === undefined,
        )?.sourcePunishmentId
      : undefined;
    const adjustedChronicle = liftSourcePunishmentId
      ? plan.chronicle.map((draft) => ({
          ...draft,
          links: { ...draft.links, sourcePunishmentId: liftSourcePunishmentId },
        }))
      : plan.chronicle;

    const beforeChronicle = candidate;
    for (const draft of adjustedChronicle) {
      const ap = appendCourtEvent(candidate, draft);
      if (!ap.ok) {
        for (const e of ap.error) this.logger?.logGameError(e);
        if (collector) {
          collector.fail("chronicle_append", ap.error);
          const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
            ap.error.map((e) => e.message).join("; "));
          this.traceHistory.push(tx);
        }
        return err(ap.error); // this.state untouched — atomic
      }
      candidate = ap.value.state;
    }
    collector?.capturePhaseScheduled("chronicle_append", diffGameState(beforeChronicle, candidate));
    if (collector) {
      captureEligibilityTransitions(db, beforeState, candidate, collector);
      // Build trace BEFORE committing state — strict mode may throw here.
      const tx = this.buildTrace(beforeState, candidate, source, collector, "committed");
      this.state = candidate;
      this.traceHistory.push(tx);
    } else {
      this.state = candidate;
    }
    this.lastEffectReport = { effects: plan.effects, outcome: "applied", errors: [] };
    this.emit();
    return ok(plan);
  }

  /**
   * 六宫行政位分处分命令的唯一执行入口。原子地：
   * 校验 → 漏斗应用效果 → append 编年史 → 单次提交。任一步失败 state 不变。
   */
  applyHaremAdminRankCommand(
    db: ContentDB,
    command: HaremAdminRankCommand,
  ): Result<HaremAdminCommandPlan, GameError[]> {
    const collector = this.makeCollector();
    const beforeState = this.state;
    const source: TraceSource = { kind: "harem_admin", sourceId: command.type, label: `harem admin: ${command.type}` };
    const planned = planHaremAdminRankCommand(db, this.state, command);
    if (!planned.ok) {
      const error = stateError("HAREM_ADMIN_RANK_REJECTED", planned.reason);
      this.logger?.logGameError(error);
      if (collector) {
        collector.fail("planning_rejected", planned.reason);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back", planned.reason);
        this.traceHistory.push(tx);
      }
      return err([error]);
    }
    const plan = planned.plan;
    const applied = applyEffects(db, this.state, plan.effects, collector ? { collector } : {});
    if (!applied.ok) {
      for (const e of applied.error) this.logger?.logGameError(e);
      this.lastEffectReport = { effects: plan.effects, outcome: "rejected", errors: applied.error };
      if (collector) {
        collector.fail("effects", applied.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          applied.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return err(applied.error);
    }
    let candidate = applied.value;
    const beforeChronicle2 = candidate;
    for (const draft of plan.chronicle) {
      const ap = appendCourtEvent(candidate, draft);
      if (!ap.ok) {
        for (const e of ap.error) this.logger?.logGameError(e);
        if (collector) {
          collector.fail("chronicle_append", ap.error);
          const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
            ap.error.map((e) => e.message).join("; "));
          this.traceHistory.push(tx);
        }
        return err(ap.error); // this.state untouched — atomic
      }
      candidate = ap.value.state;
    }
    collector?.capturePhaseScheduled("chronicle_append", diffGameState(beforeChronicle2, candidate));
    if (collector) {
      captureEligibilityTransitions(db, beforeState, candidate, collector);
      const tx = this.buildTrace(beforeState, candidate, source, collector, "committed");
      this.state = candidate;
      this.traceHistory.push(tx);
    } else {
      this.state = candidate;
    }
    this.lastEffectReport = { effects: plan.effects, outcome: "applied", errors: [] };
    this.emit();
    return ok(plan);
  }

  /**
   * Internal atomic helper shared by the two punitive entry points below.
   * Applies effects → chronicle → single emit.  Returns the final plan + beats.
   * On any failure the state is left unchanged.
   */
  private commitPlannedTransaction(
    db: ContentDB,
    effects: readonly EventEffect[],
    chronicle: Omit<CourtEvent, "id">[],
    reactionBeats: ReactionBeat[],
    source: TraceSource,
    justicePlan?: JusticePlan,
    postEffectsEntries?: (state: GameState) => Omit<CourtEvent, "id">[],
    postCommit?: (state: GameState) => GameState,
  ): Result<{ reactionBeats: ReactionBeat[] }, GameError[]> {
    const collector = this.makeCollector();
    const beforeState = this.state;
    const applied = applyEffects(db, this.state, effects, { ...(collector ? { collector } : {}), allowInternalEffects: true });
    if (!applied.ok) {
      for (const e of applied.error) this.logger?.logGameError(e);
      this.lastEffectReport = { effects: [...effects], outcome: "rejected", errors: applied.error };
      if (collector) {
        collector.fail("effects", applied.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          applied.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return err(applied.error);
    }
    let candidate = applied.value;

    // Apply justice plan before chronicle (chronicle entries may reference new IDs).
    if (justicePlan) {
      const beforeJustice = candidate;
      const justiceResult = applyJusticePlan(candidate, justicePlan);
      if (!justiceResult.ok) {
        for (const e of justiceResult.error) this.logger?.logGameError(e);
        if (collector) {
          const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
            justiceResult.error.map((e) => e.message).join("; "));
          this.traceHistory.push(tx);
        }
        return err(justiceResult.error);
      }
      candidate = justiceResult.value;
      collector?.capturePhaseScheduled("justice_plan", diffGameState(beforeJustice, candidate));
    }

    // Collect post-effects chronicle entries (e.g., harem administration change audit).
    const extraEntries: Omit<CourtEvent, "id">[] = postEffectsEntries ? postEffectsEntries(candidate) : [];
    const allChronicleEntries = [...chronicle, ...extraEntries];

    const beforeChronicle = candidate;
    for (const draft of allChronicleEntries) {
      const ap = appendCourtEvent(candidate, draft);
      if (!ap.ok) {
        for (const e of ap.error) this.logger?.logGameError(e);
        if (collector) {
          collector.fail("chronicle_append", ap.error);
          const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
            ap.error.map((e) => e.message).join("; "));
          this.traceHistory.push(tx);
        }
        return err(ap.error); // this.state untouched — atomic
      }
      candidate = ap.value.state;
    }
    collector?.capturePhaseScheduled("chronicle_append", diffGameState(beforeChronicle, candidate));
    // 提交前的最终附加变换（纯附加；如侍君获罪即时生成牵连家族待裁决策）。折进同一次提交与 emit。
    if (postCommit) candidate = postCommit(candidate);
    if (collector) {
      captureEligibilityTransitions(db, beforeState, candidate, collector);
      const tx = this.buildTrace(beforeState, candidate, source, collector, "committed");
      this.state = candidate;
      this.traceHistory.push(tx);
    } else {
      this.state = candidate;
    }
    this.lastEffectReport = { effects: [...effects], outcome: "applied", errors: [] };
    this.emit();
    return ok({ reactionBeats });
  }

  /**
   * Punitive imperial command (confinement / execution) WITH consequence effects.
   * Both base command effects and consequence effects are committed atomically.
   *
   * punishmentId is generated internally from (dayIndex:chronicle.length) to
   * guarantee per-event uniqueness — callers must NOT supply it.
   * kind / severity / occurredAt are also derived from the validated command.
   *
   * Ordinary non-punitive commands (lift_confinement) must use applyImperialCommand.
   */
  applyImperialPunishmentWithConsequences(
    db: ContentDB,
    command: ImperialCommand & { type: "impose_confinement" | "execute" },
    meta: PunishmentMeta,
  ): Result<{ punishmentId: string; reactionBeats: ReactionBeat[]; baseLines: string[] }, GameError[]> {
    const planned = planImperialCommand(db, this.state, command);
    if (!planned.ok) {
      const error = stateError("IMPERIAL_COMMAND_REJECTED", planned.reason);
      this.logger?.logGameError(error);
      const collector = this.makeCollector();
      if (collector) {
        collector.fail("imperial_punishment_plan", error);
        const tx = this.buildTrace(this.state, this.state,
          { kind: "imperial_command", sourceId: command.type, label: `punishment: ${command.type} ${command.targetId}` },
          collector, "rolled_back", error.message);
        this.traceHistory.push(tx);
      }
      return err([error]);
    }
    const base = planned.plan;

    // Derive context from the validated command — not from the caller.
    const kind: PunishmentKind = command.type === "execute"
      ? "execution"
      : command.durationTurns === null
        ? "indefinite_confinement"
        : "finite_confinement";

    // Allocate persistent pun_000001 ID from justice nextSeq.
    const alloc = allocateJusticeIds(this.state.justice, { punishments: 1 });
    const punishmentId = alloc.punishments[0]!;
    const now = toGameTime(this.state.calendar);

    // Pre-compute the ConfinementEffect ID so PunishmentRecord.details can reference it.
    const statusEffectId = command.type === "impose_confinement"
      ? nextStatusEffectId(this.state, command.targetId)
      : undefined;

    // Build the PunishmentRecord.
    const punishmentRecord: PunishmentRecord = {
      id: punishmentId,
      targetId: command.targetId,
      actorId: "player",
      targetKind: "consort",
      kind,
      severity: punishmentSeverity(kind),
      imposedAt: now,
      publicity: meta.publicity ?? "palace",
      lifecycle: kind === "execution"
        ? { status: "completed", resolvedAt: now, resolution: "immediate" }
        : { status: "active" },
      ...(meta.caseId ? { caseId: meta.caseId } : {}),
      ...(meta.sourceLocation ? { sourceLocation: meta.sourceLocation } : {}),
      ...(kind === "finite_confinement" && command.type === "impose_confinement"
        ? { details: { statusEffectId: statusEffectId!, endTurnExclusive: this.state.calendar.dayIndex + (command.durationTurns ?? 0) } }
        : kind === "indefinite_confinement"
          ? { details: { statusEffectId: statusEffectId! } }
          : { details: { deathCause: "imperial_execution" as const } }),
    } as PunishmentRecord;

    // Prior active punishments for the target are resolved by the consort_decease effect in the funnel
    // (which runs before the justice plan). No duplicate resolve_punishment mutations needed here.

    const justicePlan: JusticePlan = {
      mutations: [{ type: "create_punishment", record: punishmentRecord }],
      nextSeq: alloc.nextSeq,
    };

    const ctx: PunishmentOutcomeContext = {
      punishmentId,
      ...(meta.caseId ? { caseId: meta.caseId } : {}),
      targetId: command.targetId,
      actorId: "player",
      kind,
      severity: punishmentSeverity(kind),
      occurredAt: now,
      ...(meta.sourceLocation ? { sourceLocation: meta.sourceLocation } : {}),
      ...(meta.publicity ? { publicity: meta.publicity } : {}),
    };

    const conseq = planPunishmentConsequences(db, this.state, ctx);

    // Inject punishmentId into base.chronicle via links field and payload.
    // Primary punishment entries (decree matches the punishment type) get punishmentId;
    // ancillary administration-transfer entries get sourcePunishmentId.
    const PUNITIVE_DECREES = new Set(["confinement_imposed", "execution"]);
    const punishmentChronicle = base.chronicle.map((draft) => {
      const decree = (draft.payload as { decree?: string }).decree;
      const isPrimary = PUNITIVE_DECREES.has(decree ?? "");
      const payloadExtra = isPrimary
        ? { punishmentId, ...(meta.caseId ? { caseId: meta.caseId } : {}) }
        : { sourcePunishmentId: punishmentId };
      const links = isPrimary
        ? { punishmentId, ...(meta.caseId ? { caseId: meta.caseId } : {}) }
        : { sourcePunishmentId: punishmentId };
      return { ...draft, payload: { ...draft.payload, ...payloadExtra }, links };
    });

    // Thread sourcePunishmentId into the confine effect for statusEffect linkage,
    // and into memory effects for provenance tracking.
    const effects = base.effects.map((e) => {
      if (e.type === "confine" && (e as { char?: string }).char === command.targetId) {
        return { ...e, sourcePunishmentId: punishmentId };
      }
      if (e.type === "memory") {
        return { ...e, entry: { ...e.entry, sourcePunishmentId: punishmentId } };
      }
      return e;
    });

    const txResult = this.commitPlannedTransaction(
      db,
      [...effects, ...conseq.effects],
      [...punishmentChronicle, ...conseq.chronicle],
      conseq.reactionBeats,
      { kind: "imperial_command", sourceId: command.type, label: `punishment: ${command.type} ${command.targetId}` },
      justicePlan,
      undefined,
      // 侍君获罪（severe/terminal：indefinite_confinement/execution）→ 即时生成牵连家族待裁决策（折进同一提交）。
      this.withFamilyImplication(db, punishmentId),
    );
    if (!txResult.ok) return txResult;
    return ok({ punishmentId, reactionBeats: txResult.value.reactionBeats, baseLines: base.lines });
  }

  /**
   * Punitive rank change (demotion / strip_title) WITH consequence effects.
   * Rejects any request that would not produce a demotion or strip_title op.
   *
   * Product rule (locked): all sovereign-direct demotions and title strips are
   * inherently punitive — there is no "administrative demotion" path at this scope.
   *
   * Ordinary 册封/晋升 and harem-admin rank changes must NOT call this.
   * punishmentId / kind / severity / occurredAt are derived internally.
   */
  applyPunitiveRankChangeWithConsequences(
    db: ContentDB,
    targetId: string,
    request: RankOpRequest,
    meta: PunishmentMeta,
  ): Result<{ punishmentId: string; reactionBeats: ReactionBeat[]; baseLines: string[] }, GameError[]> {
    const punitiveRankSource: TraceSource = { kind: "imperial_command", sourceId: "punitive_rank_change", label: `punitive rank: ${targetId}` };
    const op = buildRankOp(db, this.state, targetId, request, { kind: "sovereign", actorId: "player" });
    if (!op) {
      const error = stateError("RANK_OP_INVALID", "rank change is a no-op or target has no standing");
      this.logger?.logGameError(error);
      const collector = this.makeCollector();
      if (collector) {
        collector.fail("punitive_rank_plan", error);
        this.traceHistory.push(this.buildTrace(this.state, this.state, punitiveRankSource, collector, "rolled_back", error.message));
      }
      return err([error]);
    }
    if (op.kind !== "demote" && op.kind !== "strip_title") {
      const error = stateError("RANK_OP_INVALID", `punitive entry requires demote or strip_title, got: ${op.kind}`);
      this.logger?.logGameError(error);
      const collector = this.makeCollector();
      if (collector) {
        collector.fail("punitive_rank_plan", error);
        this.traceHistory.push(this.buildTrace(this.state, this.state, punitiveRankSource, collector, "rolled_back", error.message));
      }
      return err([error]);
    }

    const kind: PunishmentKind = op.kind === "strip_title" ? "strip_title" : "rank_demotion";
    const occurredAt = toGameTime(this.state.calendar);

    // Allocate persistent pun_000001 ID from justice nextSeq.
    const rankAlloc = allocateJusticeIds(this.state.justice, { punishments: 1 });
    const punishmentId = rankAlloc.punishments[0]!;

    // Build PunishmentRecord details from current standing + request.
    const fromRankId = this.state.standing[targetId]?.rank ?? "";
    const rankPunishment: PunishmentRecord = {
      id: punishmentId,
      targetId,
      targetKind: "consort",
      actorId: "player",
      kind,
      severity: punishmentSeverity(kind),
      imposedAt: occurredAt,
      publicity: meta.publicity ?? "palace",
      lifecycle: { status: "completed", resolvedAt: occurredAt, resolution: "immediate" },
      ...(meta.caseId ? { caseId: meta.caseId } : {}),
      ...(meta.sourceLocation ? { sourceLocation: meta.sourceLocation } : {}),
      ...(kind === "rank_demotion"
        ? { details: { fromRankId, toRankId: request.kind === "set_rank" ? request.rank : fromRankId } }
        : { details: { removedTitle: this.state.standing[targetId]?.title ?? "" } }),
    } as PunishmentRecord;

    const rankJusticePlan: JusticePlan = {
      mutations: [{ type: "create_punishment", record: rankPunishment }],
      nextSeq: rankAlloc.nextSeq,
    };

    const ctx: PunishmentOutcomeContext = {
      punishmentId,
      ...(meta.caseId ? { caseId: meta.caseId } : {}),
      targetId,
      actorId: "player",
      kind,
      severity: punishmentSeverity(kind),
      occurredAt,
      ...(meta.sourceLocation ? { sourceLocation: meta.sourceLocation } : {}),
      ...(meta.publicity ? { publicity: meta.publicity } : {}),
    };

    const conseq = planPunishmentConsequences(db, this.state, ctx);
    const chronicle: Omit<CourtEvent, "id">[] = [
      {
        type: "rank_changed",
        occurredAt,
        participants: [
          { charId: "player", role: "actor" },
          { charId: targetId, role: "demoted" },
        ],
        payload: {
          decree: "imperial_punitive_rank_change",
          targetId,
          direction: op.kind,
          punishmentId,
          ...(meta.caseId ? { caseId: meta.caseId } : {}),
        },
        links: { punishmentId, ...(meta.caseId ? { caseId: meta.caseId } : {}) },
        publicity: { scope: "palace", persistence: "institutional" },
        publicSalience: 65,
        retention: "slow",
        tags: ["punitive", "rank_change", op.kind],
      },
      ...conseq.chronicle,
    ];

    // Inject sourcePunishmentId into memory effects for provenance tracking.
    const rankEffectsWithProvenance = conseq.effects.map((e) =>
      e.type === "memory" ? { ...e, entry: { ...e.entry, sourcePunishmentId: punishmentId } } : e,
    );

    const txResult = this.commitPlannedTransaction(
      db,
      [...op.effects, ...rankEffectsWithProvenance],
      chronicle,
      conseq.reactionBeats,
      { kind: "imperial_command", sourceId: "punitive_rank_change", label: `punitive rank: ${op.kind} ${targetId}` },
      rankJusticePlan,
    );
    if (!txResult.ok) return txResult;
    return ok({ punishmentId, reactionBeats: txResult.value.reactionBeats, baseLines: op.lines });
  }

  /**
   * Transfer or restore harem administration authority ("传乘风交付六宫主理权").
   *
   * Classification (at time of command):
   *   empress → other (healthy empress)  → punitive `strip_harem_authority`; punishmentId generated
   *   empress → other (sick/critical)    → administrative `empress_illness`; no punishment record
   *   acting/neiwu → empress             → restore; no punishment record
   *   acting/neiwu → different target    → reassignment; no punishment record
   *   no-op                              → rejected, state unchanged
   *
   * Returns `{ punishmentId?, reactionBeats, lines }` on success.
   * `punishmentId` is only present when the transfer was punitive.
   */
  transferHaremAdministration(
    db: ContentDB,
    command: TransferHaremAdministrationCommand,
  ): Result<{ punishmentId?: string; reactionBeats: ReactionBeat[]; lines: string[] }, GameError[]> {
    const planned = planHaremAdministrationTransfer(db, this.state, command);
    if (!planned.ok) {
      const error = stateError("HAREM_TRANSFER_REJECTED", planned.reason);
      this.logger?.logGameError(error);
      const collector = this.makeCollector();
      if (collector) {
        collector.fail("harem_administration_transfer_plan", error);
        const tx = this.buildTrace(this.state, this.state,
          { kind: "imperial_command", sourceId: "transfer_harem_administration", label: "harem admin transfer (rejected)" },
          collector, "rolled_back", error.message);
        this.traceHistory.push(tx);
      }
      return err([error]);
    }
    const plan = planned.plan;
    let punishmentId: string | undefined;
    let allEffects = plan.effects;
    let allChronicle = plan.chronicle;
    let allReactionBeats = plan.reactionBeats;
    let haremJusticePlan: JusticePlan | undefined;

    if (plan.isPunitive) {
      // Allocate a formal pun_000001 ID from justice nextSeq.
      const haremAlloc = allocateJusticeIds(this.state.justice, { punishments: 1 });
      punishmentId = haremAlloc.punishments[0]!;
      const now = toGameTime(this.state.calendar);
      // plan.empressId is set by the planner when isPunitive=true; use it directly to avoid TOCTOU re-search.
      const targetId = plan.empressId ?? "unknown";

      const haremPunishmentRecord: PunishmentRecord = {
        id: punishmentId as PunishmentId,
        kind: "strip_harem_authority",
        targetId,
        actorId: "player",
        targetKind: "consort",
        severity: punishmentSeverity("strip_harem_authority"),
        imposedAt: now,
        sourceLocation: "zichendian",
        publicity: "palace",
        lifecycle: { status: "active" },
        ...(command.caseId ? { caseId: command.caseId as CaseId } : {}),
        details: {
          fromMode: "empress" as const,
          initialTarget: command.target.kind === "consort"
            ? { mode: "acting_consort" as const, charId: command.target.charId }
            : { mode: "neiwu_proxy" as const },
        },
      };

      haremJusticePlan = {
        mutations: [{ type: "create_punishment", record: haremPunishmentRecord }],
        nextSeq: haremAlloc.nextSeq,
      };

      const ctx: PunishmentOutcomeContext = {
        punishmentId,
        ...(command.caseId ? { caseId: command.caseId } : {}),
        targetId,
        actorId: "player",
        kind: "strip_harem_authority",
        severity: punishmentSeverity("strip_harem_authority"),
        occurredAt: now,
        sourceLocation: "zichendian",
      };
      const conseq = planPunishmentConsequences(db, this.state, ctx);
      // Inject punishmentId into the plan chronicle (the harem_administration_changed entry).
      allChronicle = plan.chronicle.map((draft) => ({
        ...draft,
        payload: { ...draft.payload, punishmentId, sourcePunishmentId: punishmentId },
        links: { ...draft.links, sourcePunishmentId: punishmentId },
      }));
      // Inject sourcePunishmentId into memory effects.
      const conseqEffectsWithProvenance = conseq.effects.map((e) =>
        e.type === "memory" ? { ...e, entry: { ...e.entry, sourcePunishmentId: punishmentId } } : e,
      );
      allEffects = [...plan.effects, ...conseqEffectsWithProvenance];
      allChronicle = [...allChronicle, ...conseq.chronicle];
      allReactionBeats = [...plan.reactionBeats, ...conseq.reactionBeats];
    } else if (command.target.kind === "empress") {
      // Restoration: find active strip_harem_authority for the empress and lift it.
      const activePun = Object.values(this.state.justice.punishments).find(
        (p) =>
          p.kind === "strip_harem_authority" &&
          p.lifecycle.status === "active" &&
          this.state.standing[p.targetId]?.rank === "huanghou",
      );
      if (activePun) {
        const restoreAlloc = allocateJusticeIds(this.state.justice, {});
        const now = toGameTime(this.state.calendar);
        haremJusticePlan = {
          mutations: [{
            type: "resolve_punishment",
            punishmentId: activePun.id,
            lifecycle: { status: "lifted", resolvedAt: now, resolution: "authority_restored" },
          }],
          nextSeq: restoreAlloc.nextSeq,
        };
        // Add sourcePunishmentId to restoration chronicle entries.
        allChronicle = plan.chronicle.map((draft) => ({
          ...draft,
          links: { ...draft.links, sourcePunishmentId: activePun.id },
        }));
      }
    }

    const txResult = this.commitPlannedTransaction(
      db,
      allEffects,
      allChronicle,
      allReactionBeats,
      { kind: "imperial_command", sourceId: "transfer_harem_administration", label: `harem admin transfer${punishmentId ? ` (punitive: ${punishmentId})` : ""}` },
      haremJusticePlan,
    );
    if (!txResult.ok) return txResult;
    return ok({ punishmentId, reactionBeats: txResult.value.reactionBeats, lines: plan.lines });
  }

  /**
   * Resolve an event as ONE transaction: same effect funnel + apCost spend +
   * eventLog entry (review rule #4). Rejection → state untouched, no notify,
   * NOT marked fired; errors logged once and reported as diagnostics.
   */
  resolveEvent(
    db: ContentDB,
    eventId: string,
    effects: readonly EventEffect[],
  ): Result<EventResolution, GameError[]> {
    // 1) effects + apCost 推进（引擎事务；含 affordability / firedAt / eventLog）。
    const collector = this.makeCollector();
    const beforeState = this.state;
    const source: TraceSource = { kind: "event", sourceId: eventId, label: `event: ${eventId}` };
    const result = resolveEvent(db, this.state, eventId, effects, collector ? { collector } : undefined);
    if (!result.ok) {
      for (const error of result.error) this.logger?.logGameError(error);
      this.lastEffectReport = { effects, outcome: "rejected", errors: result.error };
      if (collector) {
        collector.fail("event_resolution", result.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          result.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return result;
    }
    // 1b) Capture the engine-resolved changes (apCost, calendar, eventLog, sceneHistory).
    //     These are only the paths the funnel didn't already attribute via collector.
    const engineState = result.value.state;
    collector?.capturePhaseScheduled("event_resolution", diffGameState(beforeState, engineState));
    // 2) 统一边界结算：事件 apCost 若跨月/跨年，照常跑健康/增龄/死亡/告老/大选/禁足，
    //    杜绝事件流绕过结算。失败 → 整体回滚（state 不变、不 emit）。
    const settled = this.settlePostAdvance(db, this.state, engineState, collector ?? undefined);
    if (!settled.ok) {
      for (const error of settled.error) this.logger?.logGameError(error);
      this.lastEffectReport = { effects, outcome: "rejected", errors: settled.error };
      if (collector) {
        collector.fail("settle_post_advance", settled.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          settled.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return err(settled.error);
    }
    // 3) 成功：commit + emit。
    const finalState = settled.value.state;
    if (collector) {
      captureEligibilityTransitions(db, beforeState, finalState, collector);
      const tx = this.buildTrace(beforeState, finalState, source, collector, "committed");
      this.state = finalState;
      this.traceHistory.push(tx);
    } else {
      this.state = finalState;
    }
    this.lastEffectReport = { effects, outcome: "applied", errors: [] };
    this.emit();
    return ok({ state: finalState, rolledOver: result.value.rolledOver });
  }

  /**
   * 模板事件启动前原子写入 seq 递增 + generated record。
   * 调用方随即进入 SceneRunner；quit 时须调用 abandonTemplateEvent 清除 generated record。
   */
  beginTemplateEvent(statePatch: { templateEventNextSeq: number; newRecord: TemplateEventRecord }): void {
    const beforeState = this.state;
    const finalState: GameState = {
      ...this.state,
      templateEventNextSeq: statePatch.templateEventNextSeq,
      templateEventRecords: {
        ...this.state.templateEventRecords,
        [statePatch.newRecord.id]: statePatch.newRecord,
      },
    };
    const collector = this.makeCollector();
    if (collector) {
      const source: TraceSource = { kind: "event", sourceId: statePatch.newRecord.id, label: `template:begin ${statePatch.newRecord.id}` };
      collector.capturePhaseScheduled("direct_mutation", diffGameState(beforeState, finalState));
      const tx = this.buildTrace(beforeState, finalState, source, collector, "committed");
      this.state = finalState;
      this.traceHistory.push(tx);
    } else {
      this.state = finalState;
    }
    this.emit();
  }

  /**
   * 模板事件一次性提交：effects + apCost + eventLog + sceneHistory + record resolved 全部单次 commit。
   * 不先调用 resolveEvent 再修改 record；改为直接复用 resolveEvent 纯函数 + settlePostAdvance，
   * 在 settled 状态上追加 record 更新后一次性提交。
   */
  resolveTemplateEvent(
    runtimeDb: ContentDB,
    instanceId: string,
    selectedChoiceId: string,
    effects: readonly EventEffect[],
  ): Result<EventResolution, GameError[]> {
    const record = this.state.templateEventRecords[instanceId];
    if (!record) {
      return err([stateError("BAD_EVENT_REF", `template event record "${instanceId}" not found`)]);
    }
    if (record.status !== "generated") {
      return err([stateError("EVENT_ALREADY_FIRED", `template event "${instanceId}" already ${record.status}`)]);
    }
    const template = runtimeDb.templates[record.templateId];
    if (!selectedChoiceId || !template?.choices.some((c) => c.id === selectedChoiceId)) {
      return err([stateError("BAD_CHOICE", `"${selectedChoiceId}" is not a valid choice for template "${record.templateId}"`)]);
    }

    const collector = this.makeCollector();
    const beforeState = this.state;
    const source: TraceSource = { kind: "event", sourceId: instanceId, label: `template: ${instanceId}` };

    const result = resolveEvent(runtimeDb, this.state, instanceId, effects, collector ? { collector } : undefined);
    if (!result.ok) {
      for (const error of result.error) this.logger?.logGameError(error);
      this.lastEffectReport = { effects, outcome: "rejected", errors: result.error };
      if (collector) {
        collector.fail("event_resolution", result.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          result.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return result;
    }
    const engineState = result.value.state;
    collector?.capturePhaseScheduled("event_resolution", diffGameState(beforeState, engineState));

    const settled = this.settlePostAdvance(runtimeDb, this.state, engineState, collector ?? undefined);
    if (!settled.ok) {
      for (const error of settled.error) this.logger?.logGameError(error);
      this.lastEffectReport = { effects, outcome: "rejected", errors: settled.error };
      if (collector) {
        collector.fail("settle_post_advance", settled.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          settled.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return err(settled.error);
    }

    // resolvedAt 使用事件实际发生时刻（pre-rollover），避免扣完最后一个 AP 触发跨旬后计入下一旬。
    const lastLogEntry = engineState.eventLog.at(-1);
    const resolvedAt =
      lastLogEntry?.eventId === instanceId
        ? lastLogEntry.firedAt
        : toGameTime(beforeState.calendar);

    // record 与其他变更同批次写入 — 不二次 emit
    const resolvedRecord: TemplateEventRecord = {
      ...record,
      status: "resolved",
      selectedChoiceId,
      resolvedAt,
    };
    const finalState: GameState = {
      ...settled.value.state,
      templateEventRecords: {
        ...settled.value.state.templateEventRecords,
        [instanceId]: resolvedRecord,
      },
    };

    if (collector) {
      // record 从 generated → resolved 的 diff 需单独登记，否则 strict 模式会抛 untracked
      collector.capturePhaseScheduled(
        "template_record_resolution",
        diffGameState(settled.value.state, finalState),
      );
      captureEligibilityTransitions(runtimeDb, beforeState, finalState, collector);
      const tx = this.buildTrace(beforeState, finalState, source, collector, "committed");
      this.state = finalState;
      this.traceHistory.push(tx);
    } else {
      this.state = finalState;
    }
    this.lastEffectReport = { effects, outcome: "applied", errors: [] };
    this.emit();
    return ok({ state: finalState, rolledOver: result.value.rolledOver });
  }

  /**
   * 中途离开模板事件：删除 generated record，不回退 seq，不触发 cooldown，不写 eventLog。
   * resolved record 不受影响。
   */
  abandonTemplateEvent(instanceId: string): void {
    const record = this.state.templateEventRecords[instanceId];
    if (!record || record.status !== "generated") return;
    const templateEventRecords = { ...this.state.templateEventRecords };
    delete templateEventRecords[instanceId];
    this.state = { ...this.state, templateEventRecords };
    this.emit();
  }

  /**
   * THE single time-advancing entry (Phase 2 §): one atomic transaction that,
   * on a LOCAL candidate state, (1) applies the player's action effects while the
   * subject is still alive, (2) advances the calendar (pure reducer), (3) on a
   * cross-month boundary runs the monthly health tick, and (4) writes gameOver
   * if the sovereign died — then commits ONCE (`this.state = candidate; emit()`).
   *
   * Atomic: if ANY step rejects (or the tick throws on an unresolvable subject),
   * we `return err(...)` and `this.state` is left byte-identical — no mutation,
   * no notify. Never routes through `this.dispatch()` (which would commit + emit
   * a half-advanced state). Action settles before time so the cross-month tick
   * can never kill a subject we then favor/educate.
   */
  resolveTimedAction(
    db: ContentDB,
    actionEffects: readonly EventEffect[],
    command: { type: "SPEND_AP"; amount: number } | { type: "SKIP_REMAINDER" },
  ): Result<TimedOutcome, GameError[]> {
    const collector = this.makeCollector();
    const beforeState = this.state;
    const source: TraceSource = { kind: "time_advance", sourceId: command.type, label: `time advance: ${command.type}` };
    // 1) action effects on a local candidate (subject still alive)
    let candidate = this.state;
    if (actionEffects.length > 0) {
      const a = applyEffects(db, candidate, actionEffects, collector ? { collector } : {});
      if (!a.ok) {
        if (collector) {
          collector.fail("effects", a.error);
          const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
            a.error.map((e) => e.message).join("; "));
          this.traceHistory.push(tx);
        }
        return err(a.error);
      }
      candidate = a.value;
    }
    const advance = this.advanceCandidate(db, candidate, command, collector);
    if (!advance.ok) {
      if (collector) {
        collector.fail("advance_candidate", advance.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          advance.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return err(advance.error);
    }
    const { rolledOver, monthChanged, healthOutcome, nextState } = advance.value;
    if (collector) {
      captureEligibilityTransitions(db, beforeState, nextState, collector);
      // Build and validate trace BEFORE committing — strict mode may throw here.
      const tx = this.buildTrace(beforeState, nextState, source, collector, "committed");
      this.state = nextState;
      this.traceHistory.push(tx);
    } else {
      this.state = nextState;
    }
    this.emit();
    return ok({ rolledOver, monthChanged, healthOutcome });
  }

  /**
   * Like resolveTimedAction but applies `postAdvance` to the settled candidate
   * before the single final commit+emit.  Used by interveneInColdPalace to
   * append the intervention record atomically — this.state is never set to a
   * half-finished state and exactly one emit fires.
   */
  private resolveTimedActionWithPostAdvance(
    db: ContentDB,
    actionEffects: readonly EventEffect[],
    command: { type: "SPEND_AP"; amount: number } | { type: "SKIP_REMAINDER" },
    postAdvance: (s: GameState) => GameState,
    preAdvance?: (s: GameState) => GameState,
  ): Result<TimedOutcome, GameError[]> {
    const collector = this.makeCollector();
    const beforeState = this.state;
    const source: TraceSource = { kind: "time_advance", sourceId: command.type, label: `time advance: ${command.type}` };
    let candidate = this.state;
    if (actionEffects.length > 0) {
      const a = applyEffects(db, candidate, actionEffects, collector ? { collector } : {});
      if (!a.ok) {
        if (collector) {
          collector.fail("effects", a.error);
          const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
            a.error.map((e) => e.message).join("; "));
          this.traceHistory.push(tx);
        }
        return err(a.error);
      }
      candidate = a.value;
    }
    if (preAdvance) {
      const beforePre = candidate;
      candidate = preAdvance(candidate);
      collector?.capturePhaseScheduled("pre_advance_mutation", diffGameState(beforePre, candidate));
    }
    const advance = this.advanceCandidate(db, candidate, command, collector);
    if (!advance.ok) {
      if (collector) {
        collector.fail("advance_candidate", advance.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          advance.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return err(advance.error);
    }
    const { rolledOver, monthChanged, healthOutcome } = advance.value;
    const settledState = advance.value.nextState;
    const nextState = postAdvance(settledState);
    if (collector) {
      collector.capturePhaseScheduled("post_advance", diffGameState(settledState, nextState));
      captureEligibilityTransitions(db, beforeState, nextState, collector);
      const tx = this.buildTrace(beforeState, nextState, source, collector, "committed");
      this.state = nextState;
      this.traceHistory.push(tx);
    } else {
      this.state = nextState;
    }
    this.emit();
    return ok({ rolledOver, monthChanged, healthOutcome });
  }

  /**
   * Travel through the SAME atomic time-advancing core as resolveTimedAction.
   * Applies the MOVE command(s) to a local candidate (instant, no time cost),
   * then advances time via `advanceCommand` (the SPEND_AP), running the
   * cross-month health tick + gameOver write in ONE commit. If any step rejects,
   * `this.state` is untouched. Routes travel's time-spend through the unified
   * entry so cross-month travel runs the monthly tick (and can end the game).
   */
  travelAndAdvance(
    db: ContentDB,
    moveCommands: readonly GameCommand[],
    advanceCommand: { type: "SPEND_AP"; amount: number } | { type: "SKIP_REMAINDER" },
  ): Result<TimedOutcome, GameError[]> {
    const collector = this.makeCollector();
    const beforeState = this.state;
    const source: TraceSource = { kind: "time_advance", sourceId: "travel", label: "travel + advance" };
    // 1) MOVE on a local candidate (no time advances yet — subject still where they were)
    let candidate = this.state;
    if (moveCommands.length > 0) {
      const beforeMove = candidate;
      const m = applyBatch(candidate, moveCommands);
      if (!m.ok) {
        if (collector) {
          collector.fail("travel_move", m.error.message);
          const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back", m.error.message);
          this.traceHistory.push(tx);
        }
        return err([m.error]);
      }
      candidate = m.value.state;
      // Capture travel location change as a scheduled phase mutation.
      collector?.capturePhaseScheduled("travel_move", diffGameState(beforeMove, candidate));
    }
    const advance = this.advanceCandidate(db, candidate, advanceCommand, collector);
    if (!advance.ok) {
      if (collector) {
        collector.fail("advance_candidate", advance.error);
        const tx = this.buildTrace(beforeState, beforeState, source, collector, "rolled_back",
          advance.error.map((e) => e.message).join("; "));
        this.traceHistory.push(tx);
      }
      return err(advance.error);
    }
    const { rolledOver, monthChanged, healthOutcome, nextState } = advance.value;
    if (collector) {
      captureEligibilityTransitions(db, beforeState, nextState, collector);
      const tx = this.buildTrace(beforeState, nextState, source, collector, "committed");
      this.state = nextState;
      this.traceHistory.push(tx);
    } else {
      this.state = nextState;
    }
    this.emit();
    return ok({ rolledOver, monthChanged, healthOutcome });
  }

  /**
   * Shared core: advance the calendar on `candidate`, run cross-month health tick,
   * write gameOver on sovereign death. Returns the final candidate state without
   * committing — callers are responsible for `this.state = nextState; this.emit()`.
   *
   * Phase-local diffs are captured into `collector` (as "scheduled") so the trace
   * panel can attribute calendar/daxuan/gameOver mutations to their correct phase
   * instead of labelling them "untracked".
   */
  /**
   * Runs health tick, official yearly tick, daxuan detection, and confinement sweep
   * on a state that has ALREADY had its calendar advanced. Called by both
   * advanceCandidate (after applying a command) and resolveEvent (after engine
   * apCost resolves the calendar move).
   */
  private settlePostAdvance(
    db: ContentDB,
    before: GameState,
    advanced: GameState,
    collector?: TraceCollector,
  ): Result<{ state: GameState; monthChanged: boolean; healthOutcome: MonthlyTickResult | null }, GameError[]> {
    let candidate = advanced;
    const monthChanged = monthOrdinal(advanced.calendar) !== monthOrdinal(before.calendar);

    // 3) Cross-month health tick.
    let healthOutcome: MonthlyTickResult | null = null;
    if (monthChanged) {
      try {
        healthOutcome = buildMonthlyHealthTick(db, candidate);
      } catch (e) {
        return err([stateError("HEALTH_TICK_FAILED", String(e))]);
      }
      const beforeTick = candidate;
      const h = collector
        ? collector.withPhase("monthly_health_tick", () =>
            applyEffects(db, candidate, healthOutcome!.effects, { collector }),
          )
        : applyEffects(db, candidate, healthOutcome.effects);
      if (!h.ok) return err(h.error);
      candidate = h.value;
      // Capture anything the funnel may have missed (e.g. lifecycle from health to deceased).
      collector?.capturePhaseScheduled("monthly_health_tick", diffGameState(beforeTick, candidate));

      // 4) Sovereign death → gameOver.
      if (healthOutcome.sovereignDied) {
        const beforeGameOver = candidate;
        candidate = { ...candidate, gameOver: { cause: "sovereign_death", at: toGameTime(candidate.calendar) } };
        collector?.capturePhaseScheduled("game_over_resolution", diffGameState(beforeGameOver, candidate));
      }
    }

    // 跨入正月（新年第一月）→ 官员年度 tick（增龄/死亡/告老请求）+ 年度地方灾情奏报（Phase 4A）。
    if (monthChanged && candidate.calendar.month === 1) {
      const beforeOfficialTick = candidate;
      candidate = buildOfficialYearlyTick(candidate, db, toGameTime(candidate.calendar));
      candidate = maybeGenerateAnnualDisaster(candidate, toGameTime(candidate.calendar)); // 确定性、有界、同源去重
      collector?.capturePhaseScheduled("official_yearly_tick", diffGameState(beforeOfficialTick, candidate));
    }

    // 跨入四月 → 年度财政奏折（户部岁入计划；Phase 4B）。同源去重保证幂等。
    if (monthChanged && candidate.calendar.month === 4) {
      candidate = maybeGenerateAnnualTreasuryMemorial(candidate, toGameTime(candidate.calendar));
    }

    // 跨入正月/四月/七月/十月 → 季度财政结算（税收入库 + 固定支出；同源去重保证幂等）。
    if (monthChanged && [1, 4, 7, 10].includes(candidate.calendar.month)) {
      const beforeQuarterly = candidate;
      candidate = settleQuarterlyTreasury(db, candidate, toGameTime(candidate.calendar));
      collector?.capturePhaseScheduled("quarterly_treasury_settlement", diffGameState(beforeQuarterly, candidate));
    }

    // 跨入七月 → 年度边情评估 + 军务奏折（Phase 4C）。同源去重保证幂等。
    if (monthChanged && candidate.calendar.month === 7) {
      const beforeMilitary = candidate;
      candidate = maybeGenerateAnnualMilitaryAssessment(candidate, db, toGameTime(candidate.calendar));
      collector?.capturePhaseScheduled("annual_military_assessment", diffGameState(beforeMilitary, candidate));
    }

    // 八月上旬（含 catch-up）→ 万寿节筹办：设 ritual_birthday_pending，年度幂等。
    {
      const beforeBirthday = candidate;
      candidate = maybeScheduleBirthdayRitual(candidate);
      if (candidate !== beforeBirthday) {
        collector?.capturePhaseScheduled("birthday_ritual_schedule", diffGameState(beforeBirthday, candidate));
      }
    }

    // 二月（或其后首次推进，含本月内首次推进的 catch-up）→ 候补池增龄/退出 + 生成本年科举。
    // 不依赖 monthChanged：settleCalendarAdvance 仅在成功时间事务后调用，hasGeneratedExaminationForYear
    // 已保证本年幂等（同月再推进/事件 apCost 未跨月亦立即 catch-up，且不重复生成/增龄）。
    if (candidate.calendar.month >= EXAM_MONTH && !hasGeneratedExaminationForYear(candidate, candidate.calendar.year)) {
      const beforeExam = candidate;
      candidate = settleAnnualExamination(candidate, db, candidate.calendar.year, toGameTime(candidate.calendar));
      collector?.capturePhaseScheduled("annual_examination", diffGameState(beforeExam, candidate));
    }

    // 十一月（或其后首次推进，catch-up）→ 吏部考课：政绩更新/自动升降/连锁补缺/人事简报。
    // 同样不依赖 monthChanged；hasReviewedYear 保证本年幂等（在科举之后，候补已就绪）。
    if (candidate.calendar.month >= REVIEW_MONTH && !hasReviewedYear(candidate, candidate.calendar.year)) {
      const beforeReview = candidate;
      candidate = buildAnnualReview(candidate, db, candidate.calendar.year, toGameTime(candidate.calendar));
      // 考课之后一次性生成本年人事奏折 + 侍君请托（确定性、有界；与 hasReviewedYear 同守卫，年度仅一次）。
      candidate = generateAnnualPersonnelEvents(candidate, db, toGameTime(candidate.calendar));
      collector?.capturePhaseScheduled("annual_review", diffGameState(beforeReview, candidate));
    }

    // 六月下旬后（catch-up 亦安全）→ 六宫年度例核：自主位分决策一次 + 追加禀报记录。
    // settleAnnualHaremAdminReview 自检窗口与幂等，外层守卫可省略但保留以减少调用。
    if (isHaremAdminReviewWindow(candidate.calendar) && !hasHaremAdminReviewForYear(candidate, candidate.calendar.year)) {
      const beforeHaremReview = candidate;
      const reviewResult = settleAnnualHaremAdminReview(db, candidate);
      if (!reviewResult.ok) return err(reviewResult.error);
      candidate = reviewResult.value;
      collector?.capturePhaseScheduled("annual_harem_administration_review", diffGameState(beforeHaremReview, candidate));
    }

    // 5-pre) 后宫内部惩戒（月度；PUNISH-4G-B）。
    // 仅排除本月被例核调整位分的当事人，不再因任意一人被调整而全局跳过。
    if (monthChanged) {
      const { year: curYear, month: curMonth } = candidate.calendar;
      const adminRankChangedTargetsThisMonth = new Set(
        candidate.haremAdminReviews
          .filter(
            (r) =>
              r.outcome === "rank_changed" &&
              r.settledAt.year === curYear &&
              r.settledAt.month === curMonth &&
              r.decision !== undefined,
          )
          .map((r) => r.decision!.targetId),
      );
      const beforeDiscipline = candidate;
      const plan = planHaremDiscipline(db, candidate, adminRankChangedTargetsThisMonth);
      if (plan !== null) {
        const occResult = resolveHaremDisciplineOccurrence(db, candidate, plan);
        if (!occResult.ok) return err(occResult.error);
        candidate = occResult.value.state;
      }
      collector?.capturePhaseScheduled(
        "harem_discipline_occurrence",
        diffGameState(beforeDiscipline, candidate),
      );
    }

    // 5-mid) 宫斗月度结算（Phase 5A-3a）。
    if (monthChanged) {
      const beforeIntrigue = candidate;
      const intrigueResult = settleHaremIntrigue(db, candidate, toGameTime(candidate.calendar));
      if (!intrigueResult.ok) return err(intrigueResult.error);
      candidate = intrigueResult.value.state;
      collector?.capturePhaseScheduled("harem_intrigue_settlement", diffGameState(beforeIntrigue, candidate));
    }

    // 5-mid-inv) 调查任务结算（Phase 5B-2）。每次时间推进后均运行（按行动日计算，不限 monthChanged）。
    {
      const beforeInv = candidate;
      const invResult = settleDueInvestigationTasks(db, candidate, toGameTime(candidate.calendar));
      candidate = invResult.state;
      collector?.capturePhaseScheduled("investigation_task_settlement", diffGameState(beforeInv, candidate));
    }

    // 5) Cold-palace incident generation (月度；replay-stable).
    if (monthChanged) {
      // 5a) Critical-illness incidents — health ≤ CRITICAL_HEALTH_THRESHOLD (PUNISH-4D).
      //     Two-phase: no health effect at tick time; player resolves via resolveColdPalaceCriticalIncident().
      const beforeCritical = candidate;
      const criticalIncident = planColdPalaceCriticalIncident(candidate);
      if (criticalIncident) {
        candidate = { ...candidate, coldPalaceIncidents: [...candidate.coldPalaceIncidents, criticalIncident] };
        collector?.capturePhaseScheduled("cold_palace_critical_incidents", diffGameState(beforeCritical, candidate));
      }

      // 5b) Mental breakdown — PUNISH-4F (after critical illness, before regular).
      const beforeMadness = candidate;
      const madnessResult = planColdPalaceMadnessBreakdown(candidate);
      if (madnessResult) {
        const { effect: madnessEffect, incident: madnessIncident } = madnessResult;
        candidate = {
          ...candidate,
          statusEffects: [...candidate.statusEffects, madnessEffect],
          coldPalaceIncidents: [...candidate.coldPalaceIncidents, madnessIncident],
        };
        collector?.capturePhaseScheduled("cold_palace_madness", diffGameState(beforeMadness, candidate));
      }

      // 5c) Regular incidents (petition / health_deterioration) — health > CRITICAL_HEALTH_THRESHOLD.
      //     Health delta applied immediately (non-lethal).
      const beforeIncidents = candidate;
      const newIncidents = planColdPalaceIncidents(candidate);
      if (newIncidents.length > 0) {
        const incident = newIncidents[0]!;
        if (incident.kind === "health_deterioration") {
          const now = toGameTime(candidate.calendar);
          const { effects: hx } = planHealthChange(candidate, {
            subject: { kind: "consort", id: incident.residentId },
            healthDelta: incident.healthDelta,
            cause: "illness",
            at: now,
          });
          if (hx.length > 0) {
            const h = collector
              ? collector.withPhase("cold_palace_incidents_health", () =>
                  applyEffects(db, candidate, hx),
                )
              : applyEffects(db, candidate, hx);
            if (!h.ok) return err(h.error);
            candidate = h.value;
          }
        }
        candidate = { ...candidate, coldPalaceIncidents: [...candidate.coldPalaceIncidents, ...newIncidents] };
        collector?.capturePhaseScheduled("cold_palace_incidents", diffGameState(beforeIncidents, candidate));
      }
    }

    // Auto-acknowledge stale incidents (deceased / missing residents) so they never
    // permanently block the global interrupt queue. Idempotent: runs every tick.
    // critical_illness incidents are NOT acknowledged here: validator requires pending to
    // have acknowledged=false, and stale critical incidents are already excluded by
    // oldestPresentableIncident() so they cannot block the queue.
    const staleIds = staleIncidentIds(candidate);
    if (staleIds.length > 0) {
      const staleSet = new Set(staleIds);
      candidate = {
        ...candidate,
        coldPalaceIncidents: candidate.coldPalaceIncidents.map((i) =>
          staleSet.has(i.id) && i.kind !== "critical_illness" ? { ...i, acknowledged: true } : i,
        ),
      };
    }

    // 7) Daxuan calendar event detection.
    const beforeDaxuan = candidate;
    if (candidate.pendingDaxuan && isPendingDaxuanResolved(candidate, candidate.pendingDaxuan)) {
      candidate = { ...candidate, pendingDaxuan: undefined };
    }
    if (candidate.pendingDaxuan === undefined) {
      const pd = nextPendingDaxuan(candidate);
      if (pd) candidate = { ...candidate, pendingDaxuan: pd };
    }
    collector?.capturePhaseScheduled("daxuan_detection", diffGameState(beforeDaxuan, candidate));

    // 8) Expire confinements.
    const beforeSweep = candidate;
    const swept = collector
      ? collector.withPhase("sweep_expired_confinements", () =>
          this.sweepExpiredConfinements(db, candidate, collector),
        )
      : this.sweepExpiredConfinements(db, candidate);
    if (!swept.ok) return err(swept.error);
    candidate = swept.value;
    collector?.capturePhaseScheduled("sweep_expired_confinements", diffGameState(beforeSweep, candidate));

    return ok({ state: candidate, monthChanged, healthOutcome });
  }

  private advanceCandidate(
    db: ContentDB,
    candidateIn: GameState,
    command: { type: "SPEND_AP"; amount: number } | { type: "SKIP_REMAINDER" },
    collector?: TraceCollector,
  ): Result<{ rolledOver: boolean; monthChanged: boolean; healthOutcome: MonthlyTickResult | null; nextState: GameState }, GameError[]> {
    // 2) Calendar advance (pure reducer).
    const beforeCalendar = candidateIn;
    const cmd = applyCommand(candidateIn, command);
    if (!cmd.ok) return err([cmd.error]);
    const calendared = cmd.value.state;
    collector?.capturePhaseScheduled("calendar_advance", diffGameState(beforeCalendar, calendared));

    const settled = this.settlePostAdvance(db, candidateIn, calendared, collector);
    if (!settled.ok) return err(settled.error);
    return ok({ rolledOver: cmd.value.rolledOver, monthChanged: settled.value.monthChanged, healthOutcome: settled.value.healthOutcome, nextState: settled.value.state });
  }

  /**
   * 结案所有「已到期但未记史」的有期限禁足：通过漏斗写 liftedTurn=endTurnExclusive
   * （term_expired），并对每条 append 一次 confinement_expired 编年史。幂等：已 lifted
   * 的记录被排除，故重复加载/重复推进不会重复触发（任务 §6/§12）。
   */
  private sweepExpiredConfinements(
    db: ContentDB,
    state: GameState,
    collector?: TraceCollector,
  ): Result<GameState, GameError[]> {
    const expired = expiredUnrecordedConfinements(state);
    if (expired.length === 0) return ok(state);
    const at = toGameTime(state.calendar);
    const chars = [...new Set(expired.map((e) => e.characterId))];
    const applied = applyEffects(
      db,
      state,
      chars.map((char) => ({ type: "lift_confinement" as const, char, at, reason: "term_expired" as const })),
      collector ? { collector } : {},
    );
    if (!applied.ok) return err(applied.error);
    let cur = applied.value;

    // Resolve PunishmentRecords for expired confinements that have sourcePunishmentId.
    const expiredWithPunishment = expired.filter((e) => e.sourcePunishmentId !== undefined);
    if (expiredWithPunishment.length > 0) {
      const expiredAlloc = allocateJusticeIds(cur.justice, {});
      const expiredPlan: JusticePlan = {
        mutations: expiredWithPunishment.map((e) => ({
          type: "resolve_punishment" as const,
          punishmentId: e.sourcePunishmentId!,
          lifecycle: { status: "completed" as const, resolvedAt: at, resolution: "expired" as const },
        })),
        nextSeq: expiredAlloc.nextSeq,
      };
      const expiredResult = applyJusticePlan(cur, expiredPlan);
      if (!expiredResult.ok) return err(expiredResult.error);
      cur = expiredResult.value;
    }
    for (const e of expired) {
      const expiryAt = fromTurnIndex(e.endTurnExclusive!); // 期满旬（独占上界即首个解除旬）
      const draft: Omit<CourtEvent, "id"> = {
        type: "punished",
        occurredAt: expiryAt,
        participants: [{ charId: e.characterId, role: "confined" }],
        ...(e.sourceLocation ? { locationId: e.sourceLocation } : {}),
        payload: {
          decree: "confinement_expired",
          targetId: e.characterId,
          originalConfinementId: e.id,
          reason: "term_expired",
          startTurn: e.startTurn,
          endTurnExclusive: e.endTurnExclusive,
          ...(e.sourcePunishmentId ? { sourcePunishmentId: e.sourcePunishmentId } : {}),
        },
        publicity: { scope: "palace", persistence: "institutional" },
        publicSalience: 40,
        retention: "slow",
        tags: ["imperial_decree", "confinement_expired"],
        ...(e.sourcePunishmentId ? { links: { sourcePunishmentId: e.sourcePunishmentId } } : {}),
      };
      const ap = appendCourtEvent(cur, draft);
      if (!ap.ok) return err(ap.error);
      cur = ap.value.state;
      // 皇后禁足到期：附加「复掌六宫」编年史（主理权已由漏斗 lift_confinement 自动归还）。
      if (cur.standing[e.characterId]?.rank === "huanghou") {
        const restoredDraft: Omit<CourtEvent, "id"> = {
          type: "punished",
          occurredAt: expiryAt,
          participants: [{ charId: e.characterId, role: "confined" }],
          payload: { decree: "empress_administration_restored", targetId: e.characterId, reason: "term_expired" },
          publicity: { scope: "palace", persistence: "institutional" },
          publicSalience: 70,
          retention: "permanent",
          tags: ["imperial_decree", "harem_administration", "empress_restored"],
        };
        const ap2 = appendCourtEvent(cur, restoredDraft);
        if (!ap2.ok) return err(ap2.error);
        cur = ap2.value.state;
      }
    }
    return ok(cur);
  }

  /** Pure time advance with no action effects (= resolveTimedAction(db, [], command)). */
  advanceTime(
    db: ContentDB,
    command: { type: "SPEND_AP"; amount: number } | { type: "SKIP_REMAINDER" },
  ): Result<TimedOutcome, GameError[]> {
    return this.resolveTimedAction(db, [], command);
  }

  /**
   * 奉先殿抚养权转移 — 原子事务：effects + chronicle + 1 AP + settlePostAdvance，一次 commit，一次 emit。
   * 任一步骤失败时 this.state 保持原值，不扣 AP，不写 chronicle，不写 memory。
   */
  transferHeirCustodyAndAdvance(
    db: ContentDB,
    command: HeirCustodyTransferCommand,
  ): Result<TimedOutcome & { plan: HeirCustodyTransferPlan }, GameError[]> {
    const planResult = planHeirCustodyTransfer(db, this.state, command);
    if (!planResult.ok) return err(planResult.error);
    const plan = planResult.value;

    const postAdvance = (settled: GameState): GameState => {
      let s = settled;
      for (const draft of plan.chronicle) {
        const ap = appendCourtEvent(s, draft);
        if (!ap.ok) throw new Error(`chronicle_append: ${ap.error[0]?.message ?? "failed"}`);
        s = ap.value.state;
      }
      return s;
    };

    const txResult = this.resolveTimedActionWithPostAdvance(
      db,
      plan.effects,
      { type: "SPEND_AP", amount: 1 },
      postAdvance,
    );
    if (!txResult.ok) return err(txResult.error);
    return ok({ ...txResult.value, plan });
  }

  /**
   * CAS (compare-and-swap) for dialogue state updates.
   *
   * Returns `true` and updates `this.state` to `next` (then emits) only when
   * `this.state === expected` (reference equality). Returns `false` and leaves
   * state untouched when `this.state !== expected` (another update raced).
   *
   * Used by the generative dialogue flow to prevent applying a stale LLM response
   * after a concurrent state change (e.g. health tick, AP spend) invalidated the
   * expectedState snapshot taken before the async `produceDialogueTurn` call.
   */
  commitDialogueState(expected: GameState, next: GameState): boolean {
    if (this.state !== expected) return false;
    this.tracedSet(next, { kind: "action", sourceId: "commitDialogueState", label: "commitDialogueState" });
    return true;
  }

  /**
   * 将侍君打入冷宫（冷宫运行态 PUNISH-4A）。
   *
   * 创建 ColdPalaceEffect + PunishmentRecord（kind=cold_palace），
   * 将居所迁至冷宫，写史，触发后果效果。
   * punishmentId / statusEffectId 均由此处分配，调用方不得传入。
   */
  sendConsortToColdPalace(
    db: ContentDB,
    targetId: string,
    meta: PunishmentMeta,
  ): Result<{ baseLines: string[]; punishmentId: string }, GameError[]> {
    const standing = this.state.standing[targetId];
    const char = db.characters[targetId] ?? this.state.generatedConsorts[targetId];
    if (!char || char.kind !== "consort" || !standing) {
      const error = stateError("COLD_PALACE_INVALID", `no consort standing for target "${targetId}"`);
      this.logger?.logGameError(error);
      return err([error]);
    }
    if (standing.lifecycle === "deceased") {
      const error = stateError("COLD_PALACE_INVALID", `cannot send deceased consort to cold palace: "${targetId}"`);
      this.logger?.logGameError(error);
      return err([error]);
    }
    if (isInColdPalace(this.state, targetId)) {
      const error = stateError("COLD_PALACE_INVALID", `consort "${targetId}" is already in cold palace`);
      this.logger?.logGameError(error);
      return err([error]);
    }

    const alloc = allocateJusticeIds(this.state.justice, { punishments: 1 });
    const punishmentId = alloc.punishments[0]!;
    const statusEffectId = nextStatusEffectId(this.state, targetId);
    const now = toGameTime(this.state.calendar);
    const currentTurn = this.state.calendar.dayIndex;

    const previousResidenceId = getCharacterLocation(db, this.state, targetId);
    if (!previousResidenceId || previousResidenceId === "unknown") {
      const error = stateError("COLD_PALACE_INVALID", `cannot send "${targetId}" to cold palace: no known residence`);
      this.logger?.logGameError(error);
      return err([error]);
    }
    const previousChamber = standing.chamber;  // undefined means "main"
    const coldPalaceResidenceId = "changmengong";

    // Check if there is an active confinement to resolve in the same transaction.
    const activeConf = activeConfinement(this.state, targetId);
    const resolveConfinementMutations: Array<{
      type: "resolve_punishment";
      punishmentId: string;
      lifecycle: { status: "lifted"; resolvedAt: typeof now; resolution: "lifted_by_decree" };
    }> = activeConf?.sourcePunishmentId
      ? [{
          type: "resolve_punishment" as const,
          punishmentId: activeConf.sourcePunishmentId,
          lifecycle: { status: "lifted" as const, resolvedAt: now, resolution: "lifted_by_decree" as const },
        }]
      : [];

    const punishmentRecord = {
      id: punishmentId,
      targetKind: "consort" as const,
      kind: "cold_palace" as const,
      targetId,
      actorId: "player",
      severity: punishmentSeverity("cold_palace"),
      imposedAt: now,
      publicity: meta.publicity ?? "palace",
      lifecycle: { status: "active" as const },
      ...(meta.caseId ? { caseId: meta.caseId } : {}),
      ...(meta.sourceLocation ? { sourceLocation: meta.sourceLocation } : {}),
      details: {
        statusEffectId,
        previousResidenceId,
        ...(previousChamber !== undefined ? { previousChamber } : {}),
        coldPalaceResidenceId,
      },
    } satisfies PunishmentRecord;

    const justicePlan: JusticePlan = {
      mutations: [
        ...resolveConfinementMutations,
        { type: "create_punishment", record: punishmentRecord },
      ],
      nextSeq: alloc.nextSeq,
    };

    const ctx: PunishmentOutcomeContext = {
      punishmentId,
      ...(meta.caseId ? { caseId: meta.caseId } : {}),
      targetId,
      actorId: "player",
      kind: "cold_palace",
      severity: punishmentSeverity("cold_palace"),
      occurredAt: now,
      ...(meta.sourceLocation ? { sourceLocation: meta.sourceLocation } : {}),
      ...(meta.publicity ? { publicity: meta.publicity } : {}),
    };

    const conseq = planPunishmentConsequences(db, this.state, ctx);

    // Inject send_to_cold_palace effect and thread sourcePunishmentId into memory effects.
    const coldPalaceEffect = {
      type: "send_to_cold_palace" as const,
      char: targetId,
      statusEffectId,
      punishmentId,
      coldPalaceResidenceId,
      previousResidenceId,
      ...(previousChamber !== undefined ? { previousChamber } : {}),
      startedAt: now,
      startTurn: currentTurn,
    };

    // Primary memory for the target: trauma entry with sourcePunishmentId.
    const targetMemoryEffect: EventEffect = {
      type: "memory",
      char: targetId,
      entry: {
        kind: "trauma",
        summary: "臣被皇帝打入冷宫，此后幽居长门，不得见君颜。",
        strength: 90,
        retention: "permanent",
        subjectIds: ["player", targetId],
        perspective: "target",
        triggerTags: ["player", "cold_palace"],
        unresolved: true,
        emotions: { fear: 55, shame: 45 },
        sourcePunishmentId: punishmentId,
        ...(meta.caseId ? { sourceCaseId: meta.caseId } : {}),
      },
    };

    // If there is an active confinement, inject a lift_confinement effect so both the
    // ConfinementEffect and its PunishmentRecord are resolved in the same atomic transaction.
    // The resolve_punishment mutation (already in resolveConfinementMutations) handles the
    // PunishmentRecord side; this effect handles the ConfinementEffect side via the funnel.
    const liftConfinementEffects: Array<{ type: "lift_confinement"; char: string; at: typeof now; reason: "lifted_by_emperor" }> =
      activeConf ? [{ type: "lift_confinement" as const, char: targetId, at: now, reason: "lifted_by_emperor" as const }] : [];

    const augmentedEffects = [
      coldPalaceEffect,
      targetMemoryEffect,
      ...liftConfinementEffects,
      ...conseq.effects.map((e) => {
        if (e.type === "memory") {
          return { ...e, entry: { ...e.entry, sourcePunishmentId: punishmentId, ...(meta.caseId ? { sourceCaseId: meta.caseId } : {}) } };
        }
        return e;
      }),
    ];

    // Build primary chronicle entry directly (planPunishmentConsequences returns chronicle: []).
    const primaryChronicle: Omit<CourtEvent, "id">[] = [
      {
        type: "punished",
        occurredAt: now,
        participants: [{ charId: targetId, role: "punished" }],
        payload: {
          decree: "cold_palace_imposed",
          targetId,
          punishmentId,
          ...(meta.caseId ? { caseId: meta.caseId } : {}),
        },
        links: {
          punishmentId,
          ...(meta.caseId ? { caseId: meta.caseId } : {}),
        },
        publicity: { scope: "palace", persistence: "institutional" },
        publicSalience: 90,
        retention: "permanent",
        tags: ["imperial_decree", "cold_palace"],
      },
    ];

    // Thread sourcePunishmentId into any ancillary chronicle entries from consequence planner.
    const conseqChronicle = conseq.chronicle.map((draft) => ({
      ...draft,
      payload: { ...draft.payload, sourcePunishmentId: punishmentId },
      links: { sourcePunishmentId: punishmentId },
    }));

    const allChronicle = [...primaryChronicle, ...conseqChronicle];

    // Capture harem administration state before effects so we can detect changes post-apply.
    const prevHaremAdmin = structuredClone(this.state.haremAdministration);

    const txResult = this.commitPlannedTransaction(
      db,
      augmentedEffects,
      allChronicle,
      conseq.reactionBeats,
      { kind: "imperial_command", sourceId: "send_to_cold_palace", label: `cold palace: ${targetId}` },
      justicePlan,
      (newState) => {
        const newHaremAdmin = newState.haremAdministration;
        if (JSON.stringify(prevHaremAdmin) === JSON.stringify(newHaremAdmin)) return [];
        const newReason = newHaremAdmin.mode !== "empress" ? (newHaremAdmin as { reason?: string }).reason : undefined;
        return [{
          type: "harem_administration_changed" as const,
          occurredAt: now,
          participants: [],
          payload: {
            from: prevHaremAdmin.mode,
            to: newHaremAdmin.mode,
            ...(newHaremAdmin.mode === "acting_consort" ? { toCharId: (newHaremAdmin as { charId: string }).charId } : {}),
            ...(prevHaremAdmin.mode === "acting_consort" ? { fromCharId: (prevHaremAdmin as { charId: string }).charId } : {}),
            ...(newReason ? { reason: newReason } : {}),
            imposedOnId: targetId,
            punishmentId,
          },
          links: {
            sourcePunishmentId: punishmentId,
            ...(meta.caseId ? { caseId: meta.caseId } : {}),
          },
          publicity: { scope: "palace", persistence: "institutional" } as const,
          publicSalience: 70,
          retention: "permanent" as const,
          tags: ["harem_administration", "cold_palace"],
        }];
      },
      // 侍君打入冷宫（severe）→ 即时生成牵连家族待裁决策（折进同一提交）。
      this.withFamilyImplication(db, punishmentId),
    );
    if (!txResult.ok) return txResult;
    return ok({ baseLines: [], punishmentId });
  }

  /**
   * 从冷宫召回侍君（冷宫运行态 PUNISH-4A）。
   *
   * 解除 ColdPalaceEffect，恢复居所，结案 PunishmentRecord。
   */
  restoreFromColdPalace(
    db: ContentDB,
    targetId: string,
    liftReason: "lifted_by_emperor" | "pardoned",
    _meta?: { caseId?: string },
  ): Result<{ punishmentId: string }, GameError[]> {
    const restoreCheck = canRestoreFromColdPalace(this.state, targetId);
    if (!restoreCheck.ok) {
      const error = stateError("COLD_PALACE_INVALID", `cannot restore "${targetId}": ${restoreCheck.reason}`);
      this.logger?.logGameError(error);
      return err([error]);
    }
    const activeEffect = activeColdPalaceEffectFor(this.state, targetId);
    if (!activeEffect) {
      const error = stateError("COLD_PALACE_INVALID", `no active cold palace effect for "${targetId}"`);
      this.logger?.logGameError(error);
      return err([error]);
    }

    const now = toGameTime(this.state.calendar);
    const currentTurn = this.state.calendar.dayIndex;

    // Map lift reason to PunishmentLifecycle resolution.
    const punishmentResolution = liftReason === "pardoned" ? "pardoned" as const : "lifted_by_decree" as const;

    // Build justice plan to resolve the punishment.
    const resolveMutations = activeEffect.sourcePunishmentId
      ? [{
          type: "resolve_punishment" as const,
          punishmentId: activeEffect.sourcePunishmentId,
          lifecycle: { status: "lifted" as const, resolvedAt: now, resolution: punishmentResolution },
        }]
      : [];

    const alloc = allocateJusticeIds(this.state.justice, {});
    const justicePlan: JusticePlan | undefined = resolveMutations.length > 0
      ? { mutations: resolveMutations, nextSeq: alloc.nextSeq }
      : undefined;

    // ── Find restore destination ─────────────────────────────────────────────
    const prevRes = activeEffect.previousResidenceId;
    const prevChamber: ChamberId = (activeEffect.previousChamber as ChamberId | undefined) ?? "main";

    // Helper: is a (location, chamber) slot currently occupied by a living consort (excluding target)?
    const isSlotOccupied = (loc: string, ch: ChamberId) =>
      Object.entries(this.state.standing).some(
        ([id, s]) =>
          id !== targetId &&
          s.lifecycle !== "deceased" &&
          (getCharacterLocation(db, this.state, id) ?? s.residence) === loc &&
          ((s.chamber ?? "main") as ChamberId) === ch,
      );

    let restoreSlot: { res: string; ch: ChamberId } | null = null;

    if (!isSlotOccupied(prevRes, prevChamber)) {
      // Original slot available — restore there.
      restoreSlot = { res: prevRes, ch: prevChamber };
    } else {
      // Try to find any available slot in any chambered palace.
      outer: for (const palace of CHAMBERED_PALACE_ORDER) {
        for (const { id: chamberId } of CHAMBERS) {
          if (!isSlotOccupied(palace, chamberId)) {
            restoreSlot = { res: palace, ch: chamberId };
            break outer;
          }
        }
      }
    }

    if (!restoreSlot) {
      // No available slot — fail the entire restore.
      const error = stateError("COLD_PALACE_INVALID", `cannot restore "${targetId}" from cold palace: no available chamber`);
      this.logger?.logGameError(error);
      return err([error]);
    }

    const { res: restoreResidenceId, ch: restoreChamber } = restoreSlot;

    const restoreEffect = {
      type: "restore_from_cold_palace" as const,
      char: targetId,
      liftReason,
      restoreResidenceId,
      restoreChamber,
      liftedAt: now,
      liftedTurn: currentTurn,
    };

    // Derive caseId from the original PunishmentRecord for provenance integrity.
    const linkedPunishment = this.state.justice.punishments[activeEffect.sourcePunishmentId];
    const derivedCaseId = linkedPunishment?.caseId;

    const restoreChronicle: Omit<CourtEvent, "id">[] = [
      {
        type: "punished",
        occurredAt: now,
        participants: [{ charId: targetId, role: "pardoned" }],
        payload: {
          decree: "cold_palace_restored",
          targetId,
          sourcePunishmentId: activeEffect.sourcePunishmentId,
          liftReason,
          ...(derivedCaseId ? { caseId: derivedCaseId } : {}),
        },
        links: {
          sourcePunishmentId: activeEffect.sourcePunishmentId,
          ...(derivedCaseId ? { caseId: derivedCaseId } : {}),
        },
        publicity: { scope: "palace", persistence: "institutional" },
        publicSalience: 70,
        retention: "permanent",
        tags: ["imperial_decree", "cold_palace", "restored"],
      },
    ];

    const txResult = this.commitPlannedTransaction(
      db,
      [restoreEffect],
      restoreChronicle,
      [],
      { kind: "imperial_command", sourceId: "restore_from_cold_palace", label: `restore from cold palace: ${targetId}` },
      justicePlan,
      undefined,
      (s) => {
        // Auto-resolve any pending critical_illness incident for this resident
        // (restore makes medical intervention moot).
        const hasPending = s.coldPalaceIncidents.some(
          (i) => i.residentId === targetId && i.kind === "critical_illness" && !i.acknowledged,
        );
        if (!hasPending) return s;
        const resolvedAt = toGameTime(s.calendar);
        return {
          ...s,
          coldPalaceIncidents: s.coldPalaceIncidents.map((i) =>
            i.residentId === targetId && i.kind === "critical_illness" && !i.acknowledged
              ? ({
                  ...(i as ColdPalaceCriticalIllnessIncident),
                  status: "resolved" as const,
                  resolution: "restored" as const,
                  resolvedAt,
                  acknowledged: true,
                } satisfies ColdPalaceCriticalIllnessIncident)
              : i,
          ),
        };
      },
    );
    if (!txResult.ok) return txResult;
    return ok({ punishmentId: activeEffect.sourcePunishmentId ?? "" });
  }

  private lastEffectReport: EffectReport | null = null;

  private commit(result: CommandResult): CommandResult {
    if (result.ok) {
      this.state = result.value.state;
      this.emit();
    } else {
      // Rejected commands change nothing and are never silent (skeleton-plan §10).
      this.logger?.logGameError(result.error);
    }
    return result;
  }

  /**
   * 严重病情决策（PUNISH-4D）。
   *
   * physician: 通过 planHealthChange 施加 +PHYSICIAN_RECOVERY_DELTA 健康回复。
   * ignore:    通过 planHealthChange 施加确定性负值 delta（可致死）。
   * 两者均原子提交：失败不修改 state，成功仅 emit 一次。
   * 已 resolved 的 incident 重复调用返回错误（幂等失败）。
   */
  resolveColdPalaceCriticalIncident(
    db: ContentDB,
    incidentId: string,
    choice: "physician" | "ignore",
  ): Result<void, GameError[]> {
    const incidentIdx = this.state.coldPalaceIncidents.findIndex((i) => i.id === incidentId);
    if (incidentIdx === -1) {
      return err([stateError("COLD_PALACE_INVALID", `cold palace incident "${incidentId}" not found`)]);
    }
    const incident = this.state.coldPalaceIncidents[incidentIdx]!;
    if (incident.kind !== "critical_illness") {
      return err([stateError("COLD_PALACE_INVALID", `incident "${incidentId}" is not critical_illness (got ${incident.kind})`)]);
    }
    if (incident.status === "resolved") {
      return err([stateError("COLD_PALACE_INVALID", `incident "${incidentId}" is already resolved`)]);
    }

    const now = toGameTime(this.state.calendar);

    // Deceased or missing resident: cannot apply health effect — reject rather than
    // creating a resolved incident without the required healthDelta (which would violate
    // the validator). Stale critical incidents are excluded by oldestPresentableIncident()
    // so they cannot block the queue; no state mutation, no emit.
    const standing = this.state.standing[incident.residentId];
    if (!standing || standing.lifecycle === "deceased") {
      return err([stateError("COLD_PALACE_INVALID", `incident "${incidentId}": resident "${incident.residentId}" is deceased or missing — cannot apply health effect`)]);
    }

    const healthDelta =
      choice === "physician"
        ? PHYSICIAN_RECOVERY_DELTA
        : criticalIgnoreDelta(
            this.state.rngSeed,
            incident.residentId,
            incident.occurredAt.year,
            incident.occurredAt.month,
          );

    const { effects } = planHealthChange(this.state, {
      subject: { kind: "consort", id: incident.residentId },
      healthDelta,
      cause: "illness",
      at: now,
    });

    const resolvedIncident: ColdPalaceCriticalIllnessIncident = {
      ...incident,
      status: "resolved",
      resolution: choice,
      resolvedAt: now,
      acknowledged: true,
      healthDelta,
    };

    const txResult = this.commitPlannedTransaction(
      db,
      effects,
      [],
      [],
      { kind: "imperial_command", sourceId: "resolve_cold_palace_critical_illness", label: `critical illness ${incidentId}: ${choice}` },
      undefined,
      undefined,
      (s) => ({
        ...s,
        coldPalaceIncidents: s.coldPalaceIncidents.map((i, idx) =>
          idx === incidentIdx ? resolvedIncident : i,
        ),
      }),
    );
    if (!txResult.ok) return err(txResult.error);
    return ok(undefined);
  }

  /**
   * 玩家干预长门宫（PUNISH-4E）。
   *
   * personal_visit: 向居民施加恩宠+COLD_PALACE_VISIT_FAVOR_DELTA（记录实际 delta）。
   * physician:      向居民施加健康+COLD_PALACE_PHYSICIAN_HEALTH_DELTA（planHealthChange 计算实际值）。
   *
   * 全程原子：effects + AP + 跨旬结算 + intervention record append = 一次 commit + 一次 emit。
   * 返回 TimedOutcome 供调用方处理跨旬/驾崩/懿旨等行动节拍。
   * 不满足 canInterveneInColdPalace 的所有情形均返回 err（含空效果拒绝）。
   */
  interveneInColdPalace(
    db: ContentDB,
    charId: string,
    kind: "personal_visit" | "physician",
  ): Result<TimedOutcome, GameError[]> {
    if (!canInterveneInColdPalace(this.state, charId, kind)) {
      const { year, month } = this.state.calendar;
      const standing = this.state.standing[charId];
      if (!standing || standing.lifecycle === "deceased" || standing.lifecycle === "candidate") {
        return err([stateError("COLD_PALACE_INVALID", `"${charId}" is not an active resident`)]);
      }
      if (this.state.calendar.ap < COLD_PALACE_INTERVENTION_AP_COST) {
        return err([stateError("COLD_PALACE_INVALID", `insufficient AP for cold palace intervention (need ${COLD_PALACE_INTERVENTION_AP_COST}, have ${this.state.calendar.ap})`)]);
      }
      if (this.state.coldPalaceInterventions.some(
        (i) => i.residentId === charId && i.occurredAt.year === year && i.occurredAt.month === month,
      )) {
        return err([stateError("COLD_PALACE_INVALID", `"${charId}" already received an intervention this month (${year}-${String(month).padStart(2, "0")})`)]);
      }
      const hasPending = this.state.coldPalaceIncidents.some(
        (i) => i.residentId === charId && i.kind === "critical_illness" && i.status === "pending_response",
      );
      if (hasPending) {
        return err([stateError("COLD_PALACE_INVALID", `"${charId}" has a pending critical illness — resolve it first`)]);
      }
      const hasCriticalThisMonth = this.state.coldPalaceIncidents.some(
        (i) => i.residentId === charId && i.kind === "critical_illness" &&
               i.occurredAt.year === year && i.occurredAt.month === month,
      );
      if (hasCriticalThisMonth) {
        return err([stateError("COLD_PALACE_INVALID", `"${charId}" had a critical illness this month — intervention not allowed`)]);
      }
      if (kind === "physician" && (standing.health ?? 100) >= 100) {
        return err([stateError("COLD_PALACE_INVALID", `"${charId}" health is already at maximum`)]);
      }
      if (kind === "personal_visit" && (standing.favor ?? 0) >= 100) {
        return err([stateError("COLD_PALACE_INVALID", `"${charId}" favor is already at maximum`)]);
      }
      return err([stateError("COLD_PALACE_INVALID", `"${charId}" is not currently in the cold palace`)]);
    }

    // Build intervention record base (ID, effectId, occurredAt) before AP spend.
    const { year, month, period, dayIndex } = this.state.calendar;
    const activeEffect = activeColdPalaceEffectFor(this.state, charId, dayIndex)!;
    const occurredAt = { year, month, period, dayIndex };
    const interventionId = coldPalaceInterventionId(charId, year, month);
    const now = toGameTime(this.state.calendar);

    let actionEffects: readonly EventEffect[];
    let intervention: ColdPalaceIntervention;

    if (kind === "personal_visit") {
      const currentFavor = this.state.standing[charId]?.favor ?? 0;
      const actualFavorDelta = Math.min(100, currentFavor + COLD_PALACE_VISIT_FAVOR_DELTA) - currentFavor;
      actionEffects = [{ type: "favor", char: charId, delta: actualFavorDelta } as EventEffect];
      intervention = { id: interventionId, residentId: charId, effectId: activeEffect.id, kind: "personal_visit", occurredAt, favorDelta: actualFavorDelta };
    } else {
      const { effects: healthEffects, outcome } = planHealthChange(this.state, {
        subject: { kind: "consort", id: charId },
        healthDelta: COLD_PALACE_PHYSICIAN_HEALTH_DELTA,
        cause: "illness",
        at: now,
      });
      const actualHealthDelta = outcome.nextHealth - outcome.previousHealth;
      actionEffects = healthEffects;
      intervention = { id: interventionId, residentId: charId, effectId: activeEffect.id, kind: "physician", occurredAt, healthDelta: actualHealthDelta };
    }

    // Single atomic transaction: effects + AP + settlement + record append = one commit, one emit.
    return this.resolveTimedActionWithPostAdvance(
      db,
      actionEffects,
      { type: "SPEND_AP", amount: COLD_PALACE_INTERVENTION_AP_COST },
      (s) => ({ ...s, coldPalaceInterventions: [...s.coldPalaceInterventions, intervention] }),
    );
  }

  /**
   * 标记冷宫事件通报为已确认（PUNISH-4C）。
   * 返回 true 仅当首次确认（previously unacknowledged）；已确认或未找到返回 false 且不 emit。
   * App 只在返回 true 时 doAutosave，避免重复写盘。
   */
  acknowledgeIncident(incidentId: string): boolean {
    const idx = this.state.coldPalaceIncidents.findIndex(
      (i) => i.id === incidentId && !i.acknowledged,
    );
    if (idx === -1) return false;
    const updated = [...this.state.coldPalaceIncidents];
    updated[idx] = { ...updated[idx]!, acknowledged: true };
    this.state = { ...this.state, coldPalaceIncidents: updated };
    this.emit();
    return true;
  }

  /** 标记六宫年度例核禀报为已阅（玩家按「知道了」后调用）。 */
  resolveHaremDisciplineIncident(
    db: ContentDB,
    input: ResolveHaremDisciplineInput,
  ): Result<void, GameError[]> {
    const result = resolveHaremDiscipline(db, this.state, input);
    if (!result.ok) return err(result.error);
    this.state = result.value;
    this.emit();
    return ok(undefined);
  }

  acknowledgeHaremIntrigueReport(reportId: string): Result<void, GameError[]> {
    const idx = this.state.haremIntrigueReports.findIndex((r) => r.id === reportId);
    if (idx === -1) return err([stateError("REPORT_NOT_FOUND", `haremIntrigueReport "${reportId}" not found`)]);
    const report = this.state.haremIntrigueReports[idx]!;
    if (report.status === "acknowledged") return ok(undefined); // idempotent
    if (report.status !== "unread") {
      return err([stateError("REPORT_BAD_STATUS", `haremIntrigueReport "${reportId}" status="${report.status}" cannot be acknowledged`)]);
    }
    const updated = [...this.state.haremIntrigueReports];
    updated[idx] = { ...report, status: "acknowledged", acknowledgedAt: toGameTime(this.state.calendar) };
    this.state = { ...this.state, haremIntrigueReports: updated };
    this.emit();
    return ok(undefined);
  }

  openHaremInvestigation(reportId: string): Result<{ caseId: string }, GameError[]> {
    const at = toGameTime(this.state.calendar);
    const result = createIntrigueInvestigationCase(this.state, reportId, at);
    if (!result.ok) return result;
    this.state = result.value.state;
    this.emit();
    return ok({ caseId: result.value.caseId });
  }

  cancelHaremInvestigation(caseId: string): Result<void, GameError[]> {
    const at = toGameTime(this.state.calendar);
    const result = cancelIntrigueInvestigationCase(this.state, caseId, at);
    if (!result.ok) return result;
    this.state = result.value;
    this.emit();
    return ok(undefined);
  }

  /**
   * 开始一个调查任务：校验 → 扣 AP → 写入 task → 更新案件状态。
   * 通过 resolveTimedActionWithPostAdvance 原子提交，AP 不足时完整回滚。
   */
  startHaremInvestigationTask(
    db: ContentDB,
    caseId: string,
    method: InvestigationMethod,
    subjectId?: string,
  ): Result<{ taskId: string }, GameError[]> {
    const c = this.state.haremInvestigationCases.find((x) => x.id === caseId);
    if (!c) {
      return err([stateError("INTRIGUE_CASE_NOT_FOUND", `haremInvestigationCases: case "${caseId}" not found`)]);
    }

    const validationError = validateCanStartTask(this.state, c, method, subjectId);
    if (validationError) {
      return err([stateError("INTRIGUE_TASK_INVALID", validationError)]);
    }

    const apCost = INVESTIGATION_METHOD_AP[method];
    const durationDays = INVESTIGATION_METHOD_DAYS[method];

    // requestedAt 必须在扣 AP / 推进日历之前确定，否则会多延迟一旬（B1 修复）
    const requestedAt = toGameTime(this.state.calendar);
    const dueAt = fromTurnIndex(requestedAt.dayIndex + durationDays);
    const taskId = nextTaskId(this.state.haremInvestigationNextSeq);

    const result = this.resolveTimedActionWithPostAdvance(
      db,
      [],
      { type: "SPEND_AP", amount: apCost },
      (s) => s, // postAdvance: identity（task 已在 preAdvance 写入）
      (s) => {
        // preAdvance：在扣 AP 之前写入 task，保证 requestedAt 为当前旬
        const newTask = {
          id: taskId,
          caseId,
          method,
          subjectId,
          requestedAt,
          dueAt,
          status: "pending" as const,
        };
        const caseIdx = s.haremInvestigationCases.findIndex((x) => x.id === caseId);
        const updatedCases = [...s.haremInvestigationCases];
        updatedCases[caseIdx] = { ...s.haremInvestigationCases[caseIdx]!, status: "in_progress" };
        return {
          ...s,
          haremInvestigationTasks: { ...s.haremInvestigationTasks, [taskId]: newTask },
          haremInvestigationNextSeq: s.haremInvestigationNextSeq + 1,
          haremInvestigationCases: updatedCases,
        };
      },
    );
    if (!result.ok) return err(result.error);
    return ok({ taskId });
  }

  /**
   * 裁定调查结果：确认主谋 / 结案不明 / 继续调查。
   * 只在 ready_for_review 状态且满足约束时允许。
   */
  reviewHaremInvestigation(
    caseId: string,
    decision:
      | { type: "continue" }
      | { type: "close_unresolved" }
      | { type: "confirm"; suspectId: string },
  ): Result<void, GameError[]> {
    const at = toGameTime(this.state.calendar);
    const c = this.state.haremInvestigationCases.find((x) => x.id === caseId);
    if (!c) {
      return err([stateError("INTRIGUE_CASE_NOT_FOUND", `haremInvestigationCases: case "${caseId}" not found`)]);
    }
    if (c.status !== "ready_for_review") {
      return err([stateError("INTRIGUE_CASE_WRONG_STATUS", `案件 "${caseId}" 状态 "${c.status}" 不可裁定，须为 ready_for_review`)]);
    }

    const idx = this.state.haremInvestigationCases.findIndex((x) => x.id === caseId);
    let updated: typeof c;

    if (decision.type === "continue") {
      updated = { ...c, status: "open" };
    } else if (decision.type === "close_unresolved") {
      updated = { ...c, status: "closed_unresolved", closedAt: at, closureReason: "insufficient_evidence" };
    } else {
      // confirm
      if (c.confidence !== "confirmed") {
        return err([stateError("INTRIGUE_CASE_CONFIRM_REQUIRES_CONFIRMED", `案件 "${caseId}" 置信度 "${c.confidence}" 须为 confirmed 才能确认主谋`)]);
      }
      if (!c.suspectIds.includes(decision.suspectId)) {
        return err([stateError("INTRIGUE_CASE_SUSPECT_NOT_FOUND", `"${decision.suspectId}" 不在当前嫌疑人名单 suspectIds 中`)]);
      }
      updated = { ...c, status: "closed_confirmed", closedAt: at, closureReason: "culprit_confirmed", confirmedCulpritId: decision.suspectId };
    }

    const cases = [...this.state.haremInvestigationCases];
    cases[idx] = updated;
    this.state = { ...this.state, haremInvestigationCases: cases };
    this.emit();
    return ok(undefined);
  }

  /** 仅暴露供 UI 使用，不写 state。 */
  getAvailableInvestigationActions(caseId: string) {
    return availableInvestigationActions(this.state, caseId);
  }

  acknowledgeHaremAdminReview(reviewId: string): boolean {
    const idx = this.state.haremAdminReviews.findIndex(
      (r) => r.id === reviewId && !r.acknowledged,
    );
    if (idx === -1) return false;
    const updated = [...this.state.haremAdminReviews];
    updated[idx] = { ...updated[idx]!, acknowledged: true };
    this.state = { ...this.state, haremAdminReviews: updated };
    this.emit();
    return true;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createGameStore(options: GameStoreOptions = {}): GameStore {
  return new GameStore(options);
}
