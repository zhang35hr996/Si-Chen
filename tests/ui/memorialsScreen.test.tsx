import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemorialsScreen } from "../../src/ui/court/MemorialsScreen";
import { memorialCard } from "../../src/ui/court/memorialsView";
import { GameStore } from "../../src/store/gameStore";
import { generateDisasterMemorial } from "../../src/engine/court/memorials";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const NOW = toGameTime(createNewGameState(db, 1).calendar);

function mount(state: GameState) {
  const store = new GameStore();
  store.loadState(state);
  const onCommitted = vi.fn();
  render(<MemorialsScreen db={db} store={store} onBack={() => {}} onCommitted={onCommitted} />);
  return { store, onCommitted };
}

describe("MemorialsScreen", () => {
  it("shows an explicit empty state with no pending memorials", () => {
    mount(createNewGameState(db, 1));
    expect(screen.getByText(/暂无待批前朝奏折/)).toBeInTheDocument();
  });

  it("renders a disaster memorial card with three options and effect summaries", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    mount(g.state);
    expect(screen.getByText(/灾情 · 江南/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开仓赈济/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /蠲免赋税/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /不予理会/ })).toBeInTheDocument();
    expect(screen.getAllByText(/民心/).length).toBeGreaterThan(0); // 后果摘要（每个选项一条）
  });

  it("resolving an option calls onCommitted, applies the effect, and removes the card", async () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", NOW)!;
    const { store, onCommitted } = mount(g.state);
    const before = store.getState().resources.nation.publicSupport;
    await userEvent.click(screen.getByRole("button", { name: /开仓赈济/ }));
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(store.getState().resources.nation.publicSupport).toBeGreaterThan(before);
    expect(store.getState().memorials[g.memorial.id]!.status).toBe("resolved");
    expect(screen.queryByText(/灾情 · 江南/)).toBeNull();
  });
});

describe("memorialCard view model", () => {
  it("derives region/severity labels and per-option effect summaries", () => {
    const g = generateDisasterMemorial(createNewGameState(db, 1), "hebei", "minor", NOW)!;
    const card = memorialCard(g.memorial);
    expect(card.categoryLabel).toBe("灾情");
    expect(card.regionName).toBe("河北");
    expect(card.severityLabel).toBe("灾情");
    expect(card.options).toHaveLength(3);
    expect(card.options[0]!.effectSummary).toMatch(/民心/);
  });
});
