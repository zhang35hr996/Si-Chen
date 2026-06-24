import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExaminationScreen } from "../../src/ui/officials/ExaminationScreen";
import { GameStore } from "../../src/store/gameStore";
import {
  settleAnnualExamination,
  getEligibleOfficialCandidates,
  getUnacknowledgedExaminationResults,
} from "../../src/engine/officials/examination";
import { appointedOfficialId } from "../../src/engine/officials/appointment";
import { err } from "../../src/engine/infra/result";
import { stateError } from "../../src/engine/infra/errors";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

function mount() {
  const store = new GameStore();
  store.loadState(settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1)));
  const onCommitted = vi.fn();
  render(<ExaminationScreen db={db} store={store} onBack={() => {}} onCommitted={onCommitted} />);
  return { store, onCommitted };
}
const firstEligible = (store: GameStore) => getEligibleOfficialCandidates(store.getState())[0]!;
const candName = (store: GameStore, id: string) => {
  const c = store.getState().officialCandidates[id]!;
  return `${c.surname}${c.givenName}`;
};

describe("ExaminationScreen — 科举榜单", () => {
  it("opening the screen acknowledges the latest result (badge clears) and autosaves", async () => {
    const { store, onCommitted } = mount();
    // 默认进入榜单 tab → useEffect 置 acknowledged。
    await screen.findByText(/本届共/);
    expect(getUnacknowledgedExaminationResults(store.getState())).toHaveLength(0);
    expect(onCommitted).toHaveBeenCalled();
  });

  it("lists candidates in rank order", async () => {
    const { store } = mount();
    await screen.findByText(/本届共/);
    const first = store.getState().examinationResults[0]!.candidateIds[0]!;
    expect(screen.getByText(new RegExp(`第1名 ${candName(store, first)}`))).toBeInTheDocument();
  });
});

describe("ExaminationScreen — 候补池 + 授官", () => {
  it("pool shows only eligible candidates", async () => {
    const { store } = mount();
    await userEvent.click(screen.getByRole("button", { name: "候补池" }));
    // eligible 全部出现
    for (const c of getEligibleOfficialCandidates(store.getState())) {
      expect(screen.getByText(`${c.surname}${c.givenName}`)).toBeInTheDocument();
    }
  });

  it("appoints an eligible candidate to a vacant post (fit-sorted), updates state + autosave", async () => {
    const { store, onCommitted } = mount();
    onCommitted.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "候补池" }));
    const c = firstEligible(store);
    await userEvent.click(screen.getByText(`${c.surname}${c.givenName}`));
    // 适配度按钮存在并降序
    const fits = screen.getAllByText(/适配 \d+/).map((el) => Number(el.textContent!.replace("适配 ", "")));
    expect(fits).toEqual([...fits].sort((a, b) => b - a));
    // 选第一个空缺 → 确认授官
    const firstPostBtn = screen.getAllByText(/适配 \d+/)[0]!.closest("button")!;
    await userEvent.click(firstPostBtn);
    await userEvent.click(screen.getByRole("button", { name: "确认授官" }));
    expect(store.getState().officials[appointedOfficialId(c.id)]).toBeDefined();
    expect(store.getState().officialCandidates[c.id]!.status).toBe("appointed");
    expect(onCommitted).toHaveBeenCalled();
    // 回到候补池且成功提示保留（P3）。
    expect(screen.getByRole("button", { name: "候补池" })).toBeInTheDocument();
    expect(screen.getByText(/已授任/)).toBeInTheDocument();
  });

  it("a failed appointment keeps the confirm panel and does not autosave", async () => {
    const { store, onCommitted } = mount();
    store.appointOfficialCandidate = vi.fn(() => err(stateError("OFFICIAL_SEAT_FULL", "满席"))) as never;
    onCommitted.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "候补池" }));
    const c = firstEligible(store);
    await userEvent.click(screen.getByText(`${c.surname}${c.givenName}`));
    await userEvent.click(screen.getAllByText(/适配 \d+/)[0]!.closest("button")!);
    await userEvent.click(screen.getByRole("button", { name: "确认授官" }));
    expect(onCommitted).not.toHaveBeenCalled();
    expect(screen.getByText(/授官未成/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认授官" })).toBeInTheDocument(); // 面板未关
  });
});
