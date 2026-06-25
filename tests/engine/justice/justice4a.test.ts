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
import { CHAMBERED_PALACE_ORDER, CHAMBERS } from "../../../src/engine/characters/chambers";
import type { GameError } from "../../../src/engine/infra/errors";
import { validateJusticeLinks } from "../../../src/engine/justice/crossLink";

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
    // Not all scenarios add memory but if any do, they must be linked.
    for (const entry of targetMemories) {
      if (entry.sourcePunishmentId !== undefined) {
        expect(entry.sourcePunishmentId).toBe("pun_000001");
      }
    }
    // sendConsortToColdPalace always writes a primary trauma memory entry — assert it exists.
    const punMem = targetMemories.find((m: any) => m.sourcePunishmentId !== undefined);
    expect(punMem).toBeDefined();
    expect(punMem!.sourcePunishmentId).toBeDefined();
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

// ── CP-AUTH: Empress authority after send_to_cold_palace ─────────────────────

describe("cold palace — empress authority (Fix 1)", () => {
  it("CP-AUTH1. lift_confinement applied after send_to_cold_palace does not restore empress haremAdmin", () => {
    // shen_zhibai is the empress (rank=fenghou) in test fixtures.
    const EMPRESS = "shen_zhibai";
    const store = makeStore();

    // Send empress to cold palace — this transfers haremAdmin to neiwu_proxy.
    const sendResult = store.sendConsortToColdPalace(db, EMPRESS, {});
    expect(sendResult.ok).toBe(true);
    expect(store.getState().haremAdministration.mode).not.toBe("empress");

    // Apply lift_confinement for the empress (simulates the effect order scenario).
    // Even if lift_confinement runs, haremAdmin must NOT be restored while she's in cold palace.
    const gameTime = toGameTime(store.getState().calendar);
    store.applyEffects(db, [{
      type: "lift_confinement",
      char: EMPRESS,
      at: gameTime,
      reason: "lifted_by_emperor",
    }]);
    // lift_confinement on someone with no active confinement is a no-op (not rejected).
    // Either way, haremAdmin must NOT be empress while she is in cold palace.
    expect(store.getState().haremAdministration.mode).not.toBe("empress");
  });
});

// ── CP-DEATH: Natural death resolves ColdPalaceEffect's PunishmentRecord ─────

describe("cold palace — death reconciliation (Fix 2)", () => {
  it("CP-DEATH1. consort_decease while in cold palace resolves PunishmentRecord as target_deceased", () => {
    const store = makeStore();
    const sendResult = store.sendConsortToColdPalace(db, TARGET, {});
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok) return;
    const punishmentId = sendResult.value.punishmentId;

    const gameTime = toGameTime(store.getState().calendar);

    // Apply consort_decease.
    const deathResult = store.applyEffects(db, [{
      type: "consort_decease",
      char: TARGET,
      at: gameTime,
      cause: "illness",
    }]);
    expect(deathResult.ok).toBe(true);

    // PunishmentRecord should be resolved as completed/target_deceased.
    const pun = store.getState().justice.punishments[punishmentId]!;
    expect(pun.lifecycle.status).toBe("completed");
    if (pun.lifecycle.status === "completed") {
      expect(pun.lifecycle.resolution).toBe("target_deceased");
    }

    // ColdPalaceEffect should be lifted.
    const se = store.getState().statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(se?.liftedTurn).toBeDefined();
  });
});

// ── CP-BYPASS: Internal effect guard ─────────────────────────────────────────

describe("cold palace — internal effect guard (Fix 3)", () => {
  it("CP-BYPASS1. applyEffects rejects send_to_cold_palace without allowInternalEffects", () => {
    const store = makeStore();
    const result = store.applyEffects(db, [
      // Cast via unknown because send_to_cold_palace is not in the public EventEffect union.
      {
        type: "send_to_cold_palace",
        char: TARGET,
        statusEffectId: "status_lu_huaijin_000001",
        punishmentId: "pun_000001",
        coldPalaceResidenceId: "changmengong",
        previousResidenceId: "zhongcui_gong",
        startedAt: toGameTime(store.getState().calendar),
        startTurn: store.getState().calendar.dayIndex,
      } as unknown as Parameters<typeof store.applyEffects>[1][number],
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const firstErr = Array.isArray(result.error) ? result.error[0] : result.error;
    expect((firstErr as { code?: string })?.code).toBe("BAD_EFFECT");
  });
});

// ── CP-RELOC: Relocate blocked for cold-palace consorts ──────────────────────

describe("cold palace — relocate validation (Fix 4)", () => {
  it("CP-RELOC1. relocate effect rejected while consort is in cold palace", () => {
    const store = makeStore();
    const sendResult = store.sendConsortToColdPalace(db, TARGET, {});
    expect(sendResult.ok).toBe(true);

    const result = store.applyEffects(db, [{
      type: "relocate",
      char: TARGET,
      location: "chengqian_gong",
      chamber: "east_side",
    }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const firstErr = Array.isArray(result.error) ? result.error[0] : result.error;
    expect((firstErr as { message?: string })?.message ?? "").toContain("cold palace");
  });
});

// ── CP-REST-CHRONICLE: Restore chronicle provenance ──────────────────────────

describe("cold palace — restore chronicle (Fix 7)", () => {
  it("CP-REST-CHRONICLE1. restoreFromColdPalace writes cold_palace_restored chronicle entry", () => {
    const store = makeStore();
    const sendResult = store.sendConsortToColdPalace(db, TARGET, {});
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok) return;

    store.restoreFromColdPalace(db, TARGET, "pardoned");

    const chronicle = store.getState().chronicle;
    const restoreEntry = chronicle.find(
      (e) => (e.payload as { decree?: string })?.decree === "cold_palace_restored",
    );
    expect(restoreEntry).toBeDefined();
    expect((restoreEntry?.payload as { targetId?: string })?.targetId).toBe(TARGET);
    expect((restoreEntry?.links as { sourcePunishmentId?: string })?.sourcePunishmentId).toBe(sendResult.value.punishmentId);
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

// ── CP-AUTH2: set_harem_administration empress rejected when empress in cold palace ─────

describe("cold palace — set_harem_administration empress guard (Fix 1b)", () => {
  it("CP-AUTH2. set_harem_administration to empress rejected when empress is in cold palace", () => {
    const EMPRESS = "shen_zhibai";
    const store = makeStore();

    // Send empress to cold palace.
    const r = store.sendConsortToColdPalace(db, EMPRESS, {});
    expect(r.ok).toBe(true);
    expect(store.getState().haremAdministration.mode).not.toBe("empress");

    // Try to restore empress authority via set_harem_administration.
    const restoreAttempt = store.applyEffects(db, [
      { type: "set_harem_administration", state: { mode: "empress" } },
    ]);
    expect(restoreAttempt.ok).toBe(false);
  });
});

// ── CP-DEATH2: confined consort natural death resolves confinement PunishmentRecord ─────

describe("cold palace — death reconciliation for confinement (Fix 2)", () => {
  it("CP-DEATH2. natural death while confined resolves confinement PunishmentRecord as target_deceased", () => {
    const store = makeStore();

    // Impose confinement.
    const confineCmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 9 };
    const confineResult = store.applyImperialPunishmentWithConsequences(db, confineCmd, {});
    expect(confineResult.ok).toBe(true);

    // Find the confinement PunishmentRecord.
    const punishments = Object.values(store.getState().justice.punishments);
    const confinePun = punishments.find(
      (p) => p.kind === "finite_confinement" || p.kind === "indefinite_confinement",
    );
    expect(confinePun).toBeDefined();
    if (!confinePun) return;
    expect(confinePun.lifecycle.status).toBe("active");
    const confinePunId = confinePun.id;

    // Apply natural death.
    const now = store.getState().calendar;
    const deathResult = store.applyEffects(db, [{
      type: "consort_decease",
      char: TARGET,
      at: { year: now.year, month: now.month, period: now.period, dayIndex: now.dayIndex },
      cause: "illness",
    }]);
    expect(deathResult.ok).toBe(true);

    // PunishmentRecord must now be resolved.
    const updatedPun = store.getState().justice.punishments[confinePunId];
    expect(updatedPun?.lifecycle.status).toBe("completed");
    expect((updatedPun?.lifecycle as { resolution?: string }).resolution).toBe("target_deceased");
  });
});

// ── CP-CHAMBER1: restore uses chamber-level occupancy check ─────────────────────────────

describe("cold palace — chamber-level restore (Fix 3)", () => {
  it("CP-CHAMBER1. restoreFromColdPalace uses original chamber when free", () => {
    const store = makeStore();

    store.sendConsortToColdPalace(db, TARGET, {});

    // Capture previousResidenceId and previousChamber from the ColdPalaceEffect
    // (this is what we expect to be restored — the effect records the source slot).
    const se = store.getState().statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(se).toBeDefined();
    if (!se || se.kind !== "cold_palace") return;
    const expectedResidence = se.previousResidenceId;
    const expectedChamber = se.previousChamber ?? "main";

    const r = store.restoreFromColdPalace(db, TARGET, "pardoned");
    expect(r.ok).toBe(true);
    expect(store.getState().standing[TARGET]?.residence).toBe(expectedResidence);
    expect(store.getState().standing[TARGET]?.chamber ?? "main").toBe(expectedChamber);
  });

  it("CP-CHAMBER2. restoreFromColdPalace falls back when original chamber is occupied", () => {
    const store = makeStore();

    // Send TARGET to cold palace — original slot is zhongcui_gong/main.
    store.sendConsortToColdPalace(db, TARGET, {});

    const se = store.getState().statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === TARGET,
    );
    expect(se).toBeDefined();
    if (!se || se.kind !== "cold_palace") return;

    // Occupy TARGET's original chamber by moving another living consort into it.
    // xu_qinghuan is a non-empress consort we can place there.
    const occupierId = "xu_qinghuan";
    const occupierStanding = store.getState().standing[occupierId];
    expect(occupierStanding).toBeDefined();
    if (!occupierStanding) return;

    // Force-set occupier's residence and chamber to match TARGET's original slot.
    // Direct state mutation for test setup: bypasses state machine to create the occupied scenario.
    store.getState().standing[occupierId] = {
      ...occupierStanding,
      residence: se.previousResidenceId,
      chamber: (se.previousChamber ?? "main") as typeof occupierStanding.chamber,
    };

    // Now restore TARGET — original slot is occupied, should fall back to another slot.
    const r = store.restoreFromColdPalace(db, TARGET, "pardoned");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const standing = store.getState().standing[TARGET]!;
    expect(standing.lifecycle).not.toBe("deceased");
    expect(standing.residence).toBeTruthy();
    // The restored slot must differ from the original (since original is occupied).
    const restoredKey = `${standing.residence}:${standing.chamber ?? "main"}`;
    const originalKey = `${se.previousResidenceId}:${se.previousChamber ?? "main"}`;
    expect(restoredKey).not.toBe(originalKey);
  });

  it("CP-CHAMBER3. restoreFromColdPalace fails when no chamber is available", () => {
    const store = makeStore();

    // Send TARGET to cold palace first.
    const r0 = store.sendConsortToColdPalace(db, TARGET, {});
    expect(r0.ok).toBe(true);

    // Fill every chambered-palace slot with synthetic standing entries so that
    // isSlotOccupied returns true for every possible restore destination.
    // Use loadState to inject the modified state so the store sees the new entries.
    const stateAfterSend = store.getState();
    const synStanding: Record<string, unknown> = { ...stateAfterSend.standing };
    let synIdx = 0;
    for (const palace of CHAMBERED_PALACE_ORDER) {
      for (const { id: chamberId } of CHAMBERS) {
        const synId = `__syn_${synIdx++}`;
        synStanding[synId] = {
          lifecycle: "alive",
          residence: palace,
          chamber: chamberId,
          rank: "guiren",
          title: undefined,
        };
      }
    }
    store.loadState({ ...stateAfterSend, standing: synStanding as typeof stateAfterSend.standing });

    const stateBeforeRestore = JSON.parse(JSON.stringify(store.getState()));

    // Now restore should fail — no available slot.
    const r = store.restoreFromColdPalace(db, TARGET, "pardoned");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.some((e: GameError) => e.code === "COLD_PALACE_INVALID")).toBe(true);
    // Atomicity: failed restore must leave state unchanged.
    expect(store.getState()).toEqual(stateBeforeRestore);
  });
});

// ── CP-PROV1: sourceCaseId flows into target memory when caseId provided ────────────────

describe("cold palace — case provenance in memory (Fix 5)", () => {
  it("CP-PROV1. sendConsortToColdPalace with caseId writes sourceCaseId into target memory", () => {
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

    const fakeCaseId = "case_000001";
    const r = store.sendConsortToColdPalace(db, TARGET, { caseId: fakeCaseId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Find memory entry for TARGET with sourcePunishmentId.
    const memories = store.getState().memories[TARGET]?.entries ?? [];
    const punMemory = memories.find((m) => m.sourcePunishmentId === r.value.punishmentId);
    expect(punMemory).toBeDefined();
    expect((punMemory as { sourceCaseId?: string })?.sourceCaseId).toBe(fakeCaseId);
  });

  it("CP-PROV2a. empress → acting_consort reason is imperial_deprivation (not imperial_reassignment)", () => {
    const EMPRESS = "shen_zhibai";
    const store = makeStore();
    const r = store.sendConsortToColdPalace(db, EMPRESS, {});
    expect(r.ok).toBe(true);
    const admin = store.getState().haremAdministration;
    // Either acting_consort or neiwu_proxy — both must use imperial_deprivation.
    expect((admin as { reason?: string }).reason).toBe("imperial_deprivation");
  });

  it("CP-PROV2. restoreFromColdPalace derives caseId from PunishmentRecord (not meta)", () => {
    const store = makeStore();
    // Create a case and send to cold palace with it.
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

    store.sendConsortToColdPalace(db, TARGET, { caseId: "case_000001" });

    // Restore WITHOUT passing meta.caseId — it should still derive the caseId from the punishment.
    const restoreResult = store.restoreFromColdPalace(db, TARGET, "pardoned");
    expect(restoreResult.ok).toBe(true);

    // Verify chronicle entry has caseId derived from PunishmentRecord.
    const chronicle = store.getState().chronicle;
    const restoreEntry = chronicle.find(
      (e) => (e.payload as { decree?: string })?.decree === "cold_palace_restored",
    );
    expect(restoreEntry).toBeDefined();
    expect((restoreEntry?.links as { caseId?: string })?.caseId).toBe("case_000001");
  });
});

// ── CP-BATCH: Same-batch harem bypass prevention ──────────────────────────────

describe("cold palace — same-batch set_harem_administration bypass", () => {
  it("CP-BATCH1. send_to_cold_palace(empress) + set_harem_administration(empress) in same batch is rejected", () => {
    const EMPRESS = "shen_zhibai";
    const store = makeStore();
    const gameTime = toGameTime(store.getState().calendar);

    // Attempt: send empress to cold palace AND restore her to empress in one batch.
    const r = store.applyEffects(db, [
      {
        type: "send_to_cold_palace" as const,
        char: EMPRESS,
        statusEffectId: "se_shen_zhibai_000001",
        punishmentId: "pun_000001",
        coldPalaceResidenceId: "changmengong",
        previousResidenceId: "zhongcui_gong",
        startedAt: gameTime,
        startTurn: store.getState().calendar.dayIndex,
      },
      {
        type: "set_harem_administration",
        state: { mode: "empress" },
      },
    ]);
    // The batch must fail — set_harem_administration to empress is invalid when empress is being sent to cold palace.
    expect(r.ok).toBe(false);
  });
});

// ── CP-XLINK: Confinement historical cross-link corruption tests ──────────────

describe("cold palace — confinement historical cross-link validation", () => {
  it("CP-XLINK1. lifted ConfinementEffect pointing at wrong-kind punishment is detected", () => {
    const store = makeStore();
    // Send TARGET to cold palace to create a cold_palace PunishmentRecord.
    store.sendConsortToColdPalace(db, TARGET, {});
    const state = store.getState();
    const coldPalacePun = Object.values(state.justice.punishments).find(p => p.kind === "cold_palace");
    expect(coldPalacePun).toBeDefined();

    // Inject a lifted ConfinementEffect that (wrongly) points to the cold_palace PunishmentRecord.
    const corruptedState = {
      ...state,
      statusEffects: [
        ...state.statusEffects,
        {
          id: "se_corrupt_001",
          kind: "confinement" as const,
          characterId: TARGET,
          startedAt: toGameTime(state.calendar),
          startTurn: state.calendar.dayIndex,
          sourcePunishmentId: coldPalacePun!.id,
          liftedTurn: state.calendar.dayIndex + 1,
          liftedAt: toGameTime(state.calendar),
          liftReason: "lifted_by_emperor" as const,
        },
      ],
    };
    const errors = validateJusticeLinks(corruptedState as unknown as Parameters<typeof validateJusticeLinks>[0]);
    expect(errors.some(e => e.code === "BAD_JUSTICE_CROSSLINK")).toBe(true);
  });

  it("CP-XLINK2. resolved confinement punishment referencing missing effect is detected", () => {
    const store = makeStore();
    const state = store.getState();
    const now = toGameTime(state.calendar);

    // Inject a completed confinement PunishmentRecord referencing a non-existent effect.
    const corruptedState = {
      ...state,
      justice: {
        ...state.justice,
        punishments: {
          ...state.justice.punishments,
          "pun_corrupt_001": {
            id: "pun_corrupt_001",
            kind: "indefinite_confinement" as const,
            targetId: TARGET,
            actorId: "player",
            severity: "moderate" as const,
            imposedAt: now,
            publicity: "palace" as const,
            lifecycle: { status: "completed" as const, resolvedAt: now, resolution: "target_deceased" as const },
            details: { statusEffectId: "se_does_not_exist" },
          },
        },
      },
    };
    const errors = validateJusticeLinks(corruptedState as unknown as Parameters<typeof validateJusticeLinks>[0]);
    expect(errors.some(e => e.code === "BAD_JUSTICE_CROSSLINK")).toBe(true);
  });

  it("CP-XLINK3. resolved confinement punishment with still-active effect is detected", () => {
    const store = makeStore();
    const state = store.getState();
    const now = toGameTime(state.calendar);
    const effectId = "se_corrupt_002";

    // Inject: completed punishment + active ConfinementEffect (contradiction).
    const corruptedState = {
      ...state,
      statusEffects: [
        ...state.statusEffects,
        {
          id: effectId,
          kind: "confinement" as const,
          characterId: TARGET,
          startedAt: now,
          startTurn: state.calendar.dayIndex,
          sourcePunishmentId: "pun_corrupt_002",
          // liftedTurn deliberately omitted — effect is still "active"
        },
      ],
      justice: {
        ...state.justice,
        punishments: {
          ...state.justice.punishments,
          "pun_corrupt_002": {
            id: "pun_corrupt_002",
            kind: "indefinite_confinement" as const,
            targetId: TARGET,
            actorId: "player",
            severity: "moderate" as const,
            imposedAt: now,
            publicity: "palace" as const,
            lifecycle: { status: "completed" as const, resolvedAt: now, resolution: "target_deceased" as const },
            details: { statusEffectId: effectId },
          },
        },
      },
    };
    const errors = validateJusticeLinks(corruptedState as unknown as Parameters<typeof validateJusticeLinks>[0]);
    expect(errors.some(e => e.code === "BAD_JUSTICE_CROSSLINK")).toBe(true);
  });
});
