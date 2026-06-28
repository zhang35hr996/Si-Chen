/**
 * 历史对话面板（SettingsMenu narrative pane）发言人标签与生成侍君姓名解析。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SettingsMenu } from "../../src/ui/components/SettingsMenu";
import type { AssetRegistry } from "../../src/engine/assets/registry";
import { resolveDisplayName } from "../../src/engine/characters/standing";
import { toGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import { createGameStore } from "../../src/store/gameStore";

const FALLBACK = { url: "data:,", isFallback: true };
const registry = {
  background: () => FALLBACK,
  portrait: () => FALLBACK,
  resolveVariant: () => FALLBACK,
  resolve: () => FALLBACK,
} as unknown as AssetRegistry;

describe("SettingsMenu 历史对话", () => {
  it("narrator→旁白、player→陛下、生成侍君解析为正确姓名", () => {
    const db = loadRealContent();
    const store = createGameStore();
    store.newGame(db, 1); // seed=1 生成随机后宫
    const s0 = store.getState();
    const consortId = Object.keys(s0.generatedConsorts).find(
      (id) => !id.startsWith("generated_empress_"),
    )!;
    // 历史里显示的是「称呼」（姓+位分），由 resolveDisplayName 解析——而非原始 id。
    const st = s0.standing[consortId]!;
    const consortName = resolveDisplayName(s0.generatedConsorts[consortId]!, st, db.ranks[st.rank]);
    const now = toGameTime(s0.calendar);
    store.appendNarrativeLog([
      { at: now, speakerId: "narrator", lines: ["夜色深沉，宫灯摇曳。"] },
      { at: now, speakerId: "player", lines: ["朕乏了。"] },
      { at: now, speakerId: consortId, lines: ["臣侍告退。"] },
    ]);

    render(
      <SettingsMenu
        db={db}
        store={store}
        storage={null}
        registry={registry}
        onLoaded={() => {}}
        onReturnTitle={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "历史对话" }));

    expect(screen.getByText("旁白")).toBeInTheDocument();
    expect(screen.getByText("陛下")).toBeInTheDocument();
    // 生成侍君以姓名显示，而非原始 generated_consort_* id
    expect(screen.getByText(consortName)).toBeInTheDocument();
    expect(screen.queryByText(consortId)).toBeNull();
  });

  it("空历史显示「暂无对话记录。」", () => {
    const db = loadRealContent();
    const store = createGameStore();
    store.newGame(db, 1);
    render(
      <SettingsMenu
        db={db}
        store={store}
        storage={null}
        registry={registry}
        onLoaded={() => {}}
        onReturnTitle={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "历史对话" }));
    expect(screen.getByText("暂无对话记录。")).toBeInTheDocument();
  });
});
