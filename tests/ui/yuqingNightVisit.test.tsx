/** 毓庆宫夜访 UI：日间无操作、夜间可探视、近况/养父关系描述、AP 不足禁用。 */
import { render, within, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import { createCalendar, makeGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createGameStore } from "../../src/store/gameStore";
import type { GameState, Heir } from "../../src/engine/state/types";
import { YuqingGongScreen } from "../../src/ui/screens/YuqingGongScreen";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });

const defaultPersonality = {
  empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50,
};

function minorHeir(over: Partial<Heir> = {}): Heir {
  return {
    id: "heir_ui_1", sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"),
    favor: 50, legitimate: false, petName: "", givenName: "昭宁",
    education: { scholarship: 20, martial: 20, virtue: 20 },
    health: 70, talent: 50, diligence: 50,
    personality: defaultPersonality,
    interests: [], imperialFear: 30, neglect: 70, custodianBond: 30,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
    ...over,
  };
}

function stateAt(apOverride: number, heirs: Heir[]): GameState {
  const base = createNewGameState(db);
  return {
    ...base,
    calendar: { ...createCalendar(), ap: apOverride, year: 8 }, // year 8 → daughter age 7 (resides)
    resources: { ...base.resources, bloodline: { ...base.resources.bloodline, heirs } },
  };
}

function renderScreen(state: GameState, onNightVisit = vi.fn()) {
  const store = createGameStore();
  store.loadState(state);
  const result = render(
    <YuqingGongScreen
      db={db}
      store={store}
      registry={registry}
      onOpenMap={vi.fn()}
      onOpenSettings={vi.fn()}
      onNightVisit={onNightVisit}
    />,
  );
  return { result, onNightVisit };
}

describe("毓庆宫夜访 UI", () => {
  it("日间（ap=5, slot0=卯时）无夜访操作", () => {
    const { result } = renderScreen(stateAt(5, [minorHeir()]));
    expect(within(result.container).getByText(/此时皇嗣尚未归宫/)).toBeInTheDocument();
    expect(within(result.container).queryByText("与其谈心")).not.toBeInTheDocument();
  });

  it("夜间（ap=1, slot4=戌时）选中皇嗣后显示近况/养父关系与夜访操作", () => {
    const { result } = renderScreen(stateAt(1, [minorHeir()]));
    // 选中名册中的皇嗣
    fireEvent.click(within(result.container).getByText(/昭宁/));
    expect(within(result.container).getByText("久疏照拂")).toBeInTheDocument(); // neglect 70
    expect(within(result.container).getByText("当前无人能够亲自照料。")).toBeInTheDocument(); // 无养父
    expect(within(result.container).getByText("与其谈心")).toBeInTheDocument();
    expect(within(result.container).getByText("陪其坐一会儿")).toBeInTheDocument();
  });

  it("夜访触发 onNightVisit 并带正确 action", () => {
    const { result, onNightVisit } = renderScreen(stateAt(1, [minorHeir()]));
    fireEvent.click(within(result.container).getByText(/昭宁/));
    fireEvent.click(within(result.container).getByText("与其谈心"));
    expect(onNightVisit).toHaveBeenCalledWith("heir_ui_1", "heart_to_heart");
  });

  it("AP 不足时夜访按钮禁用", () => {
    const { result } = renderScreen(stateAt(0, [minorHeir()]));
    // ap=0 → slot5? apMax 5 - 0 = 5 → 子时=night（仍夜间）。按钮应禁用。
    fireEvent.click(within(result.container).getByText(/昭宁/));
    const btn = within(result.container).getByText("与其谈心") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("未迁居皇嗣（年幼）不出现在名册", () => {
    const baby = minorHeir({ id: "heir_baby", givenName: "阿囡", birthAt: makeGameTime(7, 1, "early") }); // age 1
    const { result } = renderScreen(stateAt(1, [baby]));
    expect(within(result.container).queryByText(/阿囡/)).not.toBeInTheDocument();
    expect(within(result.container).getByText(/尚无皇嗣迁居于此/)).toBeInTheDocument();
  });

  it("已故且达迁居龄的皇嗣不出现在名册", () => {
    const dead = minorHeir({ id: "heir_dead", givenName: "夭夭", lifecycle: "deceased" }); // age 7, deceased
    const { result } = renderScreen(stateAt(1, [dead]));
    expect(within(result.container).queryByText(/夭夭/)).not.toBeInTheDocument();
    expect(within(result.container).getByText(/尚无皇嗣迁居于此/)).toBeInTheDocument();
  });

  it("仅有已故皇嗣时显示空名册提示", () => {
    const dead = minorHeir({ id: "heir_dead", lifecycle: "deceased" });
    const { result } = renderScreen(stateAt(1, [dead]));
    expect(within(result.container).getByText(/尚无皇嗣迁居于此/)).toBeInTheDocument();
  });
});
