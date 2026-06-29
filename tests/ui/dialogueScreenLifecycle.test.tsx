/**
 * DialogueScreen 异步生命周期隔离回归（StrictMode setup→cleanup→setup 竞态）。
 *
 * 根因：StrictMode 开发环境双调用 effect；第一代 runner 被 abandon 后其 start() Promise 仍完成，
 * 引擎正确返回 NO_SESSION（"scene was abandoned during provider await"），旧实现把它当用户错误显示。
 * 修复：按 runner 世代 + identity 守卫，stale 结果整体忽略。
 *
 * mockProvider 返回 Promise.resolve，足以稳定复现 cleanup 与 microtask 的竞态——不通过移除 StrictMode 绕过。
 */
import { StrictMode } from "react";
import { render, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DialogueScreen } from "../../src/ui/screens/DialogueScreen";
import { SceneRunner } from "../../src/engine/scenes/runner";
import type { AssetRegistry } from "../../src/engine/assets/registry";
import { loadTestContent } from "../helpers/testContentFixture";
import { createGameStore } from "../../src/store/gameStore";

const FALLBACK = { url: "data:,", isFallback: true };
const registry = {
  portrait: () => FALLBACK,
  resolveVariant: () => FALLBACK,
  resolve: () => FALLBACK,
  background: () => FALLBACK,
} as unknown as AssetRegistry;

function noSessionVisible(container: HTMLElement): boolean {
  const err = container.querySelector(".screen-error");
  const text = container.textContent ?? "";
  return err !== null || /NO_SESSION|abandoned during provider await|scene was abandoned/.test(text);
}

describe("DialogueScreen 异步生命周期隔离", () => {
  // ── Test A：StrictMode 首次进入太后叙话 ──
  it("A: StrictMode 进入太后叙话 → 显示首句、无 NO_SESSION、首句只记一次", async () => {
    const db = loadTestContent();
    const store = createGameStore();
    store.newGame(db, 1);

    // 证明 StrictMode 确实双调用 effect（创建两代 runner）——竞态被真实触发，而非假通过。
    const startSpy = vi.spyOn(SceneRunner.prototype, "start");
    const { container } = render(
      <StrictMode>
        <DialogueScreen db={db} store={store} registry={registry} eventId="ev_taihou_converse" onDone={() => {}} />
      </StrictMode>,
    );

    await waitFor(() =>
      expect((store.getState().narrativeLog ?? []).some((e) => e.speakerId === "taihou")).toBe(true),
    );
    expect(startSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // setup→cleanup→setup
    // 不显示 NO_SESSION / “scene was abandoned”
    expect(noSessionVisible(container)).toBe(false);
    // 首句恰好记录一次
    const log = store.getState().narrativeLog ?? [];
    expect(log.filter((e) => e.speakerId === "taihou")).toHaveLength(1);
    startSpy.mockRestore();
  });

  // ── Test B：卸载后旧结果不污染状态 ──
  it("B: provider 未完成即卸载 → 旧结果不写 frame、不 commit、无 NO_SESSION", async () => {
    const db = loadTestContent();
    const store = createGameStore();
    store.newGame(db, 1);
    const onDone = vi.fn();

    const { unmount } = render(
      <DialogueScreen db={db} store={store} registry={registry} eventId="ev_fixture_scene_runner" onDone={onDone} />,
    );
    // 在首帧 microtask 结算前卸载。
    unmount();
    // 排空所有挂起的 microtask（旧 start Promise 在此完成，应被世代守卫忽略）。
    await Promise.resolve();
    await Promise.resolve();

    expect(onDone).not.toHaveBeenCalled();
    // 卸载前无任何 frame 写入历史（首帧从未对当前世代提交）。
    expect((store.getState().narrativeLog ?? []).length).toBe(0);
  });

  // ── Test C：快速重复点击不重复 advance ──
  it("C: pending 期间快速双击同一选项只发起一次 advance", async () => {
    const db = loadTestContent();
    const store = createGameStore();
    store.newGame(db, 1);

    const advanceSpy = vi.spyOn(SceneRunner.prototype, "advance");
    const { container } = render(
      <DialogueScreen db={db} store={store} registry={registry} eventId="ev_fixture_scene_runner" onDone={() => {}} />,
    );

    // 首帧即附带选项（runner 将后继 choice 节点的选项附在开场白上）。
    const choiceBtn = await waitFor(() => within(container).getByText("朕路过而已，你自便。"));
    // 同一 tick 内连点两次：同步 pendingRef 守卫应拦下第二次。
    fireEvent.click(choiceBtn);
    fireEvent.click(choiceBtn);
    await Promise.resolve();
    await Promise.resolve();

    expect(advanceSpy).toHaveBeenCalledTimes(1);
    expect(noSessionVisible(container)).toBe(false);
    advanceSpy.mockRestore();
  });

  // ── Test D：StrictMode 下进入上朝（court 复用同屏） ──
  it("D: StrictMode 上朝（退朝按钮）→ 首帧正常、无 NO_SESSION、不自动 onDone(false)、不重复记录", async () => {
    const db = loadTestContent();
    const store = createGameStore();
    store.newGame(db, 1);
    const onDone = vi.fn();

    const { container } = render(
      <StrictMode>
        <DialogueScreen
          key="court:0"
          db={db}
          store={store}
          registry={registry}
          eventId="ev_taihou_converse"
          quitLabel="退朝"
          onDone={onDone}
        />
      </StrictMode>,
    );

    await waitFor(() =>
      expect((store.getState().narrativeLog ?? []).some((e) => e.speakerId === "taihou")).toBe(true),
    );
    expect(noSessionVisible(container)).toBe(false);
    expect(onDone).not.toHaveBeenCalled(); // 未点退朝/未终结，不应自动调用
    expect((store.getState().narrativeLog ?? []).filter((e) => e.speakerId === "taihou")).toHaveLength(1);
    // 退朝按钮在位（court 复用同屏）。
    expect(within(container).getByText("退朝")).toBeInTheDocument();
  });
});
