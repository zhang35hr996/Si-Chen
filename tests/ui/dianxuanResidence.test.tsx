import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AssetRegistry } from "../../src/engine/assets/registry";
import { createNewGameState } from "../../src/engine/state/newGame";
import { GameStore } from "../../src/store/gameStore";
import { generateCandidates } from "../../src/store/grandSelection";
import { DianxuanScreen } from "../../src/ui/screens/DianxuanScreen";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const registry = {
  resolveVariant: () => ({ url: "/background.png", isFallback: false }),
  portrait: (portraitSet: string) => ({ url: `/${portraitSet}.png`, isFallback: false }),
} as unknown as AssetRegistry;

function mount() {
  const initial = createNewGameState(db, 1);
  const store = new GameStore();
  store.loadState(initial);
  const candidate = generateCandidates(db, initial, 1)[0]!;
  const onDone = vi.fn();
  render(
    <DianxuanScreen
      registry={registry}
      db={db}
      store={store}
      candidates={[candidate]}
      year={1}
      onDone={onDone}
    />,
  );
  return { store, candidate, onDone };
}

async function keepAtRecommendedRank() {
  await userEvent.click(screen.getByRole("button", { name: "留牌子" }));
  await userEvent.click(screen.getByRole("button", { name: /皇后所荐/ }));
}

describe("DianxuanScreen — 留牌后的住处安排", () => {
  it("选定位分后询问住处，由皇后自动分配空殿并以皇后立绘汇报", async () => {
    const { store, candidate, onDone } = mount();
    await keepAtRecommendedRank();

    expect(screen.getByText(/既已留牌，是否现在给他安排住处/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: db.characters.shen_zhibai!.profile.name })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "由皇后安排" }));

    expect(screen.getByText(/那么.+就先住.+的.+吧/)).toBeInTheDocument();
    const standing = store.getState().standing[candidate.content.id]!;
    expect(standing.residence).not.toBe("chuxiu_gong");
    expect(standing.chamber).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(onDone).toHaveBeenCalledWith(
      [expect.objectContaining({ candidate, rank: expect.any(String) })],
      false,
      1,
    );
  });

  it("选择由皇帝亲自安排时打开现有搬迁界面，皇帝可优先选择任意空室", async () => {
    const { store, candidate, onDone } = mount();
    await keepAtRecommendedRank();
    await userEvent.click(screen.getByRole("button", { name: "是" }));

    expect(screen.getByRole("heading", { name: `${candidate.content.profile.name}　搬迁居所` })).toBeInTheDocument();
    const emptyRoom = screen.getAllByText("空置")
      .map((node) => node.closest("button"))
      .find((button): button is HTMLButtonElement => button !== null && !button.disabled);
    expect(emptyRoom).toBeDefined();
    await userEvent.click(emptyRoom!);

    expect(store.getState().standing[candidate.content.id]!.residence).not.toBe("chuxiu_gong");
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
