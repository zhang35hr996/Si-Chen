/**
 * Engine↔React bridge (DESIGN §2.1: "a 50-line emitter", no state library).
 * Plain TS — React coupling lives only in useGameState.ts.
 */
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import { applyEffects } from "../engine/effects/funnel";
import { resolveEvent, type EventResolution } from "../engine/events/resolve";
import { stateError, type GameError } from "../engine/infra/errors";
import type { RingBufferLogger } from "../engine/infra/logger";
import { err, ok, type Result } from "../engine/infra/result";
import { fromTurnIndex, monthOrdinal, toGameTime } from "../engine/calendar/time";
import { expiredUnrecordedConfinements } from "../engine/characters/confinement";
import { appendCourtEvent } from "../engine/chronicle/append";
import { planImperialCommand, type ImperialCommand, type ImperialCommandPlan } from "./imperialCommands";
import { planHaremAdminRankCommand, type HaremAdminRankCommand, type HaremAdminCommandPlan } from "./haremAdminCommands";
import type { CourtEvent } from "../engine/state/types";
import type { GameCommand } from "../engine/state/commands";
import { createInitialState, type InitialStateOverrides } from "../engine/state/initialState";
import { createNewGameState } from "../engine/state/newGame";
import { applyBatch, applyCommand, type CommandResult } from "../engine/state/reducer";
import type { GameState, PendingDaxuan } from "../engine/state/types";
import { buildMonthlyHealthTick, type MonthlyTickResult } from "./healthTick";
import { assignOfficialPost } from "../engine/officials/assign";
import { bestow, grantItem, spendCoins, type RecipientKind, type BestowResult } from "./treasury";
import { huntFurs, autumnHuntFlagKey } from "./autumnHunt";
import {
  addGeneratedConsort, daxuanAnnounceBeats, daxuanAnnounceFlagKey, daxuanDianxuanDueForYear,
  daxuanDianxuanFlagKey, initialFavorForRank, isPendingDaxuanResolved, matchesPendingDianxuan,
  nextPendingDaxuan, type KeptConsort,
} from "./grandSelection";
import type { DecreeReaction } from "./empressDecree";
import { excuseFromGreeting, dismissOvernight, recordOvernight } from "./greeting";

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
}

export class GameStore {
  private state: GameState;
  private readonly listeners = new Set<() => void>();
  private readonly logger: RingBufferLogger | undefined;

  constructor(options: GameStoreOptions = {}) {
    this.logger = options.logger;
    this.state = createInitialState(options.initial);
  }

  getState = (): GameState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(command: GameCommand): CommandResult {
    return this.commit(applyCommand(this.state, command));
  }

  dispatchBatch(commands: readonly GameCommand[]): CommandResult {
    return this.commit(applyBatch(this.state, commands));
  }

  reset(overrides: InitialStateOverrides = {}): void {
    this.state = createInitialState(overrides);
    this.emit();
  }

  /** Start a fresh playthrough from validated content (skeleton-plan §5). */
  newGame(db: ContentDB): void {
    this.state = createNewGameState(db);
    this.lastEffectReport = null;
    this.emit();
  }

  /** Replace state with a save-system-validated GameState (load/import). */
  loadState(state: GameState): void {
    this.state = state;
    this.lastEffectReport = null;
    this.emit();
  }

  /** 登基设定年号（写入 calendar.eraName）。 */
  setEraName(name: string): void {
    this.state = { ...this.state, calendar: { ...this.state.calendar, eraName: name } };
    this.emit();
  }

  /**
   * 安全任免官职（→品级→权势派生跟随）。经 assignOfficialPost 校验席位/存在/状态，
   * 仅在 ok 时落库；返回 Result 供调用方处理错误（v1 无 UI 调用方，仅留接口）。
   */
  assignOfficialPost(db: ContentDB, officialId: string, newPostId: string | null): Result<void, GameError> {
    const result = assignOfficialPost(this.state, db, officialId, newPostId);
    if (!result.ok) return result;
    this.state = result.value;
    this.emit();
    return ok(undefined);
  }

  /** 赏赐：扣库存并提升目标恩宠/好感（不耗行动点）。 */
  applyBestow(db: ContentDB, itemId: string, recipient: { kind: RecipientKind; id: string }): BestowResult {
    const result = bestow(this.state, db, itemId, recipient);
    if (result.ok) { this.state = result.state; this.emit(); }
    return result;
  }

  /** 直接入库指定物品。 */
  applyGrantItem(itemId: string, count = 1): void {
    this.state = grantItem(this.state, itemId, count);
    this.emit();
  }

  /** 扣钱后入库；钱不足返回 false，state 不变。 */
  buyItem(itemId: string, price: number): boolean {
    const paid = spendCoins(this.state, price);
    if (!paid.ok) return false;
    this.state = grantItem(paid.state, itemId, 1);
    this.emit();
    return true;
  }

  /** 按当前武力掷皮毛入库 + 设年度 flag；返回所得物品 id 列表。 */
  applyAutumnHunt(seedKey: string): string[] {
    const furs = huntFurs(this.state.resources.sovereign.martial, seedKey);
    let next = this.state;
    for (const id of furs) next = grantItem(next, id, 1);
    next = { ...next, flags: { ...next.flags, [autumnHuntFlagKey(next.calendar.year)]: true } };
    this.state = next;
    this.emit();
    return furs;
  }

  /** 拒绝秋猎，仅设年度 flag。 */
  declineAutumnHunt(): void {
    const year = this.state.calendar.year;
    this.state = { ...this.state, flags: { ...this.state.flags, [autumnHuntFlagKey(year)]: true } };
    this.emit();
  }

  /** 设/清一个布尔 flag（大选一次性标记）。 */
  setFlag(key: string, value: boolean): void {
    this.state = { ...this.state, flags: { ...this.state.flags, [key]: value } };
    this.emit();
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
    if (this.state.flags[daxuanAnnounceFlagKey(pd.year)]) {
      this.state = { ...this.state, pendingDaxuan: undefined }; // 陈旧调和
      this.emit();
      return [];
    }
    const flags = { ...this.state.flags, [daxuanAnnounceFlagKey(pd.year)]: true };
    const chained: PendingDaxuan | undefined = daxuanDianxuanDueForYear({ ...this.state, flags }, pd.year)
      ? { kind: "dianxuan", year: pd.year }
      : undefined;
    this.state = { ...this.state, flags, pendingDaxuan: chained };
    this.emit();
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
    this.state = {
      ...this.state,
      flags: { ...this.state.flags, [daxuanDianxuanFlagKey(year)]: true },
      pendingDaxuan: undefined,
    };
    this.emit();
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
    this.state = { ...this.state, pendingDaxuan: undefined };
    this.emit();
  }

  /** 施恩免请安（不耗行动点）。 */
  applyExcuseGreeting(db: ContentDB, charId: string): void {
    this.state = excuseFromGreeting(this.state, db, charId);
    this.emit();
  }

  /** 「不说」：清留宿，侍君照常请安。 */
  dismissOvernight(): void {
    this.state = dismissOvernight(this.state);
    this.emit();
  }

  /** 子时侍寝/对话滚旬后记留宿（条件不满足则无副作用）。 */
  recordOvernight(db: ContentDB, charId: string, rolledOver: boolean): void {
    const next = recordOvernight(this.state, db, charId, rolledOver);
    if (next !== this.state) {
      this.state = next;
      this.emit();
    }
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
    this.state = batch.value;
    this.emit();
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
    const batch = this.applyConsortBatch(db, kept);
    if (!batch.ok) return batch;
    this.state = {
      ...batch.value,
      flags: { ...batch.value.flags, [daxuanDianxuanFlagKey(year)]: true },
      pendingDaxuan: undefined,
    };
    this.emit();
    return ok(undefined);
  }

  /** 先入库 1 件再赏赐；bestow 失败返回 false，state 不变。 */
  giftTribute(db: ContentDB, itemId: string, recipient: { kind: RecipientKind; id: string }): boolean {
    const granted = grantItem(this.state, itemId, 1);
    const result = bestow(granted, db, itemId, recipient);
    if (!result.ok) return false;
    this.state = result.state;
    this.emit();
    return true;
  }

  /**
   * THE single entry point for gameplay-state changes (skeleton-plan §6):
   * relationships, favor, resources, memory, and flags change only here,
   * through the effect funnel. Atomic: rejection leaves the state reference
   * untouched, notifies no one, and logs every collected error once.
   */
  applyEffects(db: ContentDB, effects: readonly EventEffect[]): Result<GameState, GameError[]> {
    const result = applyEffects(db, this.state, effects);
    if (result.ok) {
      this.state = result.value;
      this.lastEffectReport = { effects, outcome: "applied", errors: [] };
      this.emit();
    } else {
      for (const error of result.error) this.logger?.logGameError(error);
      this.lastEffectReport = { effects, outcome: "rejected", errors: result.error };
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
    const planned = planImperialCommand(db, this.state, command);
    if (!planned.ok) {
      const error = stateError("IMPERIAL_COMMAND_REJECTED", planned.reason);
      this.logger?.logGameError(error);
      return err([error]);
    }
    const plan = planned.plan;
    const applied = applyEffects(db, this.state, plan.effects);
    if (!applied.ok) {
      for (const e of applied.error) this.logger?.logGameError(e);
      this.lastEffectReport = { effects: plan.effects, outcome: "rejected", errors: applied.error };
      return err(applied.error);
    }
    let candidate = applied.value;
    for (const draft of plan.chronicle) {
      const ap = appendCourtEvent(candidate, draft);
      if (!ap.ok) {
        for (const e of ap.error) this.logger?.logGameError(e);
        return err(ap.error); // this.state untouched — atomic
      }
      candidate = ap.value.state;
    }
    this.state = candidate;
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
    const planned = planHaremAdminRankCommand(db, this.state, command);
    if (!planned.ok) {
      const error = stateError("HAREM_ADMIN_RANK_REJECTED", planned.reason);
      this.logger?.logGameError(error);
      return err([error]);
    }
    const plan = planned.plan;
    const applied = applyEffects(db, this.state, plan.effects);
    if (!applied.ok) {
      for (const e of applied.error) this.logger?.logGameError(e);
      this.lastEffectReport = { effects: plan.effects, outcome: "rejected", errors: applied.error };
      return err(applied.error);
    }
    let candidate = applied.value;
    for (const draft of plan.chronicle) {
      const ap = appendCourtEvent(candidate, draft);
      if (!ap.ok) {
        for (const e of ap.error) this.logger?.logGameError(e);
        return err(ap.error); // this.state untouched — atomic
      }
      candidate = ap.value.state;
    }
    this.state = candidate;
    this.lastEffectReport = { effects: plan.effects, outcome: "applied", errors: [] };
    this.emit();
    return ok(plan);
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
    const result = resolveEvent(db, this.state, eventId, effects);
    if (result.ok) {
      this.state = result.value.state;
      this.lastEffectReport = { effects, outcome: "applied", errors: [] };
      this.emit();
    } else {
      for (const error of result.error) this.logger?.logGameError(error);
      this.lastEffectReport = { effects, outcome: "rejected", errors: result.error };
    }
    return result;
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
    // 1) action effects on a local candidate (subject still alive)
    let candidate = this.state;
    if (actionEffects.length > 0) {
      const a = applyEffects(db, candidate, actionEffects);
      if (!a.ok) return err(a.error);
      candidate = a.value;
    }
    return this.advanceCandidate(db, candidate, command);
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
    // 1) MOVE on a local candidate (no time advances yet — subject still where they were)
    let candidate = this.state;
    if (moveCommands.length > 0) {
      const m = applyBatch(candidate, moveCommands);
      if (!m.ok) return err([m.error]);
      candidate = m.value.state;
    }
    return this.advanceCandidate(db, candidate, advanceCommand);
  }

  /**
   * Shared core: advance the calendar on `candidate`, run the cross-month health
   * tick, write gameOver on sovereign death, then commit ONCE. Atomic: any
   * failure returns err and leaves `this.state` untouched.
   */
  private advanceCandidate(
    db: ContentDB,
    candidateIn: GameState,
    command: { type: "SPEND_AP"; amount: number } | { type: "SKIP_REMAINDER" },
  ): Result<TimedOutcome, GameError[]> {
    let candidate = candidateIn;
    // 2) advance the calendar (pure reducer) on the candidate
    const before = monthOrdinal(candidate.calendar);
    const cmd = applyCommand(candidate, command);
    if (!cmd.ok) return err([cmd.error]);
    candidate = cmd.value.state;
    const monthChanged = monthOrdinal(candidate.calendar) !== before;
    // 3) cross-month health tick (the tick may throw on an unresolvable subject)
    let healthOutcome: MonthlyTickResult | null = null;
    if (monthChanged) {
      try {
        healthOutcome = buildMonthlyHealthTick(db, candidate);
      } catch (e) {
        return err([stateError("HEALTH_TICK_FAILED", String(e))]);
      }
      const h = applyEffects(db, candidate, healthOutcome.effects);
      if (!h.ok) return err(h.error);
      candidate = h.value;
      // 4) emperor death → gameOver in the SAME transaction (App must not write it)
      if (healthOutcome.sovereignDied) {
        candidate = { ...candidate, gameOver: { cause: "sovereign_death", at: toGameTime(candidate.calendar) } };
      }
    }
    // 5) 统一探测/调和大选日历事件，使触发与具体行动路径（SPEND_AP / SKIP_REMAINDER /
    //    travel / resolveTimedAction）解耦。先调和陈旧（对应 flag 已置）以免 sticky 永久
    //    阻塞下一大选年；再于无待消费态时按到点（catch-up）置位。sticky：未决则保留。
    if (candidate.pendingDaxuan && isPendingDaxuanResolved(candidate, candidate.pendingDaxuan)) {
      candidate = { ...candidate, pendingDaxuan: undefined };
    }
    if (candidate.pendingDaxuan === undefined) {
      const pd = nextPendingDaxuan(candidate);
      if (pd) candidate = { ...candidate, pendingDaxuan: pd };
    }
    // 6) 有期限禁足自动到期：在新旬开始时（早于一切候选生成）结案并记一次史。
    const swept = this.sweepExpiredConfinements(db, candidate);
    if (!swept.ok) return err(swept.error);
    candidate = swept.value;
    // single commit + single notify — only after every step succeeded
    this.state = candidate;
    this.emit();
    return ok({ rolledOver: cmd.value.rolledOver, monthChanged, healthOutcome });
  }

  /**
   * 结案所有「已到期但未记史」的有期限禁足：通过漏斗写 liftedTurn=endTurnExclusive
   * （term_expired），并对每条 append 一次 confinement_expired 编年史。幂等：已 lifted
   * 的记录被排除，故重复加载/重复推进不会重复触发（任务 §6/§12）。
   */
  private sweepExpiredConfinements(
    db: ContentDB,
    state: GameState,
  ): Result<GameState, GameError[]> {
    const expired = expiredUnrecordedConfinements(state);
    if (expired.length === 0) return ok(state);
    const at = toGameTime(state.calendar);
    const chars = [...new Set(expired.map((e) => e.characterId))];
    const applied = applyEffects(
      db,
      state,
      chars.map((char) => ({ type: "lift_confinement" as const, char, at, reason: "term_expired" as const })),
    );
    if (!applied.ok) return err(applied.error);
    let cur = applied.value;
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
        },
        publicity: { scope: "palace", persistence: "institutional" },
        publicSalience: 40,
        retention: "slow",
        tags: ["imperial_decree", "confinement_expired"],
      };
      const ap = appendCourtEvent(cur, draft);
      if (!ap.ok) return err(ap.error);
      cur = ap.value.state;
      // 凤后禁足到期：附加「复掌六宫」编年史（主理权已由漏斗 lift_confinement 自动归还）。
      if (cur.standing[e.characterId]?.rank === "fenghou") {
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
    this.state = next;
    this.emit();
    return true;
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

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createGameStore(options: GameStoreOptions = {}): GameStore {
  return new GameStore(options);
}
