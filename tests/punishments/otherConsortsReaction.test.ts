import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { evaluateOtherConsortReactions } from "../../src/engine/punishments/otherConsortsReaction";
import { loadRealContent } from "../helpers/contentFixture";
import { toGameTime, makeGameTime } from "../../src/engine/calendar/time";
import type { PunishmentOutcomeContext } from "../../src/engine/punishments/types";
import type { ConfinementEffect } from "../../src/engine/state/types";

const db = loadRealContent();

function makeState() {
  return createNewGameState(db);
}

function pickConsortId(state: ReturnType<typeof makeState>, exclude?: string): string | undefined {
  return Object.keys(state.standing).find((id) => {
    const c = db.characters[id];
    return (
      c?.kind === "consort" &&
      id !== exclude &&
      state.standing[id]?.lifecycle !== "deceased"
    );
  });
}

function makeCtx(
  state: ReturnType<typeof makeState>,
  targetId: string,
  overrides: Partial<PunishmentOutcomeContext> = {},
): PunishmentOutcomeContext {
  return {
    punishmentId: "test_reaction_001",
    targetId,
    actorId: "player",
    kind: "finite_confinement",
    severity: "moderate",
    occurredAt: toGameTime(state.calendar),
    ...overrides,
  };
}

describe("evaluateOtherConsortReactions – basic", () => {
  it("returns at most 3 reaction beats", () => {
    const state = makeState();
    const targetId = pickConsortId(state)!;
    const ctx = makeCtx(state, targetId);
    const result = evaluateOtherConsortReactions(db, state, ctx);
    expect(result.reactionBeats.length).toBeLessThanOrEqual(3);
  });

  it("reaction beats have non-empty lines array", () => {
    const state = makeState();
    const targetId = pickConsortId(state)!;
    const ctx = makeCtx(state, targetId);
    const result = evaluateOtherConsortReactions(db, state, ctx);
    for (const beat of result.reactionBeats) {
      expect(beat.lines.length).toBeGreaterThan(0);
    }
  });

  it("target never appears in bystander reaction beats", () => {
    const state = makeState();
    const targetId = pickConsortId(state)!;
    const ctx = makeCtx(state, targetId);
    const result = evaluateOtherConsortReactions(db, state, ctx);
    const beatSpeakers = result.reactionBeats.map((b) => b.speakerId);
    expect(beatSpeakers).not.toContain(targetId);
  });

  it("bystander effects include only living non-target consorts", () => {
    const state = makeState();
    const targetId = pickConsortId(state)!;
    const ctx = makeCtx(state, targetId);
    const result = evaluateOtherConsortReactions(db, state, ctx);
    const charIds = result.otherEffects
      .filter((e) => e.type === "adjust_consort_attr" || e.type === "memory")
      .map((e) => (e as { char: string }).char);
    for (const id of charIds) {
      expect(id).not.toBe(targetId);
      const c = db.characters[id] ?? state.generatedConsorts[id];
      expect(c?.kind).toBe("consort");
      expect(state.standing[id]?.lifecycle).not.toBe("deceased");
    }
  });

  it("determinism: same inputs → same result", () => {
    const state = makeState();
    const targetId = pickConsortId(state)!;
    const ctx = makeCtx(state, targetId);
    const r1 = evaluateOtherConsortReactions(db, state, ctx);
    const r2 = evaluateOtherConsortReactions(db, state, ctx);
    expect(r1.reactionBeats).toEqual(r2.reactionBeats);
    expect(r1.otherEffects).toEqual(r2.otherEffects);
  });
});

describe("evaluateOtherConsortReactions – confinement exclusion", () => {
  it("confined bystander does not appear in reaction beats", () => {
    const state = makeState();
    const targetId = pickConsortId(state)!;
    const bystanderId = pickConsortId(state, targetId);
    if (!bystanderId) return;

    const confinement: ConfinementEffect = {
      id: `status_${bystanderId}_000001`,
      kind: "confinement",
      characterId: bystanderId,
      startTurn: state.calendar.dayIndex,
      endTurnExclusive: null,
      imposedAt: toGameTime(state.calendar),
      imposedBy: "emperor",
    };
    const stateWithConfinement = {
      ...state,
      statusEffects: [...state.statusEffects, confinement],
    };
    const ctx = makeCtx(stateWithConfinement, targetId);
    const result = evaluateOtherConsortReactions(db, stateWithConfinement, ctx);
    const beatSpeakers = result.reactionBeats.map((b) => b.speakerId);
    expect(beatSpeakers).not.toContain(bystanderId);
  });
});

describe("evaluateOtherConsortReactions – severity escalation", () => {
  it("terminal severity → same or more otherEffects than moderate", () => {
    const state = makeState();
    const targetId = pickConsortId(state)!;
    const ctxMod = makeCtx(state, targetId, { severity: "moderate" });
    const ctxTer = makeCtx(state, targetId, { kind: "execution", severity: "terminal" });
    const modResult = evaluateOtherConsortReactions(db, state, ctxMod);
    const terResult = evaluateOtherConsortReactions(db, state, ctxTer);
    expect(terResult.otherEffects.length).toBeGreaterThanOrEqual(modResult.otherEffects.length);
  });
});

describe("evaluateOtherConsortReactions – discreet trait", () => {
  it("function runs without error for any consort disposition", () => {
    const state = makeState();
    const targetId = pickConsortId(state)!;
    const ctx = makeCtx(state, targetId, { severity: "moderate" });
    expect(() => evaluateOtherConsortReactions(db, state, ctx)).not.toThrow();
  });
});
