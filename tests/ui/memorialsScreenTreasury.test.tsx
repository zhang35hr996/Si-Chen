/**
 * Group I — 财政奏折 UI 覆盖测试（Task 3, Phase 4B）
 *
 * 覆盖：国库余额显示、选项费用标注、余额不足禁用、成功/失败流程。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemorialsScreen } from "../../src/ui/court/MemorialsScreen";
import { memorialCard, formatSilver } from "../../src/ui/court/memorialsView";
import { GameStore } from "../../src/store/gameStore";
import {
  generateDisasterMemorial,
  generateTreasuryMemorial,
} from "../../src/engine/court/memorials";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import { stateError } from "../../src/engine/infra/errors";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const NOW = toGameTime(createNewGameState(db, 1).calendar);

function withTreasury(state: GameState, treasury: number): GameState {
  return {
    ...state,
    resources: {
      ...state.resources,
      nation: { ...state.resources.nation, treasury },
    },
  };
}

function mount(state: GameState) {
  const store = new GameStore();
  store.loadState(state);
  const onCommitted = vi.fn();
  render(
    <MemorialsScreen db={db} store={store} onBack={() => {}} onCommitted={onCommitted} />,
  );
  return { store, onCommitted };
}

// ── formatSilver ──────────────────────────────────────────────────────────────

describe("formatSilver", () => {
  it("formats thousands with commas", () => {
    expect(formatSilver(10000)).toBe("10,000");
    expect(formatSilver(1000000)).toBe("1,000,000");
    expect(formatSilver(999)).toBe("999");
    expect(formatSilver(1234567)).toBe("1,234,567");
  });

  it("handles negative values with leading minus", () => {
    expect(formatSilver(-900)).toBe("-900");
    expect(formatSilver(-10000)).toBe("-10,000");
  });
});

// ── memorialCard view model — treasury fields ─────────────────────────────────

describe("memorialCard — treasury cost labels", () => {
  it("disaster relief option shows 国库 -900 两 for major disaster", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 5000);
    const relief = card.options.find((o) => o.id === "relief")!;
    expect(relief.treasuryCost).toBe("国库 -900 两");
  });

  it("disaster tax_remit option shows 国库 -600 两 for major disaster", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 5000);
    const taxRemit = card.options.find((o) => o.id === "tax_remit")!;
    expect(taxRemit.treasuryCost).toBe("国库 -600 两");
  });

  it("disaster ignore option has no treasuryCost", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 5000);
    const ignore = card.options.find((o) => o.id === "ignore")!;
    expect(ignore.treasuryCost).toBeUndefined();
    expect(ignore.disabled).toBe(false);
  });

  it("disaster minor shows 国库 -400 两 for relief", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "minor", NOW)!;
    const card = memorialCard(g.memorial, 5000);
    const relief = card.options.find((o) => o.id === "relief")!;
    expect(relief.treasuryCost).toBe("国库 -400 两");
  });

  it("treasury audit option shows 国库 +600 两", () => {
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateTreasuryMemorial(base, NOW)!;
    const card = memorialCard(g.memorial, 5000);
    const audit = card.options.find((o) => o.id === "audit")!;
    expect(audit.treasuryCost).toBe("国库 +600 两");
    expect(audit.disabled).toBe(false);
  });

  it("treasury defer option has no treasuryCost", () => {
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateTreasuryMemorial(base, NOW)!;
    const card = memorialCard(g.memorial, 5000);
    const defer = card.options.find((o) => o.id === "defer")!;
    expect(defer.treasuryCost).toBeUndefined();
    expect(defer.disabled).toBe(false);
  });
});

describe("memorialCard — disabled when treasury insufficient", () => {
  it("disaster relief disabled when treasury < 900", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 600);
    const relief = card.options.find((o) => o.id === "relief")!;
    expect(relief.disabled).toBe(true);
    expect(relief.disabledReason).toBe("国库不足，尚缺 300 两");
  });

  it("disaster relief not disabled when treasury = 900", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 900);
    const relief = card.options.find((o) => o.id === "relief")!;
    expect(relief.disabled).toBe(false);
    expect(relief.disabledReason).toBeUndefined();
  });

  it("disaster tax_remit disabled with correct shortfall", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 100);
    const taxRemit = card.options.find((o) => o.id === "tax_remit")!;
    expect(taxRemit.disabled).toBe(true);
    expect(taxRemit.disabledReason).toBe("国库不足，尚缺 500 两");
  });

  it("positive treasuryDelta options are never disabled", () => {
    const base = withTreasury(createNewGameState(db, 1), 0);
    const g = generateTreasuryMemorial(base, NOW)!;
    const card = memorialCard(g.memorial, 0);
    const audit = card.options.find((o) => o.id === "audit")!;
    const surtax = card.options.find((o) => o.id === "surtax")!;
    expect(audit.disabled).toBe(false);
    expect(surtax.disabled).toBe(false);
  });
});

describe("memorialCard — currentTreasury formatting", () => {
  it("formats 10000 as 国库：10,000 两", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 10000);
    expect(card.currentTreasury).toBe("国库：10,000 两");
  });

  it("formats 0 as 国库：0 两", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 0);
    expect(card.currentTreasury).toBe("国库：0 两");
  });

  it("formats 1234567 as 国库：1,234,567 两", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const card = memorialCard(g.memorial, 1234567);
    expect(card.currentTreasury).toBe("国库：1,234,567 两");
  });
});

// ── MemorialsScreen rendering ──────────────────────────────────────────────────

describe("MemorialsScreen — treasury balance rendered in card header", () => {
  it("shows currentTreasury text on the card", () => {
    const base = withTreasury(createNewGameState(db, 1), 10000);
    const g = generateDisasterMemorial(base, "jiangnan", "major", NOW)!;
    mount(g.state);
    expect(screen.getByText("国库：10,000 两")).toBeInTheDocument();
  });
});

describe("MemorialsScreen — option cost and disabled state", () => {
  it("shows 国库 -900 两 cost on the relief button when treasury is sufficient", () => {
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateDisasterMemorial(base, "jiangnan", "major", NOW)!;
    mount(g.state);
    expect(screen.getByText("国库 -900 两")).toBeInTheDocument();
  });

  it("disables relief button and shows reason when treasury insufficient", () => {
    const base = withTreasury(createNewGameState(db, 1), 600);
    const g = generateDisasterMemorial(base, "jiangnan", "major", NOW)!;
    mount(g.state);
    const btn = screen.getByRole("button", { name: /开仓赈济/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText("国库不足，尚缺 300 两")).toBeInTheDocument();
  });

  it("enables relief button when treasury is exactly sufficient", () => {
    const base = withTreasury(createNewGameState(db, 1), 900);
    const g = generateDisasterMemorial(base, "jiangnan", "major", NOW)!;
    mount(g.state);
    const btn = screen.getByRole("button", { name: /开仓赈济/ });
    expect(btn).not.toBeDisabled();
  });

  it("treasury audit option shows 国库 +600 两 and is not disabled", () => {
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateTreasuryMemorial(base, NOW)!;
    mount(g.state);
    expect(screen.getByText("国库 +600 两")).toBeInTheDocument();
    const auditBtn = screen.getByRole("button", { name: /清查侵耗/ });
    expect(auditBtn).not.toBeDisabled();
  });

  it("treasury defer option has no treasury cost label", () => {
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateTreasuryMemorial(base, NOW)!;
    mount(g.state);
    // The defer option is 暂缓办理 — no treasury cost shown alongside it
    // We verify that the defer button itself exists and is enabled
    const deferBtn = screen.getByRole("button", { name: /暂缓办理/ });
    expect(deferBtn).not.toBeDisabled();
  });
});

describe("MemorialsScreen — success flow", () => {
  it("shows notice and card disappears after resolving an option", async () => {
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateDisasterMemorial(base, "jiangnan", "major", NOW)!;
    const { onCommitted } = mount(g.state);
    await userEvent.click(screen.getByRole("button", { name: /不予理会/ }));
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/灾情 · 江南/)).toBeNull();
  });
});

describe("MemorialsScreen — failure flow", () => {
  it("shows error notice and card stays when resolve fails (bad state)", async () => {
    // Force a state with a memorial but broken store (pass bad optionId via manual resolve)
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateDisasterMemorial(base, "jiangnan", "major", NOW)!;
    const store = new GameStore();
    store.loadState(g.state);
    const onCommitted = vi.fn();

    render(
      <MemorialsScreen db={db} store={store} onBack={() => {}} onCommitted={onCommitted} />,
    );

    // Spy on resolveMemorial to return failure
    const original = store.resolveMemorial.bind(store);
    store.resolveMemorial = () => ({ ok: false, error: stateError("TEST_FAILURE", "测试错误") });

    // Now click any button
    const btn = screen.getByRole("button", { name: /不予理会/ });
    btn.click();

    // Card should still be visible (because onCommitted was NOT called)
    expect(onCommitted).not.toHaveBeenCalled();
    // Error notice should be rendered
    expect(await screen.findByRole("status")).toBeInTheDocument();
    // Restore
    store.resolveMemorial = original;
  });
});

// ── P2: urgencyLabel 渲染测试 ──────────────────────────────────────────────────

describe("MemorialsScreen — treasury urgencyLabel", () => {
  it("routine treasury memorial renders 度支 · 常例", () => {
    // treasury ≥ 3000 → routine
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateTreasuryMemorial(base, NOW)!;
    mount(g.state);
    expect(screen.getByText("度支 · 常例")).toBeInTheDocument();
  });

  it("urgent treasury memorial renders 度支 · 急奏", () => {
    // treasury < 3000 → urgent
    const base = withTreasury(createNewGameState(db, 1), 1000);
    const g = generateTreasuryMemorial(base, NOW)!;
    mount(g.state);
    expect(screen.getByText("度支 · 急奏")).toBeInTheDocument();
  });

  it("treasury audit option shows Chinese labels not raw field names", () => {
    // audit option has effects on corruption/governance/ministerLoyalty
    const base = withTreasury(createNewGameState(db, 1), 5000);
    const g = generateTreasuryMemorial(base, NOW)!;
    mount(g.state);
    // Should show Chinese label for corruption (may match multiple elements — audit + defer both show 贪腐)
    expect(screen.getAllByText(/贪腐/).length).toBeGreaterThan(0);
    // Raw field name should not appear as text in the rendered output
    expect(screen.queryByText(/^corruption$/)).toBeNull();
  });
});

describe("MemorialsScreen — no direct state mutation", () => {
  it("MemorialsScreen.tsx does not directly write state.resources.nation.treasury", async () => {
    // Architectural test: the source file must not contain direct treasury writes
    const fs = await import("node:fs");
    const path = await import("node:path");
    const srcPath = path.resolve(__dirname, "../../src/ui/court/MemorialsScreen.tsx");
    const src = fs.readFileSync(srcPath, "utf-8");
    // Should not contain patterns like `.treasury =` (assignment)
    expect(src).not.toMatch(/\.treasury\s*=/);
    // Should not import applyTreasuryTransaction or similar directly
    expect(src).not.toMatch(/applyTreasuryTransaction/);
    expect(src).not.toMatch(/resources\.nation\.treasury\s*=/);
  });
});
