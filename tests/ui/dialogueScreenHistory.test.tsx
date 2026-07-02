/**
 * DialogueScreen 历史记录的跨事件生命周期（#122 P1a）。
 * App 用变化的 React key 强制重挂 DialogueScreen，故事件链切换时组件/frame/去重集合全部重建，
 * 下一事件首帧（frameSeq 同样从 1 起）不会因依赖未变而漏记。
 */
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DialogueScreen } from "../../src/ui/screens/DialogueScreen";
import type { AssetRegistry } from "../../src/engine/assets/registry";
import { loadTestContent } from "../helpers/testContentFixture";
import { createGameStore } from "../../src/store/gameStore";
import { withConsort } from "../helpers/consortFixture";

const FALLBACK = { url: "data:,", isFallback: true };
const registry = {
  portrait: () => FALLBACK,
  resolveVariant: () => FALLBACK,
  resolve: () => FALLBACK,
  background: () => FALLBACK,
} as unknown as AssetRegistry;

describe("DialogueScreen 跨事件历史记录", () => {
  it("A、B 两事件各自首帧恰好记录一次；重挂后 B 首句不漏记、不串用 A 的旧 frame", async () => {
    const db = loadTestContent();
    const store = createGameStore();
    store.newGame(db, 1);
    store.loadState(withConsort(store.getState(), db, "wenya"));
    const onDone = () => {};

    // 事件 A：ev_fixture_scene_runner，首帧说话人 wenya（frameSeq=1）
    const { rerender } = render(
      <DialogueScreen key={1} db={db} store={store} registry={registry} eventId="ev_fixture_scene_runner" onDone={onDone} />,
    );
    await waitFor(() =>
      expect((store.getState().narrativeLog ?? []).some((e) => e.speakerId === "wenya")).toBe(true),
    );

    // 事件 B：ev_taihou_converse（首帧 taihou，frameSeq 同样从 1 起）。新 key 强制重挂。
    rerender(
      <DialogueScreen key={2} db={db} store={store} registry={registry} eventId="ev_taihou_converse" onDone={onDone} />,
    );
    await waitFor(() =>
      expect((store.getState().narrativeLog ?? []).some((e) => e.speakerId === "taihou")).toBe(true),
    );

    const log = store.getState().narrativeLog ?? [];
    expect(log.filter((e) => e.speakerId === "wenya")).toHaveLength(1); // A 首句一次
    expect(log.filter((e) => e.speakerId === "taihou")).toHaveLength(1); // B 首句一次，未漏记
  });
});
