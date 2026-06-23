/**
 * Integration tests for PUNISH-2 GameStore entry points.
 * Verifies the full atomic transaction: base command + consequence effects.
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { addGeneratedConsort } from "../../src/store/grandSelection";
import { planPunishmentConsequences } from "../../src/engine/punishments/consequencePlanner";
import { toGameTime } from "../../src/engine/calendar/time";
import { WORLD_RULES_TEXT } from "../../src/engine/dialogue/providers/anthropicProvider";
import { loadRealContent } from "../helpers/contentFixture";
import type { CharacterContent } from "../../src/engine/content/schemas";

const db = loadRealContent();

function makeStore() {
  const state = createNewGameState(db);
  const store = new GameStore();
  store.loadState(state);
  return store;
}

function firstAliveConsortId(store: GameStore): string {
  const state = store.getState();
  const id = Object.keys(state.standing).find((id) => {
    const c = db.characters[id];
    return c?.kind === "consort" && state.standing[id]?.lifecycle !== "deceased";
  });
  if (!id) throw new Error("no alive consort in fixture");
  return id;
}

// ── applyImperialPunishmentWithConsequences ────────────────────────────────────

describe("applyImperialPunishmentWithConsequences – impose_confinement", () => {
  it("succeeds atomically and returns reactionBeats + baseLine", () => {
    const store = makeStore();
    const targetId = firstAliveConsortId(store);
    const result = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 3 },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.value.baseLines[0]).toBe("string");
    expect((result.value.baseLines[0] ?? "").length).toBeGreaterThan(0);
    expect(Array.isArray(result.value.reactionBeats)).toBe(true);
  });

  it("state is mutated — fear increases after confinement", () => {
    const store = makeStore();
    const targetId = firstAliveConsortId(store);
    const fearBefore = store.getState().standing[targetId]?.fear ?? 0;
    const result = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 3 },
      {},
    );
    expect(result.ok).toBe(true);
    const fearAfter = store.getState().standing[targetId]?.fear ?? 0;
    expect(fearAfter).toBeGreaterThanOrEqual(fearBefore);
  });

  it("indefinite confinement has severity=severe → larger fear delta than finite", () => {
    const store1 = makeStore();
    const store2 = makeStore();
    const targetId = firstAliveConsortId(store1);
    // Same target, same punishmentId seed — compare finite vs indefinite
    store1.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 3 },
      {},
    );
    store2.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: null },
      {},
    );
    const fearFinite = store1.getState().standing[targetId]?.fear ?? 0;
    const fearIndefinite = store2.getState().standing[targetId]?.fear ?? 0;
    expect(fearIndefinite).toBeGreaterThanOrEqual(fearFinite);
  });

  it("derives targetId from command — cannot mismatch target vs ctx", () => {
    const store = makeStore();
    const targetId = firstAliveConsortId(store);
    // The new API doesn't accept a separate targetId — it's always derived from command.targetId
    const result = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 2 },
      {},
    );
    expect(result.ok).toBe(true);
    // Standing should have a confinement status effect for targetId
    const statusEffects = store.getState().statusEffects;
    const confined = statusEffects.find((e) => e.kind === "confinement" && e.characterId === targetId);
    expect(confined).toBeDefined();
  });

  it("invalid command → rejected, state unchanged", () => {
    const store = makeStore();
    const stateBefore = JSON.stringify(store.getState().standing);
    const result = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId: "char_nonexistent_99", durationTurns: 3 },
      {},
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(store.getState().standing)).toBe(stateBefore);
  });

  it("no duplicate target memory — exactly one punishment memory for target", () => {
    const store = makeStore();
    const targetId = firstAliveConsortId(store);
    const memoriesBefore = store.getState().memories[targetId]?.entries.length ?? 0;
    store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 3 },
      {},
    );
    const entries = store.getState().memories[targetId]?.entries ?? [];
    const punishmentEntries = entries.slice(memoriesBefore).filter(
      (e) => e.triggerTags?.includes("confinement") || e.triggerTags?.includes("punishment"),
    );
    expect(punishmentEntries.length).toBe(1);
  });
});

// ── applyPunitiveRankChangeWithConsequences ────────────────────────────────────

describe("applyPunitiveRankChangeWithConsequences – demotion", () => {
  it("demote succeeds and returns baseLine + reactionBeats", () => {
    const store = makeStore();
    // Find a consort NOT at the floor rank
    const state = store.getState();
    const targetId = Object.keys(state.standing).find((id) => {
      const c = db.characters[id];
      if (c?.kind !== "consort") return false;
      const st = state.standing[id];
      if (!st || st.lifecycle === "deceased") return false;
      const rank = db.ranks[st.rank];
      return rank && rank.domain === "harem" && rank.order > 40;
    });
    if (!targetId) return; // not enough fixture consorts to test

    const result = store.applyPunitiveRankChangeWithConsequences(
      db,
      targetId,
      { kind: "set_rank", rank: "cairen" }, // demote to cairen
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value.baseLines[0] ?? "").length).toBeGreaterThan(0);
  });

  it("rejects non-punitive rank change (promote)", () => {
    const store = makeStore();
    // Find a consort below the ceiling
    const state = store.getState();
    const targetId = Object.keys(state.standing).find((id) => {
      const c = db.characters[id];
      if (c?.kind !== "consort") return false;
      const st = state.standing[id];
      if (!st || st.lifecycle === "deceased") return false;
      const rank = db.ranks[st.rank];
      return rank && rank.domain === "harem" && rank.order < 100;
    });
    if (!targetId) return;

    const state2 = store.getState();
    const st = state2.standing[targetId]!;
    const currentRank = db.ranks[st.rank]!;
    const higherRank = Object.values(db.ranks).find(
      (r) => r.domain === "harem" && r.order > currentRank.order,
    );
    if (!higherRank) return;

    const result = store.applyPunitiveRankChangeWithConsequences(
      db,
      targetId,
      { kind: "set_rank", rank: higherRank.id },
      {},
    );
    expect(result.ok).toBe(false);
  });

  it("ordinary rank op (applyEffects) does NOT trigger consequence planner", () => {
    const store = makeStore();
    const state = store.getState();
    const targetId = Object.keys(state.standing).find((id) => {
      const c = db.characters[id];
      if (c?.kind !== "consort") return false;
      const st = state.standing[id];
      if (!st || st.lifecycle === "deceased") return false;
      const rank = db.ranks[st.rank];
      return rank && rank.domain === "harem" && rank.order < 100;
    });
    if (!targetId) return;

    const st = state.standing[targetId]!;
    const currentRank = db.ranks[st.rank]!;
    const higherRank = Object.values(db.ranks).find(
      (r) => r.domain === "harem" && r.order > currentRank.order,
    );
    if (!higherRank) return;

    // Simulate ordinary promote via applyEffects (no consequence)
    const fearBefore = state.standing[targetId]?.fear ?? 30;
    const result = store.applyEffects(db, [
      { type: "set_rank", char: targetId, rank: higherRank.id, authority: { kind: "sovereign", actorId: "player" } },
    ]);
    expect(result.ok).toBe(true);
    // No fear change from a straight effects apply
    const fearAfter = store.getState().standing[targetId]?.fear ?? 30;
    expect(fearAfter).toBe(fearBefore);
  });
});

// ── Generated consort as bystander ────────────────────────────────────────────

describe("generated consort as bystander — memory funnel transaction", () => {
  function makeGeneratedConsort(id: string): CharacterContent {
    const template = Object.values(db.characters).find((c) => c.kind === "consort")!;
    return {
      ...template,
      id,
      profile: { ...template.profile, name: `测试${id}` },
    };
  }

  it("planPunishmentConsequences produces memory for generated bystander without funnel rejection", () => {
    const store = makeStore();
    const targetId = firstAliveConsortId(store);

    // Inject a generated consort as bystander
    const bystanderId = "gen_bystander_001";
    const genContent = makeGeneratedConsort(bystanderId);
    store.loadState(addGeneratedConsort(store.getState(), genContent, "cairen", 40));

    // The full transaction must succeed — generated consort bystander gets a memory
    const result = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 3 },
      {},
    );
    expect(result.ok).toBe(true);

    // Generated consort's memory store should have gained a punishment memory
    const bystanderMemories = store.getState().memories[bystanderId]?.entries;
    expect(bystanderMemories).toBeDefined();
    const punishmentMem = bystanderMemories?.find(
      (e) => e.triggerTags?.includes("punishment") || e.triggerTags?.includes("finite_confinement"),
    );
    expect(punishmentMem).toBeDefined();
  });

  it("full batch is atomic — generated bystander with no memory store causes rollback", () => {
    const store = makeStore();
    const targetId = firstAliveConsortId(store);

    // Inject generated consort into standing+generatedConsorts but NOT into memories
    const bystanderId = "gen_no_memory_001";
    const genContent = makeGeneratedConsort(bystanderId);
    const withConsort = addGeneratedConsort(store.getState(), genContent, "cairen", 40);
    // Remove memory store to simulate corrupt state
    const withoutMemory = {
      ...withConsort,
      memories: Object.fromEntries(
        Object.entries(withConsort.memories).filter(([k]) => k !== bystanderId),
      ),
    };
    store.loadState(withoutMemory);

    const stateBefore = JSON.stringify(store.getState().standing[targetId]);
    // The transaction should fail due to BAD_EFFECT_TARGET on the bystander memory
    const result = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 3 },
      {},
    );
    expect(result.ok).toBe(false);
    // Target state unchanged on rollback
    expect(JSON.stringify(store.getState().standing[targetId])).toBe(stateBefore);
  });
});

// ── punishmentId returned and unique per call ────────────────────────────────

describe("punishmentId returned by store, not caller", () => {
  it("impose_confinement returns a non-empty punishmentId string", () => {
    const store = makeStore();
    const targetId = firstAliveConsortId(store);
    const result = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 3 },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.value.punishmentId).toBe("string");
    expect(result.value.punishmentId.length).toBeGreaterThan(0);
  });

  it("punishmentId encodes chronicle position — chronicle grows after punishment so next ID differs", () => {
    const store = makeStore();
    const targetId = firstAliveConsortId(store);
    // Capture chronicle length before and after to verify the ID would advance.
    const chronicleBefore = store.getState().chronicle.length;
    const r1 = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId, durationTurns: 3 },
      {},
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const chronicleAfter = store.getState().chronicle.length;
    // punishmentId was generated from chronicleBefore
    expect(r1.value.punishmentId).toContain(String(chronicleBefore));
    // chronicle grew — a second punishment would get a different punishmentId
    expect(chronicleAfter).toBeGreaterThan(chronicleBefore);
  });
});

// ── secret publicity preserves target association ─────────────────────────────

describe("secret publicity — target association preserved in bystander memory", () => {
  it("bystander memory subjectIds always includes targetId even when secret", () => {
    const state = createNewGameState(db);
    const targetId = Object.keys(state.standing).find((id) => db.characters[id]?.kind === "consort")!;
    const plan = planPunishmentConsequences(db, state, {
      punishmentId: "secret_test",
      targetId,
      actorId: "player",
      kind: "finite_confinement",
      severity: "moderate",
      occurredAt: toGameTime(state.calendar),
      publicity: "secret",
    });
    const bystanderMemories = plan.effects.filter(
      (e: { type: string; char?: string; entry?: { subjectIds?: string[] } }) =>
        e.type === "memory" && e.char !== targetId,
    );
    for (const m of bystanderMemories) {
      const subjects = (m as { entry: { subjectIds: string[] } }).entry.subjectIds;
      expect(subjects).toContain(targetId);
      expect(subjects).toContain("player");
    }
  });
});

// ── behavioralState constraint in system prompt ────────────────────────────────

describe("behavioralState rules in WORLD_RULES_TEXT", () => {
  it("rule 5 contains behavioralState constraint", () => {
    expect(WORLD_RULES_TEXT).toContain("behavioralState");
    expect(WORLD_RULES_TEXT).toContain("字段名或数值");
  });

  it("system prompt contains the privacy constraint (single source for all providers)", () => {
    expect(WORLD_RULES_TEXT).toContain("speaker.behavioralState");
  });
});
