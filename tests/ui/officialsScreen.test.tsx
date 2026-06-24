import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { OfficialsScreen } from "../../src/ui/officials/OfficialsScreen";
import { GameStore } from "../../src/store/gameStore";
import { getHighVacancyPosts } from "../../src/engine/officials/selectors";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function mount(mutate?: (s: ReturnType<typeof createNewGameState>) => ReturnType<typeof createNewGameState>) {
  const store = new GameStore();
  store.loadState(mutate ? mutate(createNewGameState(db, 1)) : createNewGameState(db, 1));
  render(<OfficialsScreen db={db} store={store} onBack={() => {}} />);
  return store;
}
const headName = (store: GameStore, id: string) => {
  const o = store.getState().officials[id]!;
  return `${o.surname}${o.givenName}`;
};

describe("OfficialsScreen — roster + filters", () => {
  it("defaults to 在任 and lists active officials", () => {
    const store = mount();
    expect(screen.getByText("官员名册")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /在任（/ })).toHaveClass("is-active");
    expect(screen.getByText(headName(store, "official_fam_shen_main"))).toBeInTheDocument();
  });

  it("switching to 已故 shows an explicit empty state", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /已故（0）/ }));
    expect(screen.getByText(/暂无已故官员/)).toBeInTheDocument();
  });
});

describe("OfficialsScreen — 官位表 + vacancy reminder", () => {
  it("shows a high-vacancy reminder and can snooze it", async () => {
    const store = mount();
    expect(getHighVacancyPosts(store.getState(), db).length).toBeGreaterThan(0);
    expect(screen.getByText(/处要职现已空缺/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "稍后" }));
    expect(screen.queryByText(/处要职现已空缺/)).toBeNull();
  });

  it("官位表 tab lists posts with occupant / 空缺", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "官位表" }));
    expect(screen.getAllByText(/空缺|空 \d/).length).toBeGreaterThan(0);
  });
});

describe("OfficialsScreen — actions", () => {
  it("免职 a seated active official vacates the post via the store", async () => {
    const store = mount();
    await userEvent.click(screen.getByText(headName(store, "official_fam_shen_main")));
    await userEvent.click(screen.getByRole("button", { name: "免职" }));
    expect(store.getState().officials["official_fam_shen_main"]!.postId).toBeNull();
    expect(store.getState().officials["official_fam_shen_main"]!.status).toBe("active");
    expect(screen.getByText(/罢免已办妥/)).toBeInTheDocument();
  });

  it("准其告老 retires an official who requested it", async () => {
    const store = mount((s) => ({ ...s, pendingRetirements: [{ officialId: "official_fam_shen_main", requestedAt: s.calendar }] }));
    await userEvent.click(screen.getByText(headName(store, "official_fam_shen_main")));
    expect(screen.getByText("告老请辞")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "准其告老" }));
    expect(store.getState().officials["official_fam_shen_main"]!.status).toBe("retired");
  });

  it("a dead official shows no appointment actions", async () => {
    const store = mount((s) => ({
      ...s,
      officials: { ...s.officials, ["official_fam_shen_main"]: { ...s.officials["official_fam_shen_main"]!, status: "dead", postId: null, statusReason: "natural_death", statusChangedAt: s.calendar, deathAt: s.calendar } },
    }));
    // 已故官员在「已故」筛选页
    await userEvent.click(screen.getByRole("button", { name: /已故（1）/ }));
    await userEvent.click(screen.getByText(headName(store, "official_fam_shen_main")));
    expect(screen.getByText(/已故，无可任免/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "免职" })).toBeNull();
  });
});
