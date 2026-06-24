/** validateOfficialWorld 对生命周期新不变量的捕获（Phase 2 PR2A）。 */
import { describe, expect, it } from "vitest";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const T = { year: 2, month: 1, period: "early" as const, dayIndex: 0 };
const codes = (s: GameState) => validateOfficialWorld(s, db).map((e) => e.code);
const firstOfficialId = (s: GameState) => Object.keys(s.officials)[0]!;

describe("lifecycle invariants", () => {
  it("non-active seated → OFFICIAL_INACTIVE_SEATED", () => {
    const s = createNewGameState(db, 1);
    const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
    s.officials[seated.id] = { ...seated, status: "retired", statusReason: "retirement", statusChangedAt: T };
    expect(codes(s)).toContain("OFFICIAL_INACTIVE_SEATED");
  });

  it("dead without deathAt → OFFICIAL_DEAD_NO_TIME", () => {
    const s = createNewGameState(db, 1);
    const id = firstOfficialId(s);
    s.officials[id] = { ...s.officials[id]!, status: "dead", postId: null, statusReason: "natural_death", statusChangedAt: T };
    expect(codes(s)).toContain("OFFICIAL_DEAD_NO_TIME");
  });

  it("non-active without reason → OFFICIAL_STATUS_REASON_MISSING", () => {
    const s = createNewGameState(db, 1);
    const id = firstOfficialId(s);
    s.officials[id] = { ...s.officials[id]!, status: "exiled", postId: null, statusChangedAt: T };
    expect(codes(s)).toContain("OFFICIAL_STATUS_REASON_MISSING");
  });

  it("active carrying a reason → OFFICIAL_ACTIVE_WITH_REASON", () => {
    const s = createNewGameState(db, 1);
    const id = firstOfficialId(s);
    s.officials[id] = { ...s.officials[id]!, statusReason: "dismissal" };
    expect(codes(s)).toContain("OFFICIAL_ACTIVE_WITH_REASON");
  });

  it("aged official beyond generation cap is still valid (runtime age not gen-capped)", () => {
    const s = createNewGameState(db, 1);
    const id = firstOfficialId(s);
    s.officials[id] = { ...s.officials[id]!, age: 88 };
    expect(codes(s)).not.toContain("OFFICIAL_BAD_AGE");
  });

  it("pending retirement for a non-active official → PENDING_RETIRE_NOT_ACTIVE", () => {
    const s = createNewGameState(db, 1);
    const id = firstOfficialId(s);
    s.officials[id] = { ...s.officials[id]!, status: "retired", postId: null, statusReason: "retirement", statusChangedAt: T };
    s.pendingRetirements = [{ officialId: id, requestedAt: T }];
    expect(codes(s)).toContain("PENDING_RETIRE_NOT_ACTIVE");
  });

  it("official history referencing a missing official → OFFICIAL_HISTORY_BAD_REF", () => {
    const s = createNewGameState(db, 1);
    s.officialHistory = [{ id: "ohist_000001", officialId: "nobody", status: "dead", reason: "natural_death", at: T }];
    expect(codes(s)).toContain("OFFICIAL_HISTORY_BAD_REF");
  });
});
