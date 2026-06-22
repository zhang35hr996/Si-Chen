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
import { monthOrdinal, toGameTime } from "../engine/calendar/time";
import type { GameCommand } from "../engine/state/commands";
import { createInitialState, type InitialStateOverrides } from "../engine/state/initialState";
import { createNewGameState } from "../engine/state/newGame";
import { applyBatch, applyCommand, type CommandResult } from "../engine/state/reducer";
import type { GameState } from "../engine/state/types";
import { buildMonthlyHealthTick, type MonthlyTickResult } from "./healthTick";
import { changeOfficialGrade } from "../engine/officials/changeGrade";
import { bestow, grantItem, spendCoins, type RecipientKind, type BestowResult } from "./treasury";
import { huntFurs, autumnHuntFlagKey } from "./autumnHunt";
import { addGeneratedConsort, initialFavorForRank, type Candidate, type KeptConsort } from "./grandSelection";
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

  /** 改某官员官职（→品级→权势派生跟随）。v1 无 UI 调用方，仅留接口。 */
  changeOfficialGrade(officialId: string, newPostId: string): void {
    this.state = changeOfficialGrade(this.state, officialId, newPostId);
    this.emit();
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

  /** 殿选留牌子：按所选位分落库一位秀男（恩宠随位分缩放）。 */
  commitDaxuanConsort(db: ContentDB, candidate: Candidate, rank: string): void {
    const favor = initialFavorForRank(db.ranks[rank]?.order ?? 50);
    this.state = addGeneratedConsort(this.state, candidate.content, rank, favor);
    this.emit();
  }

  /** 批量落库 NPC 留下的秀男（按各自推荐位分）。 */
  commitDaxuanKept(db: ContentDB, kept: KeptConsort[]): void {
    let next = this.state;
    for (const k of kept) {
      const favor = initialFavorForRank(db.ranks[k.rank]?.order ?? 50);
      next = addGeneratedConsort(next, k.candidate.content, k.rank, favor);
    }
    this.state = next;
    this.emit();
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
    // single commit + single notify — only after every step succeeded
    this.state = candidate;
    this.emit();
    return ok({ rolledOver: cmd.value.rolledOver, monthChanged, healthOutcome });
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
