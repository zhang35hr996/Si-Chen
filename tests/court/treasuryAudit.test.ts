/**
 * Group G: Treasury isolation audit — no direct treasury writes outside allowlisted files.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  applyAnnualFrontierAssessment,
} from "../../src/engine/court/frontierAssessment";
import {
  generateMilitaryMemorial,
  resolveMemorial,
} from "../../src/engine/court/memorials";
import { applyTreasuryTransaction } from "../../src/engine/court/treasuryLedger";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import type { FrontierAssessmentPlan } from "../../src/engine/court/frontierAssessment";
import { theaterForYear } from "../../src/engine/court/frontierAssessment";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function atMonth7(year: number) {
  return { year, month: 7, period: "early" as const, dayIndex: dayIndexOf(year, 7, "early") };
}

// ── Code-search test: no direct treasury writes outside allowlisted files ─────

/** Walk a directory tree and collect all .ts file paths. */
function walkTs(dir: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      paths.push(...walkTs(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      paths.push(full);
    }
  }
  return paths;
}

/**
 * Pattern that would indicate a direct write to resources.nation.treasury.
 * We look for assignments like `nation.treasury =` or `resources.nation.treasury =`.
 * The allowlisted files may write treasury directly (initial state, migrations, applyTreasuryTransaction).
 */
const DIRECT_WRITE_PATTERN = /\btreasuryDelta\s*[^=!<>]|\.treasury\s*=[^=]/;
const ALLOWLISTED_FILES = [
  "newGame.ts",
  "saveSystem.ts",
  "treasuryLedger.ts",
  "initialState.ts",
];

describe("Group G: treasury isolation audit — no direct writes", () => {
  it("no file outside allowlist writes to resources.nation.treasury directly", () => {
    const srcDir = join(import.meta.dirname, "../../src");
    const tsFiles = walkTs(srcDir);
    const DIRECT_TREASURY_WRITE = /(?:resources\.nation\.treasury|nation\.treasury)\s*=[^=]/;

    const violations: string[] = [];
    for (const filePath of tsFiles) {
      const fileName = filePath.split("/").pop() ?? "";
      if (ALLOWLISTED_FILES.some((a) => fileName === a)) continue;

      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (DIRECT_TREASURY_WRITE.test(line) && !line.trim().startsWith("//")) {
          violations.push(`${filePath}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      console.error("Direct treasury writes found:\n" + violations.join("\n"));
    }
    expect(violations).toHaveLength(0);
  });
});

// ── Ledger entry verification ─────────────────────────────────────────────────

describe("Group G: ledger correctness with military memorials", () => {
  function makePlan(year: number): FrontierAssessmentPlan {
    return {
      id: `frontier_assessment:${year}`,
      year,
      assessedAt: atMonth7(year),
      theaterId: theaterForYear(year),
      pressureBefore: 35,
      pressureDelta: 10,
      pressureAfter: 45,
      militaryAtAssessment: 45,
      governanceAtAssessment: 50,
      publicSupportAtAssessment: 50,
      severity: "watch",
      rawDrift: 10,
      militaryModifier: 2,
      governanceModifier: 0,
      publicSupportModifier: 0,
    };
  }

  it("resolve military memorial with treasury cost: exactly one ledger entry with source.kind=memorial", () => {
    const base = createNewGameState(db);
    const rich = { ...base, resources: { ...base.resources, nation: { ...base.resources.nation, treasury: 50000 } } };
    const plan = makePlan(1);
    const genResult = generateMilitaryMemorial(rich, plan, atMonth7(1))!;
    expect(genResult).not.toBeNull();
    const { state, memId } = { state: genResult.state, memId: genResult.memorial.id };

    const result = resolveMemorial(state, db, memId, "fortify_passes", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newEntries = result.value.state.treasuryLedger.filter(
      (e) => e.source.kind === "memorial",
    );
    expect(newEntries).toHaveLength(1);
    expect(newEntries[0]!.delta).toBe(-1200);
  });

  it("resolve no-cost military option: no ledger entry added", () => {
    const base = createNewGameState(db);
    // Use annual_readiness (stable severity) for defer_readiness option
    const plan: FrontierAssessmentPlan = {
      id: "frontier_assessment:1",
      year: 1,
      assessedAt: atMonth7(1),
      theaterId: theaterForYear(1),
      pressureBefore: 35,
      pressureDelta: -15,
      pressureAfter: 20,
      militaryAtAssessment: 50,
      governanceAtAssessment: 50,
      publicSupportAtAssessment: 50,
      severity: "stable",
      rawDrift: -3,
      militaryModifier: 2,
      governanceModifier: 0,
      publicSupportModifier: 0,
    };
    const genResult = generateMilitaryMemorial(base, plan, atMonth7(1))!;
    const { state, memId } = { state: genResult.state, memId: genResult.memorial.id };

    const result = resolveMemorial(state, db, memId, "defer_readiness", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.treasuryLedger).toHaveLength(0);
  });

  it("shop purchase ledger entry still works after a military memorial was resolved", () => {
    const base = createNewGameState(db);
    const rich = { ...base, resources: { ...base.resources, nation: { ...base.resources.nation, treasury: 50000 } } };
    const plan = makePlan(1);
    const genResult = generateMilitaryMemorial(rich, plan, atMonth7(1))!;
    const state1 = resolveMemorial(genResult.state, db, genResult.memorial.id, "fortify_passes", atMonth7(1));
    expect(state1.ok).toBe(true);
    if (!state1.ok) return;

    // Add a shop purchase entry after the military memorial
    const shopResult = applyTreasuryTransaction(state1.value.state, {
      delta: -500,
      at: atMonth7(1),
      source: { kind: "shop_purchase", itemId: "test_item" },
      reason: "测试购买",
    });
    expect(shopResult.ok).toBe(true);
    if (!shopResult.ok) return;

    const ledger = shopResult.value.state.treasuryLedger;
    expect(ledger).toHaveLength(2);
    expect(ledger[0]!.source.kind).toBe("memorial");
    expect(ledger[1]!.source.kind).toBe("shop_purchase");
  });

  it("military memorial after shop purchase: ledger chain is clean", () => {
    const base = createNewGameState(db);
    const rich = { ...base, resources: { ...base.resources, nation: { ...base.resources.nation, treasury: 50000 } } };

    // Shop purchase first
    const shopResult = applyTreasuryTransaction(rich, {
      delta: -300,
      at: atMonth7(1),
      source: { kind: "shop_purchase", itemId: "test_item" },
      reason: "测试购买",
    });
    expect(shopResult.ok).toBe(true);
    if (!shopResult.ok) return;

    // Then military memorial
    const plan = makePlan(1);
    const genResult = generateMilitaryMemorial(shopResult.value.state, plan, atMonth7(1))!;
    const resolveResult = resolveMemorial(genResult.state, db, genResult.memorial.id, "fortify_passes", atMonth7(1));
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;

    const ledger = resolveResult.value.state.treasuryLedger;
    expect(ledger).toHaveLength(2);
    expect(ledger[0]!.source.kind).toBe("shop_purchase");
    expect(ledger[1]!.source.kind).toBe("memorial");
    // Ledger chain integrity
    expect(ledger[1]!.balanceBefore).toBe(ledger[0]!.balanceAfter);
  });
});
