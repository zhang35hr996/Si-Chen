/**
 * Engine↔React bridge (DESIGN §2.1: "a 50-line emitter", no state library).
 * Plain TS — React coupling lives only in useGameState.ts.
 */
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import { applyEffects } from "../engine/effects/funnel";
import { resolveEvent, type EventResolution } from "../engine/events/resolve";
import type { GameError } from "../engine/infra/errors";
import type { RingBufferLogger } from "../engine/infra/logger";
import type { Result } from "../engine/infra/result";
import type { GameCommand } from "../engine/state/commands";
import { createInitialState, type InitialStateOverrides } from "../engine/state/initialState";
import { createNewGameState } from "../engine/state/newGame";
import { applyBatch, applyCommand, type CommandResult } from "../engine/state/reducer";
import type { GameState } from "../engine/state/types";

/** Diagnostics for the debug panel: what the last effect batch did. */
export interface EffectReport {
  effects: readonly EventEffect[];
  outcome: "applied" | "rejected";
  errors: GameError[];
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
