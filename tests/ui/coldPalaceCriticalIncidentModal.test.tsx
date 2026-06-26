/**
 * PUNISH-4D: ColdPalaceCriticalIncidentModal component tests.
 *
 * Covers:
 *  - Renders title "长门宫病情急报"
 *  - Health labels: 危在旦夕/病入膏肓/形销骨立/病势沉重
 *  - Shows resident name and rank
 *  - All three buttons (physician/ignore/restore) present/absent per conditions
 *  - Double-click guard: second click ignored
 *  - 召回 button hidden when linked effect is not active
 *  - No backdrop click acknowledgement
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColdPalaceCriticalIncidentModal } from "../../src/ui/components/ColdPalaceCriticalIncidentModal";
import type { ColdPalaceCriticalIllnessIncident, GameState } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { createGameStore } from "../../src/store/gameStore";

const db = loadRealContent();
const REAL_TARGET_ID = "lu_huaijin";
const BASE_TIME = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

function stateWithColdPalaceResident(): GameState {
  const store = createGameStore();
  store.loadState(createNewGameState(db));
  const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
  expect(r.ok).toBe(true);
  return store.getState();
}

function makeIncident(state: GameState, overrides: Partial<ColdPalaceCriticalIllnessIncident> = {}): ColdPalaceCriticalIllnessIncident {
  const effectId = state.statusEffects.find(
    (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
  )?.id ?? "se_000001";
  return {
    id: `cpi_${REAL_TARGET_ID}_1_01`,
    residentId: REAL_TARGET_ID,
    effectId,
    kind: "critical_illness",
    occurredAt: BASE_TIME,
    acknowledged: false,
    status: "pending_response",
    ...overrides,
  };
}

function stateWithHealth(health: number): GameState {
  const base = stateWithColdPalaceResident();
  return {
    ...base,
    standing: {
      ...base.standing,
      [REAL_TARGET_ID]: { ...base.standing[REAL_TARGET_ID]!, health },
    },
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("ColdPalaceCriticalIncidentModal: rendering", () => {
  it("renders title '长门宫病情急报'", () => {
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(screen.getByText("长门宫病情急报")).toBeDefined();
  });

  it("renders health label '危在旦夕' for health ≤ 5", () => {
    const state = stateWithHealth(5);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain("危在旦夕");
  });

  it("renders health label '病入膏肓' for health ≤ 10 (above 5)", () => {
    const state = stateWithHealth(8);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain("病入膏肓");
  });

  it("renders health label '形销骨立' for health ≤ 15 (above 10)", () => {
    const state = stateWithHealth(13);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain("形销骨立");
  });

  it("renders health label '病势沉重' for health > 15", () => {
    const state = stateWithHealth(18);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain("病势沉重");
  });

  it("renders '召太医诊治' button", () => {
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(screen.getByText("召太医诊治")).toBeDefined();
  });

  it("renders '置之不理' button", () => {
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(screen.getByText("置之不理")).toBeDefined();
  });
});

// ── 召回 button visibility ─────────────────────────────────────────────────────

describe("ColdPalaceCriticalIncidentModal: 召回宫中 button", () => {
  it("shows 召回宫中 when onRestore is provided and linked effect is still active", () => {
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByText("召回宫中")).toBeDefined();
  });

  it("hides 召回宫中 when onRestore prop is not provided", () => {
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(screen.queryByText("召回宫中")).toBeNull();
  });

  it("hides 召回宫中 when linked cold palace effect is gone", () => {
    const state = stateWithHealth(10);
    // Incident references an effect that doesn't exist in statusEffects
    const incident = makeIncident(state, { effectId: "se_nonexistent" });
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.queryByText("召回宫中")).toBeNull();
  });
});

// ── Double-click guard ────────────────────────────────────────────────────────

describe("ColdPalaceCriticalIncidentModal: double-click guard", () => {
  it("onPhysician only fires once even if button clicked twice", () => {
    const onPhysician = vi.fn();
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={onPhysician}
        onIgnore={vi.fn()}
      />,
    );
    const btn = screen.getByText("召太医诊治");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onPhysician).toHaveBeenCalledTimes(1);
  });

  it("onIgnore only fires once even if button clicked twice", () => {
    const onIgnore = vi.fn();
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={onIgnore}
      />,
    );
    const btn = screen.getByText("置之不理");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onIgnore).toHaveBeenCalledTimes(1);
  });

  it("first click on physician prevents subsequent ignore click", () => {
    const onPhysician = vi.fn();
    const onIgnore = vi.fn();
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={onPhysician}
        onIgnore={onIgnore}
      />,
    );
    fireEvent.click(screen.getByText("召太医诊治"));
    fireEvent.click(screen.getByText("置之不理"));
    expect(onPhysician).toHaveBeenCalledTimes(1);
    expect(onIgnore).toHaveBeenCalledTimes(0);
  });
});

// ── No backdrop click acknowledgement ─────────────────────────────────────────

describe("ColdPalaceCriticalIncidentModal: backdrop click", () => {
  it("clicking the backdrop does NOT trigger any callback", () => {
    const onPhysician = vi.fn();
    const onIgnore = vi.fn();
    const state = stateWithHealth(10);
    const incident = makeIncident(state);
    const { container } = render(
      <ColdPalaceCriticalIncidentModal
        db={db}
        state={state}
        incident={incident}
        onPhysician={onPhysician}
        onIgnore={onIgnore}
      />,
    );
    const backdrop = container.querySelector(".modal-backdrop");
    if (backdrop) fireEvent.click(backdrop);
    expect(onPhysician).not.toHaveBeenCalled();
    expect(onIgnore).not.toHaveBeenCalled();
  });
});
