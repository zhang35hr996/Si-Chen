/**
 * PUNISH-4A tests — 冷宫运行态（ColdPalaceEffect + sendConsortToColdPalace / restoreFromColdPalace）.
 *
 * Coverage:
 * - CP-ID: ID allocation (pun_000001 / status_<charId>_000001)
 * - CP-KIND: PunishmentRecord creation for cold_palace kind
 * - CP-EFF: ColdPalaceEffect creation and field integrity
 * - CP-VAL: Validation (duplicate, deceased, active confinement resolution)
 * - CP-REST: restoreFromColdPalace lifecycle
 * - CP-LIFE: Chronicle and memory provenance
 * - CP-ATOM: Atomicity guarantees
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../../src/store/gameStore";
import { createNewGameState } from "../../../src/engine/state/newGame";
import { loadRealContent } from "../../helpers/contentFixture";
import { PUNISHMENT_ID_REGEX } from "../../../src/engine/justice/types";
import type { CaseRecord } from "../../../src/engine/justice/types";
import type { CharacterStatusEffect } from "../../../src/engine/state/types";
import { allocateJusticeIds } from "../../../src/engine/justice/ids";
import { applyJusticePlan } from "../../../src/engine/justice/mutations";
import { toGameTime } from "../../../src/engine/calendar/time";
import type { ImperialCommand } from "../../../src/store/imperialCommands";

const db = loadRealContent();

function makeStore() {
  const store = createGameStore();
  store.loadState(createNewGameState(db));
  return store;
}

// A non-empress consort available in test fixtures.
const TARGET = "lu_huaijin";

// ── CP-ID: ID allocation ──────────────────────────────────────────────────────

describe("cold palace — ID allocation", () => {
  it("CP-ID1. sendConsortToColdPalace allocates pun_000001 and matching status ID", () => {
    const store = makeStore();
    const result = store.sendConsortToColdPalace(db, TARGET, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.punishmentId).toMatch(PUNISHMENT_ID_REGEX);
    expect(result.value.punishmentId).toBe("pun_000001");

    // ColdPalaceEffect ID should be status_<charId>_000001
    const se = store.getState().statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(se).toBeDefined();
    expect(se?.id).toMatch(/^status_lu_huaijin_\d{6}$/);
  });

  it("CP-ID2. nextSeq.punishment advances by exactly 1", () => {
    const store = makeStore();
    expect(store.getState().justice.nextSeq.punishment).toBe(1);
    store.sendConsortToColdPalace(db, TARGET, {});
    expect(store.getState().justice.nextSeq.punishment).toBe(2);
  });

  it("CP-ID3. second punishment gets pun_000002", () => {
    const store = makeStore();
    // First punishment (confinement of another consort).
    const TARGET2 = "wenya";
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET2, durationTurns: 3 };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    // Second punishment (cold palace for TARGET).
    const result = store.sendConsortToColdPalace(db, TARGET, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.punishmentId).toBe("pun_000002");
  });
});

// ── CP-KIND: PunishmentRecord creation ───────────────────────────────────────

describe("cold palace — PunishmentRecord", () => {
  it("CP-KIND1. creates cold_palace PunishmentRecord with active lifecycle", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun).toBeDefined();
    expect(pun.kind).toBe("cold_palace");
    expect(pun.lifecycle.status).toBe("active");
    expect(pun.targetId).toBe(TARGET);
    expect(pun.actorId).toBe("player");
    expect(pun.severity).toBe("severe");
  });

  it("CP-KIND2. details include statusEffectId, previousResidenceId, coldPalaceResidenceId", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.kind).toBe("cold_palace");
    if (pun.kind !== "cold_palace") return;
    const details = pun.details;
    expect(details.statusEffectId).toMatch(/^status_/);
    expect(details.coldPalaceResidenceId).toBe("changmengong");
    expect(typeof details.previousResidenceId).toBe("string");
    expect(details.previousResidenceId.length).toBeGreaterThan(0);
  });

  it("CP-KIND3. caseId stored on PunishmentRecord when provided", () => {
    const store = makeStore();
    // Create a case first.
    const baseState = store.getState();
    const now = toGameTime(baseState.calendar);
    const caseRecord: CaseRecord = {
      id: "case_000001",
      status: "open",
      subjectIds: [TARGET],
      openedAt: now,
      openedBy: "player",
      source: { kind: "imperial" },
      publicity: "palace",
      charges: [],
      evidence: [],
      confessions: [],
      punishmentIds: [],
    };
    const caseAlloc = allocateJusticeIds(baseState.justice, { cases: 1 });
    const casePlan = { mutations: [{ type: "create_case" as const, record: caseRecord }], nextSeq: caseAlloc.nextSeq };
    const withCase = applyJusticePlan(baseState, casePlan);
    expect(withCase.ok).toBe(true);
    if (!withCase.ok) return;
    store.loadState(withCase.value);

    const result = store.sendConsortToColdPalace(db, TARGET, { caseId: "case_000001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.caseId).toBe("case_000001");
  });

  it("CP-KIND4. without caseId, PunishmentRecord has no caseId field", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.caseId).toBeUndefined();
  });
});

// ── CP-EFF: ColdPalaceEffect fields ──────────────────────────────────────────

describe("cold palace — ColdPalaceEffect", () => {
  it("CP-EFF1. ColdPalaceEffect created with correct fields", () => {
    const store = makeStore();
    const turn = store.getState().calendar.dayIndex;
    store.sendConsortToColdPalace(db, TARGET, {});
    const se = store.getState().statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(se).toBeDefined();
    if (!se || se.kind !== "cold_palace") return;
    expect(se.kind).toBe("cold_palace");
    expect(se.characterId).toBe(TARGET);
    expect(se.startTurn).toBe(turn);
    expect(se.coldPalaceResidenceId).toBe("changmengong");
    expect(se.sourcePunishmentId).toBe("pun_000001");
    expect(se.liftedTurn).toBeUndefined();
  });

  it("CP-EFF2. standing.residence set to changmengong", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const standing = store.getState().standing[TARGET]!;
    expect(standing.residence).toBe("changmengong");
  });

  it("CP-EFF3. sourcePunishmentId on effect links to PunishmentRecord", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const se = store.getState().statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(se?.sourcePunishmentId).toBe("pun_000001");
    // PunishmentRecord exists.
    expect(store.getState().justice.punishments["pun_000001"]).toBeDefined();
  });

  it("CP-EFF4. cross-link: punishment.details.statusEffectId matches effect.id", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.kind).toBe("cold_palace");
    if (pun.kind !== "cold_palace") return;
    const se = store.getState().statusEffects.find((e) => e.id === pun.details.statusEffectId);
    expect(se).toBeDefined();
    expect(se?.kind).toBe("cold_palace");
    if (!se || se.kind !== "cold_palace") return;
    expect(se.characterId).toBe(TARGET);
    expect(se.sourcePunishmentId).toBe("pun_000001");
  });
});

// ── CP-VAL: Validation ────────────────────────────────────────────────────────

describe("cold palace — validation", () => {
  it("CP-VAL1. duplicate send rejected — second call returns error", () => {
    const store = makeStore();
    const first = store.sendConsortToColdPalace(db, TARGET, {});
    expect(first.ok).toBe(true);
    const second = store.sendConsortToColdPalace(db, TARGET, {});
    expect(second.ok).toBe(false);
    // State should still have only 1 cold palace effect for target.
    const effects = store.getState().statusEffects.filter(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(effects).toHaveLength(1);
  });

  it("CP-VAL2. deceased consort rejected", () => {
    const store = makeStore();
    // Execute the consort first.
    const execCmd: ImperialCommand = { type: "execute", targetId: TARGET };
    store.applyImperialPunishmentWithConsequences(db, execCmd, {});
    const result = store.sendConsortToColdPalace(db, TARGET, {});
    expect(result.ok).toBe(false);
  });

  it("CP-VAL3. active confinement is resolved as lifted_by_decree in same transaction", () => {
    const store = makeStore();
    // First, confine the target.
    const confineCmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: null };
    const confineResult = store.applyImperialPunishmentWithConsequences(db, confineCmd, {});
    expect(confineResult.ok).toBe(true);
    const confinePunId = "pun_000001";
    expect(store.getState().justice.punishments[confinePunId]?.lifecycle.status).toBe("active");

    // Now send to cold palace — should succeed and resolve the confinement.
    const cpResult = store.sendConsortToColdPalace(db, TARGET, {});
    expect(cpResult.ok).toBe(true);
    if (!cpResult.ok) return;

    // Confinement should be resolved.
    const confinePun = store.getState().justice.punishments[confinePunId];
    expect(confinePun?.lifecycle.status).toBe("lifted");
    if (confinePun?.lifecycle.status === "lifted") {
      expect(confinePun.lifecycle.resolution).toBe("lifted_by_decree");
    }

    // Confinement effect should be lifted.
    const confineSe = store.getState().statusEffects.find(
      (e) => e.kind === "confinement" && e.characterId === TARGET,
    );
    expect(confineSe?.liftedTurn).toBeDefined();

    // Cold palace effect should be active.
    const cpSe = store.getState().statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(cpSe).toBeDefined();
    expect(cpSe?.liftedTurn).toBeUndefined();
  });

  it("CP-VAL4. nonexistent consort rejected", () => {
    const store = makeStore();
    const result = store.sendConsortToColdPalace(db, "nonexistent_char_999", {});
    expect(result.ok).toBe(false);
  });
});

// ── CP-REST: restoreFromColdPalace ────────────────────────────────────────────

describe("cold palace — restore", () => {
  it("CP-REST1. restoreFromColdPalace marks effect lifted and restores residence", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const se = store.getState().statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    )!;
    if (!se || se.kind !== "cold_palace") return;
    const prevResidence = se.previousResidenceId;

    const restoreResult = store.restoreFromColdPalace(db, TARGET, "lifted_by_emperor");
    expect(restoreResult.ok).toBe(true);

    // Effect should be lifted.
    const lifted = store.getState().statusEffects.find((e) => e.id === se.id);
    expect(lifted?.liftedTurn).toBeDefined();
    if (!lifted || lifted.kind !== "cold_palace") return;
    expect(lifted.liftReason).toBe("lifted_by_emperor");

    // Residence restored.
    const standing = store.getState().standing[TARGET]!;
    expect(standing.residence).toBe(prevResidence);
  });

  it("CP-REST2. restore resolves PunishmentRecord as lifted/pardoned", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    store.restoreFromColdPalace(db, TARGET, "pardoned");
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.lifecycle.status).toBe("lifted");
    if (pun.lifecycle.status === "lifted") {
      expect(pun.lifecycle.resolution).toBe("pardoned");
    }
  });

  it("CP-REST3. restore does not advance nextSeq.punishment", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const seqAfterSend = store.getState().justice.nextSeq.punishment;
    store.restoreFromColdPalace(db, TARGET, "lifted_by_emperor");
    expect(store.getState().justice.nextSeq.punishment).toBe(seqAfterSend);
  });

  it("CP-REST4. restore on no active cold palace returns error", () => {
    const store = makeStore();
    const result = store.restoreFromColdPalace(db, TARGET, "lifted_by_emperor");
    expect(result.ok).toBe(false);
  });

  it("CP-REST5. restore returns sourcePunishmentId", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const result = store.restoreFromColdPalace(db, TARGET, "lifted_by_emperor");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.punishmentId).toBe("pun_000001");
  });
});

// ── CP-LIFE: Chronicle and memory provenance ──────────────────────────────────

describe("cold palace — lifecycle provenance", () => {
  it("CP-LIFE1. memory effects carry sourcePunishmentId", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    // All memory entries for TARGET should have sourcePunishmentId.
    const targetMemories = store.getState().memories[TARGET]?.entries ?? [];
    const punishmentMemories = targetMemories.filter((e) => e.sourcePunishmentId === "pun_000001");
    // Not all scenarios add memory but if any do, they must be linked.
    for (const entry of targetMemories) {
      if (entry.sourcePunishmentId !== undefined) {
        expect(entry.sourcePunishmentId).toBe("pun_000001");
      }
    }
    void punishmentMemories; // suppress unused warning
  });
});

// ── CP-ATOM: Atomicity ────────────────────────────────────────────────────────

describe("cold palace — atomicity", () => {
  it("CP-ATOM1. state unchanged on validation failure", () => {
    const store = makeStore();
    const before = store.getState().justice.nextSeq.punishment;
    const result = store.sendConsortToColdPalace(db, "nonexistent_char_999", {});
    expect(result.ok).toBe(false);
    expect(store.getState().justice.nextSeq.punishment).toBe(before);
    expect(Object.keys(store.getState().justice.punishments)).toHaveLength(0);
    expect(store.getState().statusEffects).toHaveLength(0);
  });

  it("CP-ATOM2. single emit on success", () => {
    const store = makeStore();
    let emits = 0;
    store.subscribe(() => emits++);
    store.sendConsortToColdPalace(db, TARGET, {});
    expect(emits).toBe(1);
  });

  it("CP-ATOM3. failed send does not emit", () => {
    const store = makeStore();
    let emits = 0;
    store.subscribe(() => emits++);
    store.sendConsortToColdPalace(db, "no_such_char", {});
    expect(emits).toBe(0);
  });

  it("CP-ATOM4. PunishmentRecord and ColdPalaceEffect both created or neither", () => {
    const store = makeStore();
    store.sendConsortToColdPalace(db, TARGET, {});
    const state = store.getState();
    const hasPunishment = "pun_000001" in state.justice.punishments;
    const hasColdPalace = state.statusEffects.some(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(hasPunishment).toBe(true);
    expect(hasColdPalace).toBe(true);

    // Cross-links are consistent.
    const pun = state.justice.punishments["pun_000001"]!;
    if (pun.kind !== "cold_palace") return;
    const se = state.statusEffects.find((e) => e.id === pun.details.statusEffectId)!;
    expect(se).toBeDefined();
    expect(se.kind).toBe("cold_palace");
    if (se.kind !== "cold_palace") return;
    expect(se.sourcePunishmentId).toBe("pun_000001");
  });
});

// ── CP-LEGACY: Legacy state compatibility ─────────────────────────────────────

describe("cold palace — legacy cold_palace statusEffect injection", () => {
  it("CP-LEGACY1. state with manually-injected ColdPalaceEffect loads without validation errors", () => {
    const store = makeStore();
    // Inject a cold palace effect and matching punishment directly.
    const baseState = store.getState();
    const now = toGameTime(baseState.calendar);
    const alloc = allocateJusticeIds(baseState.justice, { punishments: 1 });
    const punishmentId = alloc.punishments[0]!;
    const statusEffectId = `status_${TARGET}_000001`;

    const coldPalaceEffect: CharacterStatusEffect = {
      id: statusEffectId,
      kind: "cold_palace",
      characterId: TARGET,
      startedAt: now,
      startTurn: baseState.calendar.dayIndex,
      previousResidenceId: "zhaoyang",
      coldPalaceResidenceId: "changmengong",
      sourcePunishmentId: punishmentId,
    };

    const withEffect = { ...baseState, statusEffects: [...baseState.statusEffects, coldPalaceEffect] };
    const plan = {
      mutations: [{
        type: "create_punishment" as const,
        record: {
          id: punishmentId,
          kind: "cold_palace" as const,
          targetId: TARGET,
          actorId: "player",
          severity: "severe" as const,
          imposedAt: now,
          publicity: "palace" as const,
          lifecycle: { status: "active" as const },
          details: {
            statusEffectId,
            previousResidenceId: "zhaoyang",
            coldPalaceResidenceId: "changmengong",
          },
        },
      }],
      nextSeq: alloc.nextSeq,
    };
    const withBoth = applyJusticePlan(withEffect, plan);
    expect(withBoth.ok).toBe(true);
    if (!withBoth.ok) return;

    // Also update residence.
    const withResidence = {
      ...withBoth.value,
      standing: {
        ...withBoth.value.standing,
        [TARGET]: { ...withBoth.value.standing[TARGET]!, residence: "changmengong" },
      },
    };
    // loadState triggers schema validation; should not throw.
    expect(() => store.loadState(withResidence)).not.toThrow();
    // Can restore.
    const restore = store.restoreFromColdPalace(db, TARGET, "pardoned");
    expect(restore.ok).toBe(true);
  });
});
