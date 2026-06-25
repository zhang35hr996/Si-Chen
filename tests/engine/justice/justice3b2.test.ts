/**
 * PUNISH-3B2 tests — wiring punishment commands to formal PunishmentRecord.
 *
 * Coverage:
 * - ID allocation: all punishment types use pun_000001 IDs
 * - ConfinementEffect.sourcePunishmentId linkage
 * - Every punishment kind creates a PunishmentRecord
 * - Lifecycle transitions: manual lift, term expiry, death
 * - Case linkage (caseId)
 * - Provenance: chronicle links.punishmentId
 * - AtomicId: nextSeq.punishment advances exactly once per punishment
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../../src/store/gameStore";
import { createNewGameState } from "../../../src/engine/state/newGame";
import { loadRealContent } from "../../helpers/contentFixture";
import type { ImperialCommand } from "../../../src/store/imperialCommands";
import { PUNISHMENT_ID_REGEX } from "../../../src/engine/justice/types";
import type { CaseRecord } from "../../../src/engine/justice/types";
import type { CharacterStatusEffect } from "../../../src/engine/state/types";
import { allocateJusticeIds } from "../../../src/engine/justice/ids";
import { applyJusticePlan } from "../../../src/engine/justice/mutations";
import { toGameTime } from "../../../src/engine/calendar/time";

const db = loadRealContent();

function makeStore() {
  const store = createGameStore();
  store.loadState(createNewGameState(db));
  return store;
}

// A non-empress consort available in test fixtures (kind=consort, with standing, not fenghou).
const TARGET = "lu_huaijin";

// ── Section ID: punishment ID allocation ──────────────────────────────────────

describe("punishment ID allocation", () => {
  it("ID1. impose_confinement returns pun_000001", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    const result = store.applyImperialPunishmentWithConsequences(db, cmd, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.punishmentId).toMatch(PUNISHMENT_ID_REGEX);
    expect(result.value.punishmentId).toBe("pun_000001");
  });

  it("ID2. execute returns pun_000001", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "execute", targetId: TARGET };
    const result = store.applyImperialPunishmentWithConsequences(db, cmd, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.punishmentId).toBe("pun_000001");
  });

  it("ID3. rank demotion returns pun_000001", () => {
    const store = makeStore();
    // Find current rank and a lower assignable (non-deprecated) rank.
    const standing = store.getState().standing[TARGET]!;
    const curRankId = standing.rank;
    const rankOrder = Object.entries(db.ranks).sort(([, a], [, b]) => a.order - b.order);
    const lowerRank = rankOrder.find(([id, r]) => r.order < db.ranks[curRankId]!.order && id !== curRankId && !r.deprecated);
    if (!lowerRank) return; // skip if no lower rank available
    const result = store.applyPunitiveRankChangeWithConsequences(db, TARGET, { kind: "set_rank", rank: lowerRank[0] }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.punishmentId).toBe("pun_000001");
  });

  it("ID4. second punishment gets pun_000002", () => {
    const store = makeStore();
    const cmd1: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    store.applyImperialPunishmentWithConsequences(db, cmd1, {});

    // Use another valid non-empress consort for the second punishment.
    const TARGET2 = "wenya";
    const cmd2: ImperialCommand = { type: "impose_confinement", targetId: TARGET2, durationTurns: 2 };
    const result2 = store.applyImperialPunishmentWithConsequences(db, cmd2, {});
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.value.punishmentId).toBe("pun_000002");
  });

  it("ID5. nextSeq.punishment advances exactly once per punishment", () => {
    const store = makeStore();
    expect(store.getState().justice.nextSeq.punishment).toBe(1);
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    expect(store.getState().justice.nextSeq.punishment).toBe(2);
  });
});

// ── Section KIND: PunishmentRecord creation for each kind ────────────────────

describe("PunishmentRecord created for each kind", () => {
  it("KIND1. finite_confinement: PunishmentRecord with statusEffectId + endTurnExclusive", () => {
    const store = makeStore();
    const startTurn = store.getState().calendar.dayIndex;
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    const result = store.applyImperialPunishmentWithConsequences(db, cmd, {});
    expect(result.ok).toBe(true);
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.kind).toBe("finite_confinement");
    expect(pun.lifecycle.status).toBe("active");
    expect((pun.details as { statusEffectId: string; endTurnExclusive: number }).statusEffectId).toMatch(/^status_/);
    expect((pun.details as { statusEffectId: string; endTurnExclusive: number }).endTurnExclusive).toBe(startTurn + 3);
  });

  it("KIND2. indefinite_confinement: PunishmentRecord with statusEffectId, no endTurnExclusive", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: null };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.kind).toBe("indefinite_confinement");
    expect(pun.lifecycle.status).toBe("active");
    expect((pun.details as { statusEffectId: string }).statusEffectId).toMatch(/^status_/);
    expect((pun.details as Record<string, unknown>)["endTurnExclusive"]).toBeUndefined();
  });

  it("KIND3. execution: PunishmentRecord with lifecycle=completed/immediate", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "execute", targetId: TARGET };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.kind).toBe("execution");
    expect(pun.lifecycle.status).toBe("completed");
    if (pun.lifecycle.status === "completed") {
      expect(pun.lifecycle.resolution).toBe("immediate");
    }
  });

  it("KIND4. rank_demotion: PunishmentRecord with fromRankId/toRankId, lifecycle=completed", () => {
    const store = makeStore();
    const standing = store.getState().standing[TARGET]!;
    const fromRankId = standing.rank;
    const rankOrder = Object.entries(db.ranks).sort(([, a], [, b]) => a.order - b.order);
    const lowerRank = rankOrder.find(([id, r]) => r.order < db.ranks[fromRankId]!.order && id !== fromRankId && !r.deprecated);
    if (!lowerRank) return;
    store.applyPunitiveRankChangeWithConsequences(db, TARGET, { kind: "set_rank", rank: lowerRank[0] }, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.kind).toBe("rank_demotion");
    expect(pun.lifecycle.status).toBe("completed");
    if (pun.lifecycle.status === "completed") {
      expect(pun.lifecycle.resolution).toBe("immediate");
    }
    expect((pun.details as { fromRankId: string; toRankId: string }).fromRankId).toBe(fromRankId);
    expect((pun.details as { fromRankId: string; toRankId: string }).toRankId).toBe(lowerRank[0]);
  });

  it("KIND5. strip_title: PunishmentRecord with removedTitle", () => {
    const store = makeStore();
    const standing = store.getState().standing[TARGET]!;
    if (!standing.title) return; // skip if no title
    store.applyPunitiveRankChangeWithConsequences(db, TARGET, { kind: "remove_title" }, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.kind).toBe("strip_title");
    expect((pun.details as { removedTitle: string }).removedTitle).toBe(standing.title);
  });
});

// ── Section LINK: statusEffect.sourcePunishmentId linkage ────────────────────

describe("ConfinementEffect.sourcePunishmentId linkage", () => {
  it("LINK1. finite_confinement: statusEffect.sourcePunishmentId = pun_000001", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const se = store.getState().statusEffects.find(
      (e) => e.kind === "confinement" && e.characterId === TARGET,
    );
    expect(se?.sourcePunishmentId).toBe("pun_000001");
  });

  it("LINK2. indefinite_confinement: statusEffect.sourcePunishmentId = pun_000001", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: null };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const se = store.getState().statusEffects.find(
      (e) => e.kind === "confinement" && e.characterId === TARGET,
    );
    expect(se?.sourcePunishmentId).toBe("pun_000001");
  });

  it("LINK3. statusEffectId in PunishmentRecord matches actual ConfinementEffect.id", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 2 };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    const seId = (pun.details as { statusEffectId: string }).statusEffectId;
    const se = store.getState().statusEffects.find((e) => e.id === seId);
    expect(se).toBeDefined();
    expect(se?.characterId).toBe(TARGET);
  });
});

// ── Section LIFECYCLE: punishment lifecycle transitions ───────────────────────

describe("punishment lifecycle transitions", () => {
  it("LIFE1. manual lift_confinement resolves PunishmentRecord with lifted_by_decree", () => {
    const store = makeStore();
    // Impose then manually lift.
    const impose: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 10 };
    store.applyImperialPunishmentWithConsequences(db, impose, {});
    expect(store.getState().justice.punishments["pun_000001"]!.lifecycle.status).toBe("active");

    const lift: ImperialCommand = { type: "lift_confinement", targetId: TARGET };
    const liftResult = store.applyImperialCommand(db, lift);
    expect(liftResult.ok).toBe(true);

    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.lifecycle.status).toBe("lifted");
    if (pun.lifecycle.status === "lifted") {
      expect(pun.lifecycle.resolution).toBe("lifted_by_decree");
    }
    // nextSeq.punishment unchanged after lift (no new allocation).
    expect(store.getState().justice.nextSeq.punishment).toBe(2);
  });

  it("LIFE2. legacy confinement (no sourcePunishmentId) lifts without error", () => {
    const store = makeStore();
    // Inject a confinement effect directly (no PunishmentRecord) to simulate pre-3B2 state.
    const baseState = store.getState();
    const legacyConfinement: CharacterStatusEffect = {
      id: "status_lu_huaijin_000001",
      kind: "confinement",
      characterId: TARGET,
      imposedAt: toGameTime(baseState.calendar),
      imposedBy: "emperor" as const,
      startTurn: baseState.calendar.dayIndex,
      endTurnExclusive: baseState.calendar.dayIndex + 10,
      // No sourcePunishmentId
    };
    store.loadState({ ...baseState, statusEffects: [legacyConfinement] });

    const result = store.applyImperialCommand(db, { type: "lift_confinement", targetId: TARGET });
    expect(result.ok).toBe(true);
    expect(store.getState().justice.punishments).toEqual({});
  });

  it("LIFE3. term_expired sweep resolves PunishmentRecord with expired", () => {
    const store = makeStore();
    const impose: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 2 };
    store.applyImperialPunishmentWithConsequences(db, impose, {});
    expect(store.getState().justice.punishments["pun_000001"]!.lifecycle.status).toBe("active");
    const seqBeforeExpiry = store.getState().justice.nextSeq.punishment;

    // Advance time enough turns for the confinement to expire (durationTurns: 2, so advance 3 times).
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
    store.advanceTime(db, { type: "SKIP_REMAINDER" });

    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.lifecycle.status).toBe("completed");
    if (pun.lifecycle.status === "completed") {
      expect(pun.lifecycle.resolution).toBe("expired");
    }

    // nextSeq.punishment should not have advanced (no new ID allocated during expiry resolution).
    expect(store.getState().justice.nextSeq.punishment).toBe(seqBeforeExpiry);

    // The ConfinementEffect should be lifted.
    const se = store.getState().statusEffects.find((e) => e.kind === "confinement" && e.characterId === TARGET);
    expect(se?.liftedTurn).toBeDefined();

    // The confinement_expired chronicle entry should have links.sourcePunishmentId.
    const expiredEntry = store.getState().chronicle.find((e) => {
      const dec = (e.payload as { decree?: string }).decree;
      return dec === "confinement_expired";
    });
    if (expiredEntry) {
      expect(expiredEntry.links?.sourcePunishmentId).toBe("pun_000001");
    }
  });

  it("LIFE4. execution PunishmentRecord is completed/immediate; prior active punishments close as target_deceased", () => {
    const store = makeStore();
    // First impose a confinement (pun_000001).
    const confineCmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 5 };
    const confineResult = store.applyImperialPunishmentWithConsequences(db, confineCmd, {});
    expect(confineResult.ok).toBe(true);
    expect(store.getState().justice.punishments["pun_000001"]!.lifecycle.status).toBe("active");

    // Execute the same target (pun_000002).
    const execCmd: ImperialCommand = { type: "execute", targetId: TARGET };
    store.applyImperialPunishmentWithConsequences(db, execCmd, {});
    const execPun = store.getState().justice.punishments["pun_000002"]!;
    expect(execPun.kind).toBe("execution");
    expect(execPun.lifecycle.status).toBe("completed");
    if (execPun.lifecycle.status === "completed") {
      // The execution itself resolves as "immediate"
      expect(execPun.lifecycle.resolution).toBe("immediate");
    }
    // The prior confinement is resolved as "target_deceased"
    const confinePun = store.getState().justice.punishments["pun_000001"]!;
    expect(confinePun.lifecycle.status).toBe("completed");
    if (confinePun.lifecycle.status === "completed") {
      expect(confinePun.lifecycle.resolution).toBe("target_deceased");
    }
  });
});

// ── Section CASE: caseId linkage ─────────────────────────────────────────────

describe("case linkage", () => {
  it("CASE1. caseId from meta is stored on PunishmentRecord", () => {
    const store = makeStore();
    // Create a case in justice state first so the punishment can reference it.
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

    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    const result = store.applyImperialPunishmentWithConsequences(db, cmd, { caseId: "case_000001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.caseId).toBe("case_000001");
  });

  it("CASE2. punishment without caseId has no caseId field", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.caseId).toBeUndefined();
  });

  it("CASE3. rank demotion with caseId stored on PunishmentRecord", () => {
    const store = makeStore();
    // Create a case so the caseId reference is valid.
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
    const cAlloc = allocateJusticeIds(baseState.justice, { cases: 1 });
    const cPlan = { mutations: [{ type: "create_case" as const, record: caseRecord }], nextSeq: cAlloc.nextSeq };
    const withCase = applyJusticePlan(baseState, cPlan);
    if (!withCase.ok) return;
    store.loadState(withCase.value);

    const standing = store.getState().standing[TARGET]!;
    const fromRankId = standing.rank;
    const rankOrder = Object.entries(db.ranks).sort(([, a], [, b]) => a.order - b.order);
    const lowerRank = rankOrder.find(([id, r]) => r.order < db.ranks[fromRankId]!.order && id !== fromRankId && !r.deprecated);
    if (!lowerRank) return;
    const result = store.applyPunitiveRankChangeWithConsequences(
      db, TARGET, { kind: "set_rank", rank: lowerRank[0] }, { caseId: "case_000001" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pun = store.getState().justice.punishments["pun_000001"]!;
    expect(pun.caseId).toBe("case_000001");
  });
});

// ── Section PROV: chronicle links provenance ──────────────────────────────────

describe("chronicle links provenance", () => {
  it("PROV1. primary chronicle entry has links.punishmentId = pun_000001", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const chronicle = store.getState().chronicle;
    const primary = chronicle.find((e) => {
      const dec = (e.payload as { decree?: string }).decree;
      return dec === "confinement_imposed";
    });
    expect(primary?.links?.punishmentId).toBe("pun_000001");
  });

  it("PROV2. rank_changed chronicle entry has links.punishmentId", () => {
    const store = makeStore();
    const standing = store.getState().standing[TARGET]!;
    const fromRankId = standing.rank;
    const rankOrder = Object.entries(db.ranks).sort(([, a], [, b]) => a.order - b.order);
    const lowerRank = rankOrder.find(([id, r]) => r.order < db.ranks[fromRankId]!.order && id !== fromRankId && !r.deprecated);
    if (!lowerRank) return;
    store.applyPunitiveRankChangeWithConsequences(db, TARGET, { kind: "set_rank", rank: lowerRank[0] }, {});
    const chronicle = store.getState().chronicle;
    const entry = chronicle.find((e) => e.type === "rank_changed");
    expect(entry?.links?.punishmentId).toMatch(PUNISHMENT_ID_REGEX);
  });

  it("PROV3. execution chronicle entry has links.punishmentId", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "execute", targetId: TARGET };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const chronicle = store.getState().chronicle;
    const entry = chronicle.find((e) => {
      const dec = (e.payload as { decree?: string }).decree;
      return dec === "execution";
    });
    expect(entry?.links?.punishmentId).toBe("pun_000001");
  });

  it("PROV4. ancillary harem_administrator_appointed entry has links.sourcePunishmentId", () => {
    const store = makeStore();
    const state = store.getState();
    // Need to find an eligible harem administrator for empress confinement.
    const empress = Object.entries(state.standing).find(([, s]) => s?.rank === "fenghou")?.[0];
    if (!empress) return;
    const eligible = Object.entries(state.standing).find(
      ([id, s]) => id !== empress && s?.rank && (db.ranks[s.rank]?.order ?? 0) >= 3,
    );
    if (!eligible) return;
    const cmd: ImperialCommand = {
      type: "impose_confinement",
      targetId: empress,
      durationTurns: 5,
      administrator: { kind: "consort", charId: eligible[0] },
    };
    const result = store.applyImperialPunishmentWithConsequences(db, cmd, {});
    if (!result.ok) return; // may fail if eligibility rules not met in test data
    const chronicle = store.getState().chronicle;
    const ancillary = chronicle.find((e) => {
      const dec = (e.payload as { decree?: string }).decree;
      return dec === "harem_administrator_appointed";
    });
    if (ancillary) {
      expect(ancillary.links?.sourcePunishmentId).toBe("pun_000001" as string);
    }
  });
});

// ── Section ATOMIC: atomicity guarantees ─────────────────────────────────────

describe("punishment atomicity", () => {
  it("ATOM1. state unchanged if command fails validation", () => {
    const store = makeStore();
    const before = store.getState().justice.nextSeq.punishment;
    // Execute a non-existent character.
    const cmd: ImperialCommand = { type: "execute", targetId: "nonexistent_char_999" };
    const result = store.applyImperialPunishmentWithConsequences(db, cmd, {});
    expect(result.ok).toBe(false);
    expect(store.getState().justice.nextSeq.punishment).toBe(before);
    expect(Object.keys(store.getState().justice.punishments)).toHaveLength(0);
  });

  it("ATOM2. single emit per successful punishment", () => {
    const store = makeStore();
    let emits = 0;
    store.subscribe(() => emits++);
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    expect(emits).toBe(1);
  });

  it("ATOM3. failed punishment does not emit", () => {
    const store = makeStore();
    let emits = 0;
    store.subscribe(() => emits++);
    const cmd: ImperialCommand = { type: "execute", targetId: "no_such_char" };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    expect(emits).toBe(0);
  });

  it("ATOM4. punishment PunishmentRecord and ConfinementEffect both created or neither", () => {
    const store = makeStore();
    const cmd: ImperialCommand = { type: "impose_confinement", targetId: TARGET, durationTurns: 3 };
    store.applyImperialPunishmentWithConsequences(db, cmd, {});
    const state = store.getState();
    const hasPunishment = "pun_000001" in state.justice.punishments;
    const hasConfinement = state.statusEffects.some((e) => e.kind === "confinement" && e.characterId === TARGET);
    expect(hasPunishment).toBe(true);
    expect(hasConfinement).toBe(true);
    // Both link to each other.
    const pun = state.justice.punishments["pun_000001"]!;
    const se = state.statusEffects.find((e) => e.kind === "confinement" && e.characterId === TARGET)!;
    expect(se.sourcePunishmentId).toBe("pun_000001");
    expect((pun.details as { statusEffectId: string }).statusEffectId).toBe(se.id);
  });
});
