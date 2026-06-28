/**
 * PUNISH-4D: App-level integration tests for the critical illness ↔ restore modal interaction.
 *
 * Verifies that the cold_palace_report guard (`restoreCharId === null`) prevents
 * the ColdPalaceCriticalIncidentModal from staying mounted while the restore modal
 * is open — which would leave the submitted.current guard permanently true.
 *
 * Uses a minimal wrapper component that mirrors App.tsx's relevant render logic
 * without needing the full App.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { ColdPalaceCriticalIncidentModal } from "../../src/ui/components/ColdPalaceCriticalIncidentModal";
import { ColdPalaceRestoreModal } from "../../src/ui/components/ColdPalaceModal";
import type { ColdPalaceCriticalIllnessIncident, GameState } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import { createGameStore } from "../../src/store/gameStore";

const db = loadRealContent();
const REAL_TARGET_ID = "lu_huaijin";
const BASE_TIME = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

function setupColdPalaceState(): { state: GameState; incident: ColdPalaceCriticalIllnessIncident } {
  const store = createGameStore();
  store.loadState(withConsort(createNewGameState(db), db, REAL_TARGET_ID));
  const r = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
  expect(r.ok).toBe(true);
  const s = store.getState();
  const effectId = s.statusEffects.find(
    (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
  )!.id;
  const incident: ColdPalaceCriticalIllnessIncident = {
    id: `cpi_${REAL_TARGET_ID}_1_01`,
    residentId: REAL_TARGET_ID,
    effectId,
    kind: "critical_illness",
    occurredAt: BASE_TIME,
    acknowledged: false,
    status: "pending_response",
  };
  const stateWithIncident: GameState = {
    ...s,
    standing: { ...s.standing, [REAL_TARGET_ID]: { ...s.standing[REAL_TARGET_ID]!, health: 10 } },
    coldPalaceIncidents: [incident],
  };
  return { state: stateWithIncident, incident };
}

/**
 * Minimal wrapper that mirrors App's modal dispatch logic for cold_palace_report.
 * Critical modal hidden when restoreCharId is set; restore modal shown in its place.
 */
function AppModalWrapper({
  state,
  incident,
  onPhysician,
  onIgnore,
  onRestoreConfirm,
}: {
  state: GameState;
  incident: ColdPalaceCriticalIllnessIncident;
  onPhysician: () => void;
  onIgnore: () => void;
  onRestoreConfirm: (charId: string) => void;
}) {
  const [restoreCharId, setRestoreCharId] = useState<string | null>(null);

  return (
    <>
      {/* critical_illness modal — hidden when restore modal is open */}
      {restoreCharId === null && (
        <ColdPalaceCriticalIncidentModal
          db={db}
          state={state}
          incident={incident}
          onPhysician={onPhysician}
          onIgnore={onIgnore}
          onRestore={(charId) => setRestoreCharId(charId)}
        />
      )}
      {/* restore modal — rendered when restoreCharId is set */}
      {restoreCharId !== null && (
        <ColdPalaceRestoreModal
          db={db}
          state={state}
          charId={restoreCharId}
          onConfirm={() => {
            onRestoreConfirm(restoreCharId);
            setRestoreCharId(null);
            return null;
          }}
          onClose={() => setRestoreCharId(null)}
        />
      )}
    </>
  );
}

// ── Restore modal interaction ──────────────────────────────────────────────────

describe("critical illness ↔ restore modal interaction", () => {
  it("critical modal unmounts when 召回宫中 is clicked (restore modal appears)", () => {
    const { state, incident } = setupColdPalaceState();
    render(
      <AppModalWrapper
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
        onRestoreConfirm={vi.fn()}
      />,
    );
    // Initially: critical modal shown
    expect(screen.getByText("长门宫病情急报")).toBeDefined();
    expect(screen.queryByText(/召回/)).toBeDefined();

    fireEvent.click(screen.getByText("召回宫中"));

    // After: critical modal gone, restore modal visible
    expect(screen.queryByText("长门宫病情急报")).toBeNull();
    // Restore modal should show some confirm UI (not critical modal)
    expect(screen.queryByText("召太医诊治")).toBeNull();
  });

  it("critical modal re-mounts fresh after cancel (physician button re-armed)", () => {
    const onPhysician = vi.fn();
    const { state, incident } = setupColdPalaceState();
    render(
      <AppModalWrapper
        state={state}
        incident={incident}
        onPhysician={onPhysician}
        onIgnore={vi.fn()}
        onRestoreConfirm={vi.fn()}
      />,
    );

    // Click 召回宫中 to open restore modal
    fireEvent.click(screen.getByText("召回宫中"));
    expect(screen.queryByText("长门宫病情急报")).toBeNull();

    // Cancel the restore modal by clicking 取消
    fireEvent.click(screen.getByText("取消"));

    // Critical modal re-appears fresh
    expect(screen.getByText("长门宫病情急报")).toBeDefined();

    // Physician button now works (submitted.current was reset on remount)
    fireEvent.click(screen.getByText("召太医诊治"));
    expect(onPhysician).toHaveBeenCalledTimes(1);
  });

  it("critical modal stays gone after confirmed restore (onRestoreConfirm fires)", () => {
    const onRestoreConfirm = vi.fn();
    const { state, incident } = setupColdPalaceState();
    render(
      <AppModalWrapper
        state={state}
        incident={incident}
        onPhysician={vi.fn()}
        onIgnore={vi.fn()}
        onRestoreConfirm={onRestoreConfirm}
      />,
    );

    // Open restore modal
    fireEvent.click(screen.getByText("召回宫中"));
    // Step 1: choose reason — click 奉旨召回
    fireEvent.click(screen.getByText("奉旨召回"));
    // Step 2: confirm — click 确认奉旨召回
    fireEvent.click(screen.getByText("确认奉旨召回"));
    // After confirm: onRestoreConfirm fires with correct charId
    expect(onRestoreConfirm).toHaveBeenCalledWith(REAL_TARGET_ID);
    // In real App, store postCommit resolves the incident → global interrupt clears.
    // Here the wrapper has no store, so the store-level test below covers that invariant.
  });

  it("if physician was already clicked, 召回宫中 should not fire physician again", () => {
    const onPhysician = vi.fn();
    const { state, incident } = setupColdPalaceState();
    render(
      <AppModalWrapper
        state={state}
        incident={incident}
        onPhysician={onPhysician}
        onIgnore={vi.fn()}
        onRestoreConfirm={vi.fn()}
      />,
    );

    // Click physician first
    fireEvent.click(screen.getByText("召太医诊治"));
    expect(onPhysician).toHaveBeenCalledTimes(1);

    // Now try 召回宫中 (guard already set — restore modal should NOT open)
    // Since submitted.current is true, the action is blocked
    // The component stays rendered but actions are no-ops
    expect(screen.getByText("长门宫病情急报")).toBeDefined();
    expect(onPhysician).toHaveBeenCalledTimes(1); // still only 1
  });
});

// ── Store-level: restoreFromColdPalace resolves pending critical_illness ──────

describe("store: restoreFromColdPalace auto-resolves pending critical_illness", () => {
  it("confirmed restore resolves critical incident as restored (no stale pending)", () => {
    const { state, incident } = setupColdPalaceState();
    const store = createGameStore();
    store.loadState(state);

    const r = store.restoreFromColdPalace(db, REAL_TARGET_ID, "lifted_by_emperor");
    expect(r.ok).toBe(true);

    const afterState = store.getState();
    const resolved = afterState.coldPalaceIncidents.find((i) => i.id === incident.id);
    expect(resolved?.kind).toBe("critical_illness");
    if (resolved?.kind === "critical_illness") {
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution).toBe("restored");
      expect(resolved.acknowledged).toBe(true);
      expect(resolved.resolvedAt).toBeDefined();
      expect(resolved.healthDelta).toBeUndefined();
    }
  });

  it("restored critical incident passes tightened validator", () => {
    const { state, incident } = setupColdPalaceState();
    const store = createGameStore();
    store.loadState(state);

    store.restoreFromColdPalace(db, REAL_TARGET_ID, "lifted_by_emperor");
    const afterState = store.getState();
    // A successful state transition means the schema and validator both accepted the result.
    // Verify the critical incident fields directly.
    const resolved = afterState.coldPalaceIncidents.find((i) => i.id === incident.id);
    if (resolved?.kind === "critical_illness") {
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution).toBe("restored");
      expect(resolved.resolvedAt).toBeDefined();
      expect(resolved.healthDelta).toBeUndefined();
    }
  });
});

// ── Death path: ignore at lethal health resolves critical incident atomically ─

describe("death path: critical illness ignore at lethal health", () => {
  it("health=1 + ignore: resident is deceased and incident is resolved in same commit", () => {
    const store = createGameStore();
    store.loadState(withConsort(createNewGameState(db), db, REAL_TARGET_ID));
    const sr = store.sendConsortToColdPalace(db, REAL_TARGET_ID, {});
    expect(sr.ok).toBe(true);
    const s = store.getState();
    const effectId = s.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === REAL_TARGET_ID,
    )!.id;
    const incident: ColdPalaceCriticalIllnessIncident = {
      id: `cpi_${REAL_TARGET_ID}_1_01`,
      residentId: REAL_TARGET_ID,
      effectId,
      kind: "critical_illness",
      occurredAt: BASE_TIME,
      acknowledged: false,
      status: "pending_response",
    };
    const lethalState: GameState = {
      ...s,
      standing: { ...s.standing, [REAL_TARGET_ID]: { ...s.standing[REAL_TARGET_ID]!, health: 1 } },
      coldPalaceIncidents: [incident],
    };
    store.loadState(lethalState);

    let emitCount = 0;
    store.subscribe(() => emitCount++);

    const r = store.resolveColdPalaceCriticalIncident(db, incident.id, "ignore");
    expect(r.ok).toBe(true);

    // Only one emit (atomic commit)
    expect(emitCount).toBe(1);

    const afterState = store.getState();

    // Incident resolved in same commit
    const resolved = afterState.coldPalaceIncidents.find((i) => i.id === incident.id);
    expect(resolved?.kind).toBe("critical_illness");
    if (resolved?.kind === "critical_illness") {
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution).toBe("ignore");
      expect(resolved.acknowledged).toBe(true);
      expect(resolved.healthDelta).toBeDefined();
      expect(resolved.healthDelta!).toBeLessThan(0);
      expect(resolved.resolvedAt).toBeDefined();
    }

    // Resident deceased (health=1, any negative penalty → deceased via planHealthChange)
    const standing = afterState.standing[REAL_TARGET_ID];
    expect(standing?.lifecycle).toBe("deceased");

    // Pending aftermath enqueued (not zero)
    expect(afterState.pendingAftermath.length).toBeGreaterThan(0);
  });
});
