import { SOVEREIGN_PERSON_ID, type CharacterParentage, type GameState } from "../../state/types";
import { stateError, type GameError } from "../../infra/errors";
import { err, ok, type Result } from "../../infra/result";

export function buildBirthParentage(biologicalFatherId: string | null): CharacterParentage {
  return {
    biologicalMotherId: SOVEREIGN_PERSON_ID,
    biologicalFatherId,
    legalMotherId: SOVEREIGN_PERSON_ID,
    legalFatherId: biologicalFatherId,
  };
}

export function establishBirthParentage(
  state: GameState,
  input: { childId: string; biologicalFatherId: string | null },
): Result<GameState, GameError[]> {
  if (state.parentage[input.childId]) {
    return err([stateError("PARENTAGE_ALREADY_ESTABLISHED",
      `parentage already exists for "${input.childId}"`, { context: { char: input.childId } })]);
  }
  return ok({
    ...state,
    parentage: { ...state.parentage, [input.childId]: buildBirthParentage(input.biologicalFatherId) },
  });
}
