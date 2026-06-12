/**
 * Pure reducer: (state, command) → Result<new state>. Never mutates input.
 * applyBatch is all-or-nothing (skeleton-plan §6): the first invalid command
 * rejects the whole batch and the caller keeps the original state.
 */
import {
  advanceActionDay,
  calendarInvariantViolation,
  type CalendarState,
} from "../calendar/time";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { ApplyOutcome, GameCommand } from "./commands";
import type { GameState } from "./types";

export type CommandResult = Result<ApplyOutcome<GameState>, GameError>;

export function applyCommand(state: GameState, command: GameCommand): CommandResult {
  switch (command.type) {
    case "SPEND_AP":
      return applySpendAp(state, command.amount);

    case "MOVE_TO_LOCATION": {
      // Existence against ContentDB is wired in PR 4; structural check only here.
      if (command.locationId === "") {
        return err(stateError("BAD_LOCATION", "MOVE_TO_LOCATION requires a locationId"));
      }
      return ok({ state: { ...state, playerLocation: command.locationId }, rolledOver: false });
    }

    case "SET_FLAG": {
      if (command.key === "") {
        return err(stateError("BAD_FLAG_KEY", "SET_FLAG requires a non-empty key"));
      }
      return ok({
        state: { ...state, flags: { ...state.flags, [command.key]: command.value } },
        rolledOver: false,
      });
    }

    default: {
      const exhausted: never = command;
      return err(
        stateError("UNKNOWN_COMMAND", `unknown command ${JSON.stringify(exhausted)}`, {
          severity: "fatal",
        }),
      );
    }
  }
}

export function applyBatch(state: GameState, commands: readonly GameCommand[]): CommandResult {
  let current = state;
  let rolledOver = false;
  for (const command of commands) {
    const result = applyCommand(current, command);
    if (!result.ok) {
      return err(
        stateError("BATCH_REJECTED", `batch rejected at ${command.type}: ${result.error.message}`, {
          context: { command, cause: result.error },
        }),
      );
    }
    current = result.value.state;
    rolledOver = rolledOver || result.value.rolledOver;
  }
  return ok({ state: current, rolledOver });
}

function applySpendAp(state: GameState, amount: number): CommandResult {
  if (!Number.isInteger(amount) || amount < 1) {
    return err(
      stateError("AP_INVALID_AMOUNT", `SPEND_AP amount must be a positive integer, got ${amount}`),
    );
  }
  if (amount > state.calendar.ap) {
    // Affordability is checked by callers (行动点不足, skeleton-plan §6);
    // the reducer is the backstop that makes negative AP impossible.
    return err(
      stateError("AP_INSUFFICIENT", `cannot spend ${amount} AP with ${state.calendar.ap} remaining`, {
        context: { amount, ap: state.calendar.ap },
      }),
    );
  }

  const spent: CalendarState = { ...state.calendar, ap: state.calendar.ap - amount };
  const rolledOver = spent.ap === 0;
  const calendar = rolledOver ? advanceActionDay(spent) : spent;

  const violation = calendarInvariantViolation(calendar);
  if (violation) {
    return err(
      stateError("CALENDAR_INVARIANT", `impossible calendar state: ${violation}`, {
        severity: "fatal",
        context: { calendar },
      }),
    );
  }
  return ok({ state: { ...state, calendar }, rolledOver });
}
