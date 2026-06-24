import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OfficialsScreen } from "../../src/ui/officials/OfficialsScreen";
import { GameStore } from "../../src/store/gameStore";
import { getHighVacancyPosts } from "../../src/engine/officials/selectors";
import { err } from "../../src/engine/infra/result";
import { stateError } from "../../src/engine/infra/errors";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const SHEN = "official_fam_shen_main";

function mount(mutate?: (s: GameState) => GameState) {
  const store = new GameStore();
  store.loadState(mutate ? mutate(createNewGameState(db, 1)) : createNewGameState(db, 1));
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

describe("OfficialsScreen — actions persist via onCommitted", () => {
  it("免职 vacates the post and fires onCommitted once", async () => {
    const { store, onCommitted } = mount();
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    await userEvent.click(screen.getByRole("button", { name: "免职" }));
    expect(store.getState().officials[SHEN]!.postId).toBeNull();
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/罢免已办妥/)).toBeInTheDocument();
  });

  it("准其告老 retires and fires onCommitted once", async () => {
    const { store, onCommitted } = mount((s) => ({ ...s, pendingRetirements: [{ officialId: SHEN, requestedAt: s.calendar }] }));
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    await userEvent.click(screen.getByRole("button", { name: "准其告老" }));
    expect(store.getState().officials[SHEN]!.status).toBe("retired");
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("起复 a retired official fires onCommitted once", async () => {
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

  it("调任 to a vacant post fires onCommitted once and seats the official", async () => {
    const { store, onCommitted } = mount();
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    await userEvent.click(screen.getByRole("button", { name: "调任" }));
    await userEvent.click(screen.getByRole("button", { name: /从一品·太保/ }));
    expect(store.getState().officials[SHEN]!.postId).toBe("taibao");
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("a dead official shows no appointment actions", async () => {
    const { store } = mount((s) => ({
      ...s,
      officials: { ...s.officials, [SHEN]: { ...s.officials[SHEN]!, status: "dead", postId: null, statusReason: "natural_death", statusChangedAt: s.calendar, deathAt: s.calendar } },
    }));
    await userEvent.click(screen.getByRole("button", { name: /已故（1）/ }));
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    expect(screen.getByText(/已故，无可任免/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "免职" })).toBeNull();
  });
});

describe("OfficialsScreen — transfer correctness (P2)", () => {
  it("the transfer list excludes the official's current (multi-seat) post", async () => {
    // 温经邦 任 知府(zhifu, seatCount 3, 仍有空席)；调任列表不应再列 知府。
    const store = new GameStore();
    store.loadState(createNewGameState(db, 1));
    const zhifu = Object.values(store.getState().officials).find((o) => o.postId === "zhifu")!;
    render(<OfficialsScreen db={db} store={store} onBack={() => {}} onCommitted={vi.fn()} />);
    await userEvent.click(screen.getByText(`${zhifu.surname}${zhifu.givenName}`));
    await userEvent.click(screen.getByRole("button", { name: "调任" }));
    expect(screen.getByText(/选空缺官职授任/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /从四品·知府/ })).toBeNull();
  });

  it("a failed appointment keeps the transfer list open and does not commit", async () => {
    const store = new GameStore();
    store.loadState(createNewGameState(db, 1));
    // 强制任命失败。
    store.assignOfficialPost = vi.fn(() => err(stateError("OFFICIAL_SEAT_FULL", "满席"))) as never;
    const onCommitted = vi.fn();
    render(<OfficialsScreen db={db} store={store} onBack={() => {}} onCommitted={onCommitted} />);
    await userEvent.click(screen.getByText(nameOf(store, SHEN)));
    await userEvent.click(screen.getByRole("button", { name: "调任" }));
    await userEvent.click(screen.getByRole("button", { name: /从一品·太保/ }));
    expect(onCommitted).not.toHaveBeenCalled();
    expect(screen.getByText(/选空缺官职授任/)).toBeInTheDocument(); // 列表未关闭
    expect(screen.getByText(/调任未成/)).toBeInTheDocument();
  });
});

describe("OfficialsScreen — non-active officials keep their former post (P2)", () => {
  it("groups a retired official under its former department and shows 原任", async () => {
    const store = new GameStore();
    let s = createNewGameState(db, 1);
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
