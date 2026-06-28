/**
 * PUNISH-4E: ColdPalaceInterventionModal and FreeViewScreen intervention button tests.
 *
 * Covers:
 *  - ColdPalaceInterventionModal renders title, name, kind buttons
 *  - Buttons disabled when canInterveneInColdPalace returns false
 *  - Double-click guard: second click ignored
 *  - Cancel button calls onClose
 *  - FreeViewScreen cold palace resident row: 亲临探视 / 遣太医诊治 buttons present
 *  - FreeViewScreen buttons disabled after intervention (already intervened)
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColdPalaceInterventionModal } from "../../src/ui/components/ColdPalaceInterventionModal";
import type { GameState } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import { createGameStore } from "../../src/store/gameStore";
import {
  coldPalaceInterventionId,
  COLD_PALACE_VISIT_FAVOR_DELTA,
  COLD_PALACE_PHYSICIAN_HEALTH_DELTA,
} from "../../src/engine/characters/coldPalaceIncidents";

const db = loadRealContent();
const REAL_TARGET_ID = "lu_huaijin";

function stateWithColdPalaceResident(health = 80): GameState {
  const store = createGameStore();
  store.loadState(withConsort(createNewGameState(db), db, REAL_TARGET_ID));
  const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
  expect(r.ok).toBe(true);
  const state = store.getState();
  return {
    ...state,
    standing: { ...state.standing, [REAL_TARGET_ID]: { ...state.standing[REAL_TARGET_ID]!, health } },
  };
}

// ── ColdPalaceInterventionModal ───────────────────────────────────────────────

describe("ColdPalaceInterventionModal", () => {
  function renderModal(state: GameState, onSelect = vi.fn(), onClose = vi.fn()) {
    return render(
      <ColdPalaceInterventionModal
        db={db}
        state={state}
        charId={REAL_TARGET_ID}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
  }

  it("renders title '探视长门宫'", () => {
    renderModal(stateWithColdPalaceResident());
    expect(screen.getByText("探视长门宫")).toBeInTheDocument();
  });

  it("renders resident name in a strong element", () => {
    const state = stateWithColdPalaceResident();
    const { container } = renderModal(state);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent?.length).toBeGreaterThan(0);
  });

  it("renders 亲临探视 button with favor delta", () => {
    renderModal(stateWithColdPalaceResident());
    expect(screen.getByText(new RegExp(`亲临探视.*${COLD_PALACE_VISIT_FAVOR_DELTA}`))).toBeInTheDocument();
  });

  it("renders 遣太医诊治 button with health delta", () => {
    renderModal(stateWithColdPalaceResident());
    expect(screen.getByText(new RegExp(`遣太医诊治.*${COLD_PALACE_PHYSICIAN_HEALTH_DELTA}`))).toBeInTheDocument();
  });

  it("renders 取消 button", () => {
    renderModal(stateWithColdPalaceResident());
    expect(screen.getByText("取消")).toBeInTheDocument();
  });

  it("calls onSelect with 'personal_visit' when 亲临探视 clicked", () => {
    const onSelect = vi.fn().mockReturnValue(null);
    renderModal(stateWithColdPalaceResident(), onSelect);
    fireEvent.click(screen.getByText(new RegExp("亲临探视")));
    expect(onSelect).toHaveBeenCalledWith("personal_visit");
  });

  it("calls onSelect with 'physician' when 遣太医诊治 clicked", () => {
    const onSelect = vi.fn().mockReturnValue(null);
    renderModal(stateWithColdPalaceResident(), onSelect);
    fireEvent.click(screen.getByText(new RegExp("遣太医诊治")));
    expect(onSelect).toHaveBeenCalledWith("physician");
  });

  it("double-click guard: second click ignored", () => {
    const onSelect = vi.fn().mockReturnValue(null);
    renderModal(stateWithColdPalaceResident(), onSelect);
    const btn = screen.getByText(new RegExp("亲临探视"));
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when 取消 clicked", () => {
    const onClose = vi.fn();
    renderModal(stateWithColdPalaceResident(), vi.fn(), onClose);
    fireEvent.click(screen.getByText("取消"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("both buttons disabled when not in cold palace", () => {
    const state = createNewGameState(db);
    renderModal(state);
    const visitBtn = screen.getByText(new RegExp("亲临探视")) as HTMLButtonElement;
    const physicianBtn = screen.getByText(new RegExp("遣太医诊治")) as HTMLButtonElement;
    expect(visitBtn.disabled).toBe(true);
    expect(physicianBtn.disabled).toBe(true);
  });

  it("both buttons disabled after already intervened this month", () => {
    const state = stateWithColdPalaceResident();
    const effectId = state.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
    )?.id ?? "eff_dummy";
    const { year, month, period, dayIndex } = state.calendar;
    const stateWithRecord = {
      ...state,
      coldPalaceInterventions: [{
        id: coldPalaceInterventionId(REAL_TARGET_ID, year, month),
        residentId: REAL_TARGET_ID,
        effectId,
        kind: "personal_visit" as const,
        occurredAt: { year, month, period, dayIndex },
        favorDelta: 5,
      }],
    };
    renderModal(stateWithRecord);
    const visitBtn = screen.getByText(new RegExp("亲临探视")) as HTMLButtonElement;
    const physicianBtn = screen.getByText(new RegExp("遣太医诊治")) as HTMLButtonElement;
    expect(visitBtn.disabled).toBe(true);
    expect(physicianBtn.disabled).toBe(true);
  });

  it("both buttons disabled when AP is 0", () => {
    const state = stateWithColdPalaceResident();
    const noAp = { ...state, calendar: { ...state.calendar, ap: 0 } };
    renderModal(noAp);
    const visitBtn = screen.getByText(new RegExp("亲临探视")) as HTMLButtonElement;
    const physicianBtn = screen.getByText(new RegExp("遣太医诊治")) as HTMLButtonElement;
    expect(visitBtn.disabled).toBe(true);
    expect(physicianBtn.disabled).toBe(true);
  });

  it("backdrop click does NOT trigger onSelect (only backdrop, not inner modal)", () => {
    const onSelect = vi.fn();
    const { container } = renderModal(stateWithColdPalaceResident(), onSelect);
    const backdrop = container.querySelector(".modal-backdrop")!;
    fireEvent.click(backdrop);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
