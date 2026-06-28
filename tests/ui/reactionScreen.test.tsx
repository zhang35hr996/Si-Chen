/**
 * ReactionScreen interaction tests (jsdom + @testing-library/react).
 *
 * Verifies click-propagation fix, single-flight guard, and failure-path
 * queue/rollover behaviour without coupling to the full App component.
 *
 * With the direct-prop rendering refactor (generatedLine bypasses local state),
 * tests for the generative path can use synchronous getBy* queries — no effects
 * need to flush before the line is rendered.
 */
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReactionScreen } from "../../src/ui/screens/ReactionScreen";
import type { DialogueLine } from "../../src/engine/dialogue/types";
import type { AssetRegistry } from "../../src/engine/assets/registry";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";
import { createGameStore } from "../../src/store/gameStore";

// ── Minimal stubs ─────────────────────────────────────────────────────────────

const FALLBACK_ASSET = { url: "data:image/svg+xml,", isFallback: true };

function makeRegistry(): AssetRegistry {
  return {
    portrait: () => FALLBACK_ASSET,
    resolveVariant: () => FALLBACK_ASSET,
    resolve: () => FALLBACK_ASSET,
  } as unknown as AssetRegistry;
}

function makeGeneratedLine(choices: DialogueLine["choices"] = []): DialogueLine {
  return {
    speakerId: "shen_zhibai",
    speakerName: "沈之白",
    text: "陛下有何吩咐？",
    expression: "neutral",
    choices,
    meta: { generated: true, degraded: false },
  };
}

let db: ContentDB;
let store: GameStore;

beforeEach(() => {
  db = loadRealContent();
  store = createGameStore();
  store.newGame(db);
});

// ── 1. Click propagation ──────────────────────────────────────────────────────

describe("click-propagation fix", () => {
  it("clicking a choice button does NOT call onDone", () => {
    const onDone = vi.fn();
    const onChoice = vi.fn();
    const line = makeGeneratedLine([{ id: "c1", text: "询问" }]);

    render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line.text]}
        generatedLine={line}
        onChoice={onChoice}
        onDone={onDone}
      />,
    );

    // generatedLine is rendered directly from prop — no effect wait needed
    fireEvent.click(screen.getByRole("button", { name: "询问" }));

    expect(onChoice).toHaveBeenCalledWith({ id: "c1", text: "询问", tone: undefined });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("clicking the dialogue box does NOT call onDone when choices are visible", () => {
    const onDone = vi.fn();
    const line = makeGeneratedLine([{ id: "c1", text: "询问" }]);

    render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line.text]}
        generatedLine={line}
        onDone={onDone}
      />,
    );

    const box = document.querySelector(".dialogue-screen__box") as HTMLElement;
    fireEvent.click(box);
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ── 2. choicePending disables buttons ────────────────────────────────────────

describe("choicePending prop", () => {
  it("disables all choice buttons when choicePending is true", () => {
    const line = makeGeneratedLine([
      { id: "c1", text: "询问" },
      { id: "c2", text: "离开" },
    ]);

    render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line.text]}
        generatedLine={line}
        choicePending={true}
        onChoice={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("leaves choice buttons enabled when choicePending is false", () => {
    const line = makeGeneratedLine([{ id: "c1", text: "询问" }]);

    render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line.text]}
        generatedLine={line}
        choicePending={false}
        onChoice={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: "询问" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ── 3. Single-flight guard ────────────────────────────────────────────────────

describe("single-flight via choicePending", () => {
  it("second click while pending is blocked — button is disabled", async () => {
    const line = makeGeneratedLine([{ id: "c1", text: "询问" }]);
    const onChoice = vi.fn();

    const { rerender } = render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line.text]}
        generatedLine={line}
        choicePending={false}
        onChoice={onChoice}
        onDone={vi.fn()}
      />,
    );

    // First click (not pending)
    fireEvent.click(screen.getByRole("button", { name: "询问" }));
    expect(onChoice).toHaveBeenCalledTimes(1);

    // App sets choicePending=true (in-flight)
    await act(async () => {
      rerender(
        <ReactionScreen
          db={db}
          store={store}
          registry={makeRegistry()}
          speakerId="shen_zhibai"
          lines={[line.text]}
          generatedLine={line}
          choicePending={true}
          onChoice={onChoice}
          onDone={vi.fn()}
        />,
      );
    });

    // Button disabled; click does not fire onChoice
    const btn = screen.getByRole("button", { name: "询问" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onChoice).toHaveBeenCalledTimes(1);
  });
});

// ── 4. Atomic turn swap — no stale-frame window ───────────────────────────────

describe("generatedLine direct prop rendering", () => {
  it("new generatedLine prop atomically replaces displayed line in same render", () => {
    const line1 = makeGeneratedLine([{ id: "c1", text: "询问" }]);

    const { rerender } = render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line1.text]}
        generatedLine={line1}
        onChoice={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    // Turn 1 choices are visible
    expect(screen.getByRole("button", { name: "询问" })).toBeDefined();

    const line2: DialogueLine = {
      speakerId: "shen_zhibai",
      speakerName: "沈之白",
      text: "臣已明白陛下心意。",
      expression: "neutral",
      choices: [],
      meta: { generated: true, degraded: false },
    };

    rerender(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line2.text]}
        generatedLine={line2}
        onChoice={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    // Turn 2 content appears; turn 1 choices are gone — no stale window
    expect(screen.getByText(line2.text)).toBeDefined();
    expect(screen.queryByRole("button", { name: "询问" })).toBeNull();
    // Turn 2 has no choices, so （继续） is shown
    expect(screen.getByRole("button", { name: "（继续）" })).toBeDefined();
  });
});

// ── 5b. 历史对话记录（显示边界）─────────────────────────────────────────────

describe("narrativeLog recording at display boundary", () => {
  it("生成式回合：实际显示的 NPC 行写入历史一次（同一 line 对象 rerender 不重复）", () => {
    const line = makeGeneratedLine([{ id: "c1", text: "询问" }]);
    const { rerender } = render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line.text]}
        generatedLine={line}
        onChoice={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    // 同一 line 对象 rerender：不应重复记录
    rerender(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line.text]}
        generatedLine={line}
        onChoice={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    const log = store.getState().narrativeLog ?? [];
    const mine = log.filter((e) => e.speakerId === "shen_zhibai" && e.lines.includes(line.text));
    expect(mine).toHaveLength(1);
  });

  it("record=false（如「（对话暂时中断）」）不写入历史", () => {
    const line = makeGeneratedLine();
    render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line.text]}
        generatedLine={line}
        record={false}
        onDone={vi.fn()}
      />,
    );
    const log = store.getState().narrativeLog ?? [];
    expect(log.some((e) => e.lines.includes(line.text))).toBe(false);
  });

  it("新生成回合替换 line 对象 → 各记录一次", () => {
    const line1 = makeGeneratedLine();
    const line2: DialogueLine = { ...makeGeneratedLine(), text: "臣已明白。" };
    const { rerender } = render(
      <ReactionScreen db={db} store={store} registry={makeRegistry()} speakerId="shen_zhibai" lines={[line1.text]} generatedLine={line1} onDone={vi.fn()} />,
    );
    rerender(
      <ReactionScreen db={db} store={store} registry={makeRegistry()} speakerId="shen_zhibai" lines={[line2.text]} generatedLine={line2} onDone={vi.fn()} />,
    );
    const log = store.getState().narrativeLog ?? [];
    expect(log.some((e) => e.lines.includes(line1.text))).toBe(true);
    expect(log.some((e) => e.lines.includes(line2.text))).toBe(true);
  });
});

// ── 5. Failure-path interruption notice ──────────────────────────────────────

describe("failure-path interruption notice", () => {
  it("interruption line renders with （继续） and calls onDone on click", async () => {
    const onDone = vi.fn();
    const interruptLine: DialogueLine = {
      speakerId: "shen_zhibai",
      speakerName: "沈之白",
      text: "（对话暂时中断）",
      expression: "neutral",
      choices: [],
      meta: { generated: true, degraded: false },
    };

    render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[interruptLine.text]}
        generatedLine={interruptLine}
        onDone={onDone}
      />,
    );

    expect(screen.getByText("（对话暂时中断）")).toBeDefined();
    const continueBtn = screen.getByRole("button", { name: "（继续）" });
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
  });
});

// ── 6. 反应队列切换（重挂）生命周期 — #122 P1b ───────────────────────────────
// App 用变化的 React key 强制重挂 ReactionScreen，故新 beat/回合时 index/scriptedLine/
// 去重集合全部重建，不会串用上一条反应的本地状态。下面用变化的 key 模拟 App 行为。

describe("反应队列切换（重挂）生命周期 — P1b", () => {
  // ReactionScreen scripted 路径需 speaker 在 db.characters 内（App 传入合并了 generatedConsorts 的 runtime db）。
  const mergedDb = () => ({ ...db, characters: { ...db.characters, ...store.getState().generatedConsorts } });
  const consortIds = () =>
    Object.keys(store.getState().generatedConsorts).filter((id) => !id.startsWith("generated_empress_"));

  it("scripted A → 重挂 scripted B：各记本说话人，B 不串用 A 的旧台词", async () => {
    const mdb = mergedDb();
    const [a, b] = consortIds();
    const { rerender } = render(
      <ReactionScreen key={1} db={mdb} store={store} registry={makeRegistry()} speakerId={a!} lines={["甲在此问安。"]} onDone={vi.fn()} />,
    );
    await waitFor(() => expect((store.getState().narrativeLog ?? []).some((e) => e.speakerId === a)).toBe(true));
    rerender(
      <ReactionScreen key={2} db={mdb} store={store} registry={makeRegistry()} speakerId={b!} lines={["乙在此告退。"]} onDone={vi.fn()} />,
    );
    await waitFor(() => expect((store.getState().narrativeLog ?? []).some((e) => e.speakerId === b)).toBe(true));

    const log = store.getState().narrativeLog ?? [];
    expect(log.filter((e) => e.speakerId === a)).toHaveLength(1);
    expect(log.filter((e) => e.speakerId === b)).toHaveLength(1);
    const bEntry = log.find((e) => e.speakerId === b)!;
    expect(bEntry.lines.join()).toContain("乙"); // B 记的是 B 的台词
    expect(bEntry.lines.join()).not.toContain("甲"); // 不串用 A 的旧台词
  });

  it("record:false 中断 → 重挂正常 beat：中断提示永不入史", async () => {
    const mdb = mergedDb();
    const a = consortIds()[0]!;
    const interruptLine: DialogueLine = {
      speakerId: a, speakerName: "X", text: "（对话暂时中断）", expression: "neutral",
      choices: [], meta: { generated: true, degraded: false },
    };
    const { rerender } = render(
      <ReactionScreen key={1} db={mdb} store={store} registry={makeRegistry()} speakerId={a} lines={[interruptLine.text]} generatedLine={interruptLine} record={false} onDone={vi.fn()} />,
    );
    rerender(
      <ReactionScreen key={2} db={mdb} store={store} registry={makeRegistry()} speakerId={a} lines={["正常台词在此。"]} onDone={vi.fn()} />,
    );
    await waitFor(() => expect((store.getState().narrativeLog ?? []).some((e) => e.lines.includes("正常台词在此。"))).toBe(true));

    const log = store.getState().narrativeLog ?? [];
    expect(log.some((e) => e.lines.includes("（对话暂时中断）"))).toBe(false); // 中断提示不入史
  });
});
