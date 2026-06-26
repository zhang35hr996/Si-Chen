/** 奏折框架引擎（Phase 4A）：地方灾情生成/批阅/校验。 */
import { describe, expect, it } from "vitest";
import {
  DISASTER_REGIONS,
  generateDisasterMemorial,
  getPendingMemorials,
  resolveMemorial,
  validateMemorials,
} from "../../src/engine/court/memorials";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, Memorial } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 1, period: "early" as const, dayIndex: y * 100 });
const codes = (s: GameState) => validateMemorials(s).map((e) => e.code);

describe("generateDisasterMemorial", () => {
  it("creates a pending disaster memorial with three deterministic options", () => {
    const r = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", at(2))!;
    expect(r).not.toBeNull();
    const m = r.memorial;
    expect(m.category).toBe("disaster");
    expect(m.status).toBe("pending");
    expect(m.payload.category).toBe("disaster");
    if (m.payload.category !== "disaster") return;
    expect(m.payload.regionId).toBe("jiangnan");
    expect(m.payload.options.map((o) => o.id)).toEqual(["relief", "tax_remit", "ignore"]);
    expect(m.title).toContain(DISASTER_REGIONS.jiangnan);
    expect(validateMemorials(r.state)).toEqual([]);
  });

  it("rejects an unknown region", () => {
    expect(generateDisasterMemorial(createNewGameState(db, 1), "atlantis", "minor", at(2))).toBeNull();
  });

  it("dedups by source (region + year)", () => {
    const first = generateDisasterMemorial(createNewGameState(db, 1), "hebei", "minor", at(2))!;
    expect(generateDisasterMemorial(first.state, "hebei", "minor", at(2))).toBeNull();
    // 不同年度同地域可再生成。
    expect(generateDisasterMemorial(first.state, "hebei", "minor", at(3))).not.toBeNull();
  });

  it("major severity scales option magnitude above minor", () => {
    const major = generateDisasterMemorial(createNewGameState(db, 1), "longxi", "major", at(2))!.memorial;
    const minor = generateDisasterMemorial(createNewGameState(db, 1), "longxi", "minor", at(2))!.memorial;
    if (major.payload.category !== "disaster" || minor.payload.category !== "disaster") return;
    const reliefMajor = major.payload.options.find((o) => o.id === "relief")!.effects[0]!.delta;
    const reliefMinor = minor.payload.options.find((o) => o.id === "relief")!.effects[0]!.delta;
    expect(Math.abs(reliefMajor)).toBeGreaterThan(Math.abs(reliefMinor));
  });
});

describe("resolveMemorial", () => {
  it("relief raises 民心 via the effect funnel and resolves the memorial", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", at(2))!;
    const before = g.state.resources.nation.publicSupport;
    const r = resolveMemorial(g.state, db, g.memorial.id, "relief", at(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.publicSupport).toBeGreaterThan(before);
    expect(r.value.state.memorials[g.memorial.id]!.status).toBe("resolved");
    expect(r.value.state.memorials[g.memorial.id]!.resolution).toBe("relief");
    expect(validateMemorials(r.value.state)).toEqual([]);
  });

  it("ignore lowers 民心 (distinct outcome)", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", at(2))!;
    const before = g.state.resources.nation.publicSupport;
    const r = resolveMemorial(g.state, db, g.memorial.id, "ignore", at(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.publicSupport).toBeLessThan(before);
  });

  it("rejects an unknown option, an unknown memorial, and a second resolution (state unchanged)", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "minor", at(2))!;
    const snap = JSON.stringify(g.state);
    expect(resolveMemorial(g.state, db, g.memorial.id, "nope", at(2)).ok).toBe(false);
    expect(resolveMemorial(g.state, db, "mem_999999", "relief", at(2)).ok).toBe(false);
    expect(JSON.stringify(g.state)).toBe(snap);
    const done = resolveMemorial(g.state, db, g.memorial.id, "relief", at(2));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(resolveMemorial(done.value.state, db, g.memorial.id, "ignore", at(2)).ok).toBe(false);
  });

  it("survives a save/load round-trip and stays resolvable while pending", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "lingnan", "minor", at(2))!;
    const rt = JSON.parse(JSON.stringify(g.state)) as GameState;
    expect(getPendingMemorials(rt)).toHaveLength(1);
    expect(resolveMemorial(rt, db, g.memorial.id, "tax_remit", at(2)).ok).toBe(true);
  });
});

describe("validateMemorials — corruption", () => {
  const base = (s: GameState): Memorial => generateDisasterMemorial(s, "jiangnan", "minor", at(2))!.memorial;
  const withMemorial = (s: GameState, m: Memorial): GameState => ({ ...s, memorials: { [m.id]: m } });

  it("record key ≠ id", () => {
    const s = createNewGameState(db, 1);
    const m = base(s);
    expect(codes({ ...s, memorials: { wrong: m } })).toContain("MEMORIAL_KEY_MISMATCH");
  });

  it("duplicate sourceId", () => {
    const s = createNewGameState(db, 1);
    const a = base(s);
    const b: Memorial = { ...a, id: "mem_000002" };
    expect(codes({ ...s, memorials: { [a.id]: a, [b.id]: b } })).toContain("MEMORIAL_DUP_SOURCE");
  });

  it("category mismatch with payload", () => {
    const s = createNewGameState(db, 1);
    const m = { ...base(s), category: "treasury" as const };
    expect(codes(withMemorial(s, m as Memorial))).toContain("MEMORIAL_CATEGORY_MISMATCH");
  });

  it("unknown region", () => {
    const s = createNewGameState(db, 1);
    const m = base(s);
    if (m.payload.category !== "disaster") return;
    const bad: Memorial = { ...m, payload: { ...m.payload, regionId: "atlantis" } };
    expect(codes(withMemorial(s, bad))).toContain("MEMORIAL_BAD_REGION");
  });

  it("empty options list", () => {
    const s = createNewGameState(db, 1);
    const m = base(s);
    if (m.payload.category !== "disaster") return;
    const bad: Memorial = { ...m, payload: { ...m.payload, options: [] } };
    expect(codes(withMemorial(s, bad))).toContain("MEMORIAL_NO_OPTIONS");
  });

  it("duplicate option id", () => {
    const s = createNewGameState(db, 1);
    const m = base(s);
    if (m.payload.category !== "disaster") return;
    const dupeOption = m.payload.options[0]!;
    const bad: Memorial = { ...m, payload: { ...m.payload, options: [dupeOption, dupeOption] } };
    expect(codes(withMemorial(s, bad))).toContain("MEMORIAL_DUP_OPTION");
  });

  it("pending carrying a resolution / resolved missing fields / bad resolution / resolvedAt<createdAt", () => {
    const s = createNewGameState(db, 1);
    const m = base(s);
    expect(codes(withMemorial(s, { ...m, resolution: "relief" }))).toContain("MEMORIAL_PENDING_WITH_RESOLUTION");
    expect(codes(withMemorial(s, { ...m, status: "resolved" }))).toContain("MEMORIAL_RESOLVED_MISSING_FIELDS");
    expect(codes(withMemorial(s, { ...m, status: "resolved", resolvedAt: at(2), resolution: "nope" }))).toContain("MEMORIAL_BAD_RESOLUTION");
    expect(codes(withMemorial(s, { ...m, status: "resolved", resolvedAt: at(1), resolution: "relief" }))).toContain("MEMORIAL_RESOLVED_BEFORE_CREATED");
  });
});
