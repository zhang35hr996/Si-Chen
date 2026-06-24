/**
 * PUNISH-3B1: Justice state tests (~35 tests).
 * Covers: ID format, state/schema, case lifecycle, transaction atomicity.
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../../src/engine/state/newGame";
import { createInitialState } from "../../../src/engine/state/initialState";
import { loadRealContent } from "../../helpers/contentFixture";
import { createGameStore } from "../../../src/store/gameStore";
import {
  formatCaseId, formatPunishmentId, formatChargeId, formatEvidenceId,
  formatConfessionId, formatVerdictId, isCaseId, isPunishmentId,
  isChargeId, isEvidenceId, isConfessionId, isVerdictId,
  allocateJusticeIds, nextCaseId, nextPunishmentId, seqFromId,
} from "../../../src/engine/justice/ids";
import { applyJusticeMutations } from "../../../src/engine/justice/mutations";
import {
  getCase, getPunishment, activePunishmentsForTarget,
  activePunishmentByKind, caseForPunishment, isPunishmentActive,
  punishmentsForCase,
} from "../../../src/engine/justice/selectors";
import { autosave, readSlot } from "../../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../../src/engine/save/storage";
import type { CaseRecord, PunishmentRecord } from "../../../src/engine/justice/types";
import type { GameState } from "../../../src/engine/state/types";
import { toGameTime } from "../../../src/engine/calendar/time";

const db = loadRealContent();

function makeState(): GameState {
  return createNewGameState(db);
}

function makeNow(state: GameState) {
  return toGameTime(state.calendar);
}

function makeCase(state: GameState, overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: nextCaseId(state.justice),
    status: "open",
    subjectIds: ["shen_zhibai"],
    openedAt: makeNow(state),
    openedBy: "player",
    source: { kind: "imperial" },
    publicity: "palace",
    charges: [],
    evidence: [],
    confessions: [],
    punishmentIds: [],
    ...overrides,
  };
}

function makePunishment(state: GameState, caseId?: string): PunishmentRecord {
  return {
    id: nextPunishmentId(state.justice),
    caseId: caseId as (typeof state.justice)["punishments"][string]["caseId"],
    targetId: "shen_zhibai",
    actorId: "player",
    kind: "rank_demotion",
    severity: "moderate",
    imposedAt: makeNow(state),
    sourceLocation: "zichendian",
    publicity: "palace",
    lifecycle: { status: "active" },
    details: { fromRankId: "fenghou", toRankId: "gui" },
  } as PunishmentRecord;
}

// ── Section 1: State/schema baseline ─────────────────────────────────────────

describe("justice state — new game baseline", () => {
  it("S1. new game justice state is empty", () => {
    const state = makeState();
    expect(state.justice.cases).toEqual({});
    expect(state.justice.punishments).toEqual({});
  });

  it("S2. all sequences start at 1", () => {
    const state = makeState();
    expect(state.justice.nextSeq).toEqual({
      case: 1, punishment: 1, charge: 1, evidence: 1, confession: 1, verdict: 1,
    });
  });

  it("S3. createInitialState also has empty justice", () => {
    const state = createInitialState();
    expect(state.justice.cases).toEqual({});
    expect(state.justice.nextSeq.case).toBe(1);
  });
});

// ── Section 2: ID format ──────────────────────────────────────────────────────

describe("justice IDs — format and validation", () => {
  it("ID1. case IDs have correct format", () => {
    expect(formatCaseId(1)).toBe("case_000001");
    expect(formatCaseId(100)).toBe("case_000100");
    expect(formatCaseId(999999)).toBe("case_999999");
  });

  it("ID2. punishment IDs have correct format", () => {
    expect(formatPunishmentId(1)).toBe("pun_000001");
    expect(formatPunishmentId(42)).toBe("pun_000042");
  });

  it("ID3. sub-record IDs have correct format", () => {
    expect(formatChargeId(1)).toBe("chg_000001");
    expect(formatEvidenceId(1)).toBe("evi_000001");
    expect(formatConfessionId(1)).toBe("cnf_000001");
    expect(formatVerdictId(1)).toBe("vdt_000001");
  });

  it("ID4. isCaseId validates format", () => {
    expect(isCaseId("case_000001")).toBe(true);
    expect(isCaseId("pun_000001")).toBe(false);
    expect(isCaseId("case_00001")).toBe(false); // only 5 digits
    expect(isCaseId("")).toBe(false);
  });

  it("ID5. isPunishmentId validates format", () => {
    expect(isPunishmentId("pun_000001")).toBe(true);
    expect(isPunishmentId("case_000001")).toBe(false);
  });

  it("ID6. all sub-record ID validators work", () => {
    expect(isChargeId("chg_000001")).toBe(true);
    expect(isEvidenceId("evi_000001")).toBe(true);
    expect(isConfessionId("cnf_000001")).toBe(true);
    expect(isVerdictId("vdt_000001")).toBe(true);
    // Cross-type rejects
    expect(isChargeId("evi_000001")).toBe(false);
  });

  it("ID7. seqFromId extracts sequence number", () => {
    expect(seqFromId("case_000042")).toBe(42);
    expect(seqFromId("pun_000001")).toBe(1);
    expect(seqFromId("invalid")).toBeUndefined();
  });

  it("ID8. nextCaseId / nextPunishmentId return first available ID", () => {
    const state = makeState();
    expect(nextCaseId(state.justice)).toBe("case_000001");
    expect(nextPunishmentId(state.justice)).toBe("pun_000001");
  });

  it("ID9. allocateJusticeIds allocates correct sequence of IDs", () => {
    const state = makeState();
    const alloc = allocateJusticeIds(state.justice, { cases: 2, punishments: 3 });
    expect(alloc.cases).toEqual(["case_000001", "case_000002"]);
    expect(alloc.punishments).toEqual(["pun_000001", "pun_000002", "pun_000003"]);
    expect(alloc.nextSeq.case).toBe(3);
    expect(alloc.nextSeq.punishment).toBe(4);
    // Source state nextSeq is unchanged (pure function).
    expect(state.justice.nextSeq.case).toBe(1);
  });
});

// ── Section 3: Case lifecycle ─────────────────────────────────────────────────

describe("applyJusticeMutations — case lifecycle", () => {
  it("CL1. create case succeeds", () => {
    const state = makeState();
    const withSeq = { ...state, justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq } } };
    withSeq.justice.nextSeq.case = 2; // pre-advance
    const record = makeCase(state); // id = case_000001
    const result = applyJusticeMutations(withSeq, [{ type: "create_case", record }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.justice.cases["case_000001"]).toBeDefined();
  });

  it("CL2. duplicate case ID rejected", () => {
    const state = makeState();
    const record = makeCase(state);
    const withCase = applyJusticeMutations(
      { ...state, justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2 } } },
      [{ type: "create_case", record }],
    );
    expect(withCase.ok).toBe(true);
    if (!withCase.ok) return;
    // Try to create with same ID again.
    const dup = applyJusticeMutations(withCase.value, [{ type: "create_case", record }]);
    expect(dup.ok).toBe(false);
  });

  it("CL3. append charge to open case", () => {
    const state = makeState();
    const advancedState = { ...state, justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2 } } };
    const record = makeCase(state);
    const withCase = applyJusticeMutations(advancedState, [{ type: "create_case", record }]);
    expect(withCase.ok).toBe(true);
    if (!withCase.ok) return;
    const charge = {
      id: "chg_000001" as (typeof record.charges[number])["id"],
      summary: "刺驾",
      allegedAt: makeNow(state),
      allegedBy: "player",
      status: "alleged" as const,
    };
    const withCharge = applyJusticeMutations(withCase.value, [{
      type: "append_charge",
      caseId: record.id,
      charge,
    }]);
    expect(withCharge.ok).toBe(true);
    if (!withCharge.ok) return;
    expect(withCharge.value.justice.cases[record.id]!.charges).toHaveLength(1);
  });

  it("CL4. closed case rejects new charge", () => {
    const state = makeState();
    const now = makeNow(state);
    const advancedState = { ...state, justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2 } } };
    const record = makeCase(state);
    const withCase = applyJusticeMutations(advancedState, [
      { type: "create_case", record },
      { type: "close_case", caseId: record.id, closedAt: now },
    ]);
    expect(withCase.ok).toBe(true);
    if (!withCase.ok) return;
    const charge = { id: "chg_000001" as const, summary: "x", allegedAt: now, allegedBy: "player", status: "alleged" as const };
    const result = applyJusticeMutations(withCase.value, [{ type: "append_charge", caseId: record.id, charge }]);
    expect(result.ok).toBe(false);
  });

  it("CL5. verdict references charge in same case — ok", () => {
    const state = makeState();
    const now = makeNow(state);
    const record = makeCase(state);
    const charge = { id: "chg_000001" as const, summary: "x", allegedAt: now, allegedBy: "p", status: "alleged" as const };
    const caseWithCharge = { ...record, charges: [charge] };
    const advancedState = { ...state, justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2 } } };
    const withCase = applyJusticeMutations(advancedState, [{ type: "create_case", record: caseWithCharge }]);
    expect(withCase.ok).toBe(true);
    if (!withCase.ok) return;
    const verdict = {
      id: "vdt_000001" as const,
      decidedAt: now,
      decidedBy: "player",
      findings: [{ chargeId: "chg_000001" as const, result: "proven" as const }],
    };
    const result = applyJusticeMutations(withCase.value, [{ type: "record_verdict", caseId: record.id, verdict }]);
    expect(result.ok).toBe(true);
  });

  it("CL6. verdict references charge in different case — rejected", () => {
    const state = makeState();
    const now = makeNow(state);
    const record = makeCase(state);
    const advancedState = { ...state, justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2 } } };
    const withCase = applyJusticeMutations(advancedState, [{ type: "create_case", record }]);
    expect(withCase.ok).toBe(true);
    if (!withCase.ok) return;
    // verdict references charge NOT in this case
    const verdict = {
      id: "vdt_000001" as const,
      decidedAt: now,
      decidedBy: "player",
      findings: [{ chargeId: "chg_999999" as const, result: "proven" as const }],
    };
    const result = applyJusticeMutations(withCase.value, [{ type: "record_verdict", caseId: record.id, verdict }]);
    expect(result.ok).toBe(false);
  });

  it("CL7. second verdict on same case rejected", () => {
    const state = makeState();
    const now = makeNow(state);
    const record = makeCase(state);
    const verdict1 = { id: "vdt_000001" as const, decidedAt: now, decidedBy: "player", findings: [] };
    const verdict2 = { id: "vdt_000002" as const, decidedAt: now, decidedBy: "player", findings: [] };
    const advancedState = { ...state, justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2 } } };
    const withVerdict1 = applyJusticeMutations(advancedState, [
      { type: "create_case", record },
      { type: "record_verdict", caseId: record.id, verdict: verdict1 },
    ]);
    expect(withVerdict1.ok).toBe(true);
    if (!withVerdict1.ok) return;
    const result = applyJusticeMutations(withVerdict1.value, [{
      type: "record_verdict", caseId: record.id, verdict: verdict2,
    }]);
    expect(result.ok).toBe(false);
  });
});

// ── Section 4: Punishment lifecycle ──────────────────────────────────────────

describe("applyJusticeMutations — punishment lifecycle", () => {
  it("PL1. create punishment with valid caseId succeeds", () => {
    const state = makeState();
    const caseRecord = makeCase(state);
    const punRecord = makePunishment(state, caseRecord.id);
    const advancedState = {
      ...state,
      justice: {
        ...state.justice,
        nextSeq: { ...state.justice.nextSeq, case: 2, punishment: 2 },
      },
    };
    const result = applyJusticeMutations(advancedState, [
      { type: "create_case", record: caseRecord },
      { type: "create_punishment", record: punRecord },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.justice.punishments["pun_000001"]).toBeDefined();
  });

  it("PL2. punishment with same-batch case caseId succeeds", () => {
    const state = makeState();
    const caseRecord = makeCase(state);
    const punRecord = makePunishment(state, caseRecord.id);
    const advancedState = {
      ...state,
      justice: {
        ...state.justice,
        nextSeq: { ...state.justice.nextSeq, case: 2, punishment: 2 },
      },
    };
    const result = applyJusticeMutations(advancedState, [
      { type: "create_case", record: caseRecord },
      { type: "create_punishment", record: punRecord },
    ]);
    expect(result.ok).toBe(true);
  });

  it("PL3. punishment with non-existent caseId rejected", () => {
    const state = makeState();
    const punRecord = makePunishment(state, "case_999999");
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, punishment: 2 } },
    };
    const result = applyJusticeMutations(advancedState, [{ type: "create_punishment", record: punRecord }]);
    expect(result.ok).toBe(false);
  });

  it("PL4. case-punishment bidirectional link auto-maintained", () => {
    const state = makeState();
    const caseRecord = makeCase(state);
    const punRecord = makePunishment(state, caseRecord.id);
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2, punishment: 2 } },
    };
    const result = applyJusticeMutations(advancedState, [
      { type: "create_case", record: caseRecord },
      { type: "create_punishment", record: punRecord },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kase = result.value.justice.cases[caseRecord.id];
    expect(kase?.punishmentIds).toContain(punRecord.id);
  });

  it("PL5. resolve active punishment succeeds", () => {
    const state = makeState();
    const punRecord = makePunishment(state);
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, punishment: 2 } },
    };
    const withPun = applyJusticeMutations(advancedState, [{ type: "create_punishment", record: punRecord }]);
    expect(withPun.ok).toBe(true);
    if (!withPun.ok) return;
    const result = applyJusticeMutations(withPun.value, [{
      type: "resolve_punishment",
      punishmentId: punRecord.id,
      lifecycle: { status: "completed", resolvedAt: makeNow(state), resolution: "immediate" },
    }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.justice.punishments[punRecord.id]!.lifecycle.status).toBe("completed");
  });

  it("PL6. resolve non-active punishment rejected", () => {
    const state = makeState();
    const punRecord = makePunishment(state);
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, punishment: 2 } },
    };
    const now = makeNow(state);
    const withResolved = applyJusticeMutations(advancedState, [
      { type: "create_punishment", record: punRecord },
      { type: "resolve_punishment", punishmentId: punRecord.id, lifecycle: { status: "completed", resolvedAt: now, resolution: "immediate" } },
    ]);
    expect(withResolved.ok).toBe(true);
    if (!withResolved.ok) return;
    // Try to resolve again.
    const result = applyJusticeMutations(withResolved.value, [{
      type: "resolve_punishment",
      punishmentId: punRecord.id,
      lifecycle: { status: "lifted", resolvedAt: now, resolution: "pardoned" },
    }]);
    expect(result.ok).toBe(false);
  });

  it("PL7. punishment without caseId succeeds (standalone)", () => {
    const state = makeState();
    const punRecord: PunishmentRecord = { ...makePunishment(state), caseId: undefined };
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, punishment: 2 } },
    };
    const result = applyJusticeMutations(advancedState, [{ type: "create_punishment", record: punRecord }]);
    expect(result.ok).toBe(true);
  });
});

// ── Section 5: Selectors ──────────────────────────────────────────────────────

describe("justice selectors", () => {
  it("SEL1. getCase returns undefined for missing case", () => {
    const state = makeState();
    expect(getCase(state, "case_000001")).toBeUndefined();
  });

  it("SEL2. getPunishment returns undefined for missing punishment", () => {
    const state = makeState();
    expect(getPunishment(state, "pun_000001")).toBeUndefined();
  });

  it("SEL3. activePunishmentsForTarget returns only active records", () => {
    const state = makeState();
    const p1 = makePunishment(state);
    const p2: PunishmentRecord = {
      ...makePunishment(state),
      id: "pun_000002",
      lifecycle: { status: "completed", resolvedAt: makeNow(state), resolution: "immediate" },
    };
    const advancedState = {
      ...state,
      justice: {
        ...state.justice,
        nextSeq: { ...state.justice.nextSeq, punishment: 3 },
        punishments: { [p1.id]: p1, [p2.id]: p2 },
      },
    };
    const active = activePunishmentsForTarget(advancedState, "shen_zhibai");
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(p1.id);
  });

  it("SEL4. activePunishmentByKind returns matching active punishment", () => {
    const state = makeState();
    const p = makePunishment(state);
    const stateWithP = { ...state, justice: { ...state.justice, punishments: { [p.id]: p }, nextSeq: { ...state.justice.nextSeq, punishment: 2 } } };
    expect(activePunishmentByKind(stateWithP, "shen_zhibai", "rank_demotion")).toBeDefined();
    expect(activePunishmentByKind(stateWithP, "shen_zhibai", "execution")).toBeUndefined();
  });

  it("SEL5. caseForPunishment returns linked case", () => {
    const state = makeState();
    const caseRecord = makeCase(state);
    const punRecord = makePunishment(state, caseRecord.id);
    const stateWithBoth = {
      ...state,
      justice: {
        ...state.justice,
        cases: { [caseRecord.id]: caseRecord },
        punishments: { [punRecord.id]: punRecord },
        nextSeq: { ...state.justice.nextSeq, case: 2, punishment: 2 },
      },
    };
    const kase = caseForPunishment(stateWithBoth, punRecord.id);
    expect(kase?.id).toBe(caseRecord.id);
  });

  it("SEL6. isPunishmentActive checks lifecycle", () => {
    const state = makeState();
    const p = makePunishment(state);
    const completed: PunishmentRecord = {
      ...p,
      id: "pun_000002",
      lifecycle: { status: "completed", resolvedAt: makeNow(state), resolution: "immediate" },
    };
    const stateWithBoth = {
      ...state,
      justice: {
        ...state.justice,
        punishments: { [p.id]: p, [completed.id]: completed },
        nextSeq: { ...state.justice.nextSeq, punishment: 3 },
      },
    };
    expect(isPunishmentActive(stateWithBoth, p.id)).toBe(true);
    expect(isPunishmentActive(stateWithBoth, completed.id)).toBe(false);
    expect(isPunishmentActive(stateWithBoth, "pun_999999")).toBe(false);
  });

  it("SEL7. punishmentsForCase returns only punishments in that case", () => {
    const state = makeState();
    const caseRecord = makeCase(state);
    const p1 = makePunishment(state, caseRecord.id);
    const p2 = { ...makePunishment(state), id: "pun_000002", caseId: "case_999999" } as PunishmentRecord;
    const stateWithAll = {
      ...state,
      justice: {
        ...state.justice,
        cases: { [caseRecord.id]: { ...caseRecord, punishmentIds: [p1.id] } },
        punishments: { [p1.id]: p1, [p2.id]: p2 },
        nextSeq: { ...state.justice.nextSeq, case: 2, punishment: 3 },
      },
    };
    const result = punishmentsForCase(stateWithAll, caseRecord.id);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(p1.id);
  });
});

// ── Section 6: Save format v12 ────────────────────────────────────────────────

describe("save format v12 round-trip", () => {
  it("RT1. new game state saves and loads with empty justice", () => {
    const store = createGameStore();
    store.loadState(createNewGameState(db));
    const storage = createMemoryStorage();
    autosave(storage, db, store.getState());
    const loaded = readSlot(storage, db, "auto");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.justice.cases).toEqual({});
    expect(loaded.value.state.justice.nextSeq).toEqual({
      case: 1, punishment: 1, charge: 1, evidence: 1, confession: 1, verdict: 1,
    });
  });

  it("RT2. justice case record survives save/load round-trip", () => {
    const store = createGameStore();
    const state = makeState();
    const caseRecord = makeCase(state);
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2 } },
    };
    const withCase = applyJusticeMutations(advancedState, [{ type: "create_case", record: caseRecord }]);
    expect(withCase.ok).toBe(true);
    if (!withCase.ok) return;
    store.loadState(withCase.value);
    const storage = createMemoryStorage();
    autosave(storage, db, store.getState());
    const loaded = readSlot(storage, db, "auto");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.justice.cases[caseRecord.id]).toBeDefined();
    expect(loaded.value.state.justice.nextSeq.case).toBe(2);
  });
});

// ── Section 7: Transaction atomicity ─────────────────────────────────────────

describe("applyJusticeMutations — atomicity", () => {
  it("AT1. empty mutation batch is a no-op (returns same state)", () => {
    const state = makeState();
    const result = applyJusticeMutations(state, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.justice).toBe(state.justice);
  });

  it("AT2. mixed valid + invalid batch rejects entirely (no partial apply)", () => {
    const state = makeState();
    const validCase = makeCase(state);
    const invalidPun = makePunishment(state, "case_999999"); // unknown caseId
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2, punishment: 2 } },
    };
    const result = applyJusticeMutations(advancedState, [
      { type: "create_case", record: validCase },
      { type: "create_punishment", record: invalidPun },
    ]);
    expect(result.ok).toBe(false);
    // State must be unchanged — validCase not created.
    expect(advancedState.justice.cases["case_000001"]).toBeUndefined();
  });

  it("AT3. nextSeq not modified on rollback", () => {
    const state = makeState();
    const badPun = makePunishment(state, "case_999999");
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, punishment: 2 } },
    };
    const before = advancedState.justice.nextSeq.punishment;
    const result = applyJusticeMutations(advancedState, [{ type: "create_punishment", record: badPun }]);
    expect(result.ok).toBe(false);
    expect(advancedState.justice.nextSeq.punishment).toBe(before);
  });

  it("AT4. same-batch create_case then create_punishment linkage is consistent", () => {
    const state = makeState();
    const caseRecord = makeCase(state);
    const punRecord = makePunishment(state, caseRecord.id);
    const advancedState = {
      ...state,
      justice: { ...state.justice, nextSeq: { ...state.justice.nextSeq, case: 2, punishment: 2 } },
    };
    const result = applyJusticeMutations(advancedState, [
      { type: "create_case", record: caseRecord },
      { type: "create_punishment", record: punRecord },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both created and linked.
    expect(result.value.justice.cases[caseRecord.id]).toBeDefined();
    expect(result.value.justice.punishments[punRecord.id]).toBeDefined();
    expect(result.value.justice.cases[caseRecord.id]!.punishmentIds).toContain(punRecord.id);
  });
});

// ── Section 8: nextSeq invariant ─────────────────────────────────────────────

describe("nextSeq invariant", () => {
  it("NI1. nextSeq must be > max existing ID seq — rejects on violation", () => {
    // Manually create a state with nextSeq < existing ID seq (corrupt state).
    const state = makeState();
    const caseRecord = makeCase(state);
    const corruptedState = {
      ...state,
      justice: {
        ...state.justice,
        cases: { [caseRecord.id]: caseRecord },
        nextSeq: { ...state.justice.nextSeq, case: 1 }, // 1 but case_000001 already exists
      },
    };
    const anotherCase = { ...makeCase(state), id: "case_000002" } as CaseRecord;
    const result = applyJusticeMutations(corruptedState, [{ type: "create_case", record: anotherCase }]);
    expect(result.ok).toBe(false);
  });
});
