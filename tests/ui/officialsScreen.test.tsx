import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OfficialsScreen } from "../../src/ui/officials/OfficialsScreen";
import { GameStore } from "../../src/store/gameStore";
import { getHighVacancyPosts } from "../../src/engine/officials/selectors";
import { createNewGameState } from "../../src/engine/state/newGame";
import { withConsort } from "../helpers/consortFixture";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const SHEN = "official_fam_shen_main";

/** Base world with shen_zhibai injected so official_fam_shen_main exists. */
const freshWorld = () => withConsort(createNewGameState(db, 1), db, "shen_zhibai");

function mount(mutate?: (s: GameState) => GameState) {
  const store = new GameStore();
  store.loadState(mutate ? mutate(freshWorld()) : freshWorld());
  const onCommitted = vi.fn();
  render(<OfficialsScreen db={db} store={store} onBack={() => {}} onCommitted={onCommitted} />);
  return { store, onCommitted };
}
const nameOf = (store: GameStore, id: string) => {
  const o = store.getState().officials[id]!;
  return `${o.surname}${o.givenName}`;
};

describe("OfficialsScreen — roster + filters", () => {
  it("defaults to 在任 and lists active officials", () => {
    const { store } = mount();
    expect(screen.getByText("官员名册")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /在任（/ })).toHaveClass("is-active");
    expect(screen.getByText(nameOf(store, SHEN))).toBeInTheDocument();
  });

  it("switching to 已故 shows an explicit empty state", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /已故（0）/ }));
    expect(screen.getByText(/暂无已故官员/)).toBeInTheDocument();
  });
});

describe("OfficialsScreen — vacancy reminder + 官位表", () => {
  it("shows a high-vacancy reminder and can snooze it", async () => {
    const { store } = mount();
    expect(getHighVacancyPosts(store.getState(), db).length).toBeGreaterThan(0);
    expect(screen.getByText(/处要职现已空缺/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "稍后" }));
    expect(screen.queryByText(/处要职现已空缺/)).toBeNull();
  });

  it("官位表 lists posts with occupant / 空缺", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "官位表" }));
    expect(screen.getAllByText(/空缺|空 \d/).length).toBeGreaterThan(0);
  });
});

describe("OfficialsScreen — free transfer/dismiss closed (PR3C-2)", () => {
  it("a seated active official shows NO free 免职/调任 buttons (auto-review note instead)", async () => {
    const { store } = mount();
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    expect(screen.queryByRole("button", { name: "免职" })).toBeNull();
    expect(screen.queryByRole("button", { name: "调任" })).toBeNull();
    expect(screen.queryByRole("button", { name: "任命" })).toBeNull();
    expect(screen.getByText(/常规迁转由吏部考课自动进行/)).toBeInTheDocument();
  });

  it("准其告老 (responding to a system-generated request) is retained and fires onCommitted", async () => {
    const { store, onCommitted } = mount((s) => ({ ...s, pendingRetirements: [{ officialId: SHEN, requestedAt: s.calendar }] }));
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    await userEvent.click(screen.getByRole("button", { name: "准其告老" }));
    expect(store.getState().officials[SHEN]!.status).toBe("retired");
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("起复 a retired official is retained and fires onCommitted", async () => {
    const { store, onCommitted } = mount((s) => ({
      ...s,
      officials: { ...s.officials, [SHEN]: { ...s.officials[SHEN]!, status: "retired", postId: null, statusReason: "retirement", statusChangedAt: s.calendar } },
    }));
    await userEvent.click(screen.getByRole("button", { name: /致仕（1）/ }));
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    await userEvent.click(screen.getByRole("button", { name: /起复/ }));
    expect(store.getState().officials[SHEN]!.status).toBe("active");
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("a dead official shows no decision actions", async () => {
    const { store } = mount((s) => ({
      ...s,
      officials: { ...s.officials, [SHEN]: { ...s.officials[SHEN]!, status: "dead", postId: null, statusReason: "natural_death", statusChangedAt: s.calendar, deathAt: s.calendar } },
    }));
    await userEvent.click(screen.getByRole("button", { name: /已故（1）/ }));
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    expect(screen.getByText(/已故，无可裁决/)).toBeInTheDocument();
  });
});

describe("OfficialsScreen — 人事简报 tab (PR3C-2)", () => {
  it("shows the latest annual review changes", async () => {
    const { store } = mount((s) => ({
      ...s,
      annualReviews: [{ year: 3, at: s.calendar, changes: [
        { officialId: SHEN, kind: "promotion" as const, fromPostId: "zhifu", toPostId: "chengxiang", authority: "system_review" as const },
      ] }],
    }));
    await userEvent.click(screen.getByRole("button", { name: "人事简报" }));
    expect(screen.getByRole("heading", { name: /3 年吏部考课/ })).toBeInTheDocument();
    expect(screen.getByText("升迁")).toBeInTheDocument();
    expect(screen.getByText(nameOf(store, SHEN))).toBeInTheDocument();
  });

  it("empty state when no review yet", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "人事简报" }));
    expect(screen.getByText(/尚无吏部考课简报/)).toBeInTheDocument();
  });
});

describe("OfficialsScreen — non-active officials keep their former post (P2)", () => {
  it("groups a retired official under its former department and shows 原任", async () => {
    const store = new GameStore();
    let s = freshWorld();
    // 沈氏 head 任 丞相(政事堂)；先经 store 罢免再退休，使 history 记 vacatedPostId=chengxiang。
    store.loadState(s);
    store.dismissOfficial(SHEN); // active 去职，写历史 vacatedPostId=chengxiang
    s = store.getState();
    store.loadState({ ...s, officials: { ...s.officials, [SHEN]: { ...s.officials[SHEN]!, status: "retired", statusReason: "retirement", statusChangedAt: s.calendar } } });
    render(<OfficialsScreen db={db} store={store} onBack={() => {}} onCommitted={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /致仕（1）/ }));
    expect(screen.getByRole("heading", { name: "政事堂" })).toBeInTheDocument(); // 仍按原部门分组
    expect(screen.getByText(/原任 正一品·丞相/)).toBeInTheDocument();
  });
});
