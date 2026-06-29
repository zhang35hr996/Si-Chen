/** 文昭殿「历任伴读」只读摘要：选中皇嗣后显示其历史伴读及结束原因。 */
import { render, within, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import { createCalendar, makeGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createGameStore } from "../../src/store/gameStore";
import type { GameState, Heir, HeirCompanionAssignment } from "../../src/engine/state/types";
import { WenzhaodianScreen } from "../../src/ui/screens/WenzhaodianScreen";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });
const personality = { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 };

function student(): Heir {
  return {
    id: "heir_w", sex: "daughter", fatherId: null, bearer: "sovereign", birthAt: makeGameTime(1, 1, "early"),
    favor: 50, legitimate: false, petName: "", givenName: "昭宁",
    education: { scholarship: 20, martial: 20, virtue: 20 }, health: 70, talent: 50, diligence: 50, personality,
    interests: [], imperialFear: 20, neglect: 20, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
  };
}

function endedAssignment(id: string, name: string, reason: HeirCompanionAssignment["endReason"]): HeirCompanionAssignment {
  return {
    id, heirId: "heir_w", companion: { kind: "royal_relative", personId: "gone" },
    assignedAt: makeGameTime(6, 1, "early"), status: "ended", endedAt: makeGameTime(8, 1, "early"), endReason: reason,
    bond: 10, ageAtAssignment: 6, profile: { name, sex: "female", legitimate: true, personality },
  };
}

function dayState(heirs: Heir[], history: HeirCompanionAssignment[]): GameState {
  const base = createNewGameState(db);
  return {
    ...base,
    calendar: { ...createCalendar(), ap: 5, year: 6 }, // day; daughter age 5 = enrolled
    resources: { ...base.resources, bloodline: { ...base.resources.bloodline, heirs } },
    endedCompanionAssignments: history,
  };
}

function renderScreen(state: GameState) {
  const store = createGameStore();
  store.loadState(state);
  return render(
    <WenzhaodianScreen
      db={db} store={store} registry={registry}
      onOpenMap={vi.fn()} onOpenSettings={vi.fn()} onLesson={vi.fn()} onTutorReport={vi.fn()}
    />,
  );
}

describe("文昭殿历任伴读只读摘要", () => {
  it("有历任伴读 → 选中后显示姓名与结束原因", () => {
    const state = dayState([student()], [
      endedAssignment("a1", "故友甲", "companion_deceased"),
    ]);
    const r = renderScreen(state);
    fireEvent.click(within(r.container).getByText(/昭宁/));
    const block = within(r.container).getByTestId("former-companions");
    expect(within(block).getByText(/故友甲/)).toBeInTheDocument();
    expect(within(block).getByText(/已故/)).toBeInTheDocument();
  });

  it("无历任伴读 → 不显示该区块", () => {
    const r = renderScreen(dayState([student()], []));
    fireEvent.click(within(r.container).getByText(/昭宁/));
    expect(within(r.container).queryByTestId("former-companions")).not.toBeInTheDocument();
  });
});
