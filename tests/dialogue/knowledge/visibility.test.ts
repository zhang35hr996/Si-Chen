/**
 * Suite B: resolveVisibilityCeiling — exact access matrix.
 *
 * Required matrix:
 *   player / sovereign → "imperial"
 *   consort            → "restricted"
 *   official           → "restricted"
 *   elder              → "restricted"
 *   unknown            → "public"
 */
import { describe, it, expect } from "vitest";
import { resolveVisibilityCeiling } from "../../../src/engine/dialogue/knowledge/visibility";
import type { ContentDB } from "../../../src/engine/content/loader";
import type { GameState } from "../../../src/engine/state/types";

function makeDb(characters: Record<string, { kind: "consort" | "official" | "elder" }>): ContentDB {
  return { characters } as unknown as ContentDB;
}

function makeState(generatedConsorts?: Record<string, unknown>): GameState {
  return { generatedConsorts: generatedConsorts ?? {} } as unknown as GameState;
}

const emptyDb = makeDb({});
const emptyState = makeState();

describe("resolveVisibilityCeiling", () => {
  it("player → imperial", () => {
    expect(resolveVisibilityCeiling("player", emptyDb, emptyState)).toBe("imperial");
  });

  it("sovereign → imperial", () => {
    expect(resolveVisibilityCeiling("sovereign", emptyDb, emptyState)).toBe("imperial");
  });

  it("consort character → restricted", () => {
    const db = makeDb({ shen_zhibai: { kind: "consort" } });
    expect(resolveVisibilityCeiling("shen_zhibai", db, emptyState)).toBe("restricted");
  });

  it("official character → restricted", () => {
    const db = makeDb({ zhang_wei: { kind: "official" } });
    expect(resolveVisibilityCeiling("zhang_wei", db, emptyState)).toBe("restricted");
  });

  it("elder character → restricted", () => {
    const db = makeDb({ taihou: { kind: "elder" } });
    expect(resolveVisibilityCeiling("taihou", db, emptyState)).toBe("restricted");
  });

  it("generated consort (in state, not in db) → restricted", () => {
    const state = makeState({ gen_consort_1: { kind: "consort" } });
    expect(resolveVisibilityCeiling("gen_consort_1", emptyDb, state)).toBe("restricted");
  });

  it("completely unknown speaker → public (never elevate unknown identity)", () => {
    expect(resolveVisibilityCeiling("unknown_npc_99", emptyDb, emptyState)).toBe("public");
  });

  it("NPC speaking to player stays at NPC ceiling (consort NPC → restricted, not imperial)", () => {
    const db = makeDb({ consort_npc: { kind: "consort" } });
    // The NPC is the speaker, so their ceiling is restricted regardless of target being player
    expect(resolveVisibilityCeiling("consort_npc", db, emptyState)).toBe("restricted");
  });
});
