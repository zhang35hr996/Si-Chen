/**
 * 乘风训诫询问 prompt 的呈现与选择路由（ChengFengPromptScreen 通用屏复用）。
 * 命中训诫后先由乘风询问「要过去看看？」，文案含目标当前称谓；点击触发 attend/decline。
 */
import { render, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChengFengPromptScreen } from "../../src/ui/screens/ChengFengPromptScreen";
import { buildTaihouRebukePrompt, maybeBuildRebukeForAction } from "../../src/store/taihouRebukeFlow";
import { createGameStore } from "../../src/store/gameStore";
import { loadGameContent } from "../../src/engine/content/viteSource";
import type { AssetRegistry } from "../../src/engine/assets/registry";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

const FALLBACK = { url: "data:,", isFallback: true };
const registry = {
  portrait: () => FALLBACK,
  resolveVariant: () => FALLBACK,
  resolve: () => FALLBACK,
  background: () => FALLBACK,
} as unknown as AssetRegistry;

function hittingPrompt() {
  const store = createGameStore();
  store.newGame(db, 1);
  for (let i = 0; i < 500; i++) {
    const plan = maybeBuildRebukeForAction(db, store.getState(), `hit:${i}`, "palace");
    if (plan) return { store, prompt: buildTaihouRebukePrompt(plan), targetName: plan.targetDisplayName };
  }
  throw new Error("no hitting seed");
}

describe("乘风训诫询问 prompt", () => {
  it("显示乘风询问，含目标当前称谓与去看看/不必了两选项", () => {
    const { store, prompt, targetName } = hittingPrompt();
    const r = render(
      <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={prompt} onChoose={vi.fn()} />,
    );
    expect(within(r.container).getByText(new RegExp(`太后似乎正在慈宁宫训诫${targetName}`))).toBeInTheDocument();
    expect(within(r.container).getByText("去看看")).toBeInTheDocument();
    expect(within(r.container).getByText("不必了")).toBeInTheDocument();
  });

  it("点击「去看看」触发 taihouRebukeAttend", () => {
    const { store, prompt } = hittingPrompt();
    const onChoose = vi.fn();
    const r = render(
      <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={prompt} onChoose={onChoose} />,
    );
    fireEvent.click(within(r.container).getByText("去看看"));
    expect(onChoose).toHaveBeenCalledWith({ type: "taihouRebukeAttend" });
  });

  it("点击「不必了」触发 taihouRebukeDecline", () => {
    const { store, prompt } = hittingPrompt();
    const onChoose = vi.fn();
    const r = render(
      <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={prompt} onChoose={onChoose} />,
    );
    fireEvent.click(within(r.container).getByText("不必了"));
    expect(onChoose).toHaveBeenCalledWith({ type: "taihouRebukeDecline" });
  });
});
