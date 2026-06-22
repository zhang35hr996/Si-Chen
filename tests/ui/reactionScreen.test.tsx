/**
 * ReactionScreen interaction tests (jsdom + @testing-library/react).
 *
 * Verifies click-propagation fix, single-flight guard, and failure-path
 * queue/rollover behaviour without coupling to the full App component.
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

// ── 1. Choice click does not call onDone ──────────────────────────────────────

describe("click-propagation fix", () => {
  it("clicking a choice button does NOT call onDone", async () => {
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

    // Wait for the effect to set line state and render the button
    const btn = await screen.findByRole("button", { name: "询问" });
    fireEvent.click(btn);

    expect(onChoice).toHaveBeenCalledWith({ id: "c1", text: "询问", tone: undefined });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("clicking the dialogue box does NOT call onDone when choices are visible", async () => {
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

    // Wait for buttons to appear (effect flushed)
    await screen.findByRole("button", { name: "询问" });

    const box = document.querySelector(".dialogue-screen__box") as HTMLElement;
    fireEvent.click(box);
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ── 2. choicePending disables buttons ────────────────────────────────────────

describe("choicePending prop", () => {
  it("disables all choice buttons when choicePending is true", async () => {
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

    // Wait for choice buttons to appear, then check disabled
    await screen.findByRole("button", { name: "询问" });
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("leaves choice buttons enabled when choicePending is false", async () => {
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

    const btn = await screen.findByRole("button", { name: "询问" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ── 3. Double-click calls onChoice only once when pending ─────────────────────

describe("single-flight via choicePending", () => {
  it("second click while pending is ignored (button disabled)", async () => {
    const line = makeGeneratedLine([{ id: "c1", text: "询问" }]);
    const onChoice = vi.fn();

    // First render: not pending
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

    // Wait for button
    await screen.findByRole("button", { name: "询问" });

    // First click goes through (choicePending=false)
    fireEvent.click(screen.getByRole("button", { name: "询问" }));
    expect(onChoice).toHaveBeenCalledTimes(1);

    // Simulate App setting choicePending=true (in-flight)
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

    // Button is now disabled; click is blocked
    const btn = screen.getByRole("button", { name: "询问" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    // onChoice still at 1
    expect(onChoice).toHaveBeenCalledTimes(1);
  });
});

// ── 4. generatedLine update renders the next turn ─────────────────────────────

describe("generatedLine update", () => {
  it("updating generatedLine prop renders the new line text (effect re-run on new prop)", async () => {
    const line1 = makeGeneratedLine([{ id: "c1", text: "询问" }]);

    const { rerender } = render(
      <ReactionScreen
        db={db}
        store={store}
        registry={makeRegistry()}
        speakerId="shen_zhibai"
        lines={[line1.text]}
        generatedLine={line1}
        choicePending={false}
        onChoice={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    // Turn 1 text visible
    await screen.findByText(line1.text);

    const line2: DialogueLine = {
      speakerId: "shen_zhibai",
      speakerName: "沈之白",
      text: "臣已明白陛下心意。",
      expression: "neutral",
      choices: [],
      meta: { generated: true, degraded: false },
    };

    await act(async () => {
      rerender(
        <ReactionScreen
          db={db}
          store={store}
          registry={makeRegistry()}
          speakerId="shen_zhibai"
          lines={[line2.text]}
          generatedLine={line2}
          choicePending={false}
          onChoice={vi.fn()}
          onDone={vi.fn()}
        />,
      );
    });

    // Turn 2 text now visible; turn 1 text gone
    await screen.findByText(line2.text);
    expect(screen.queryByText(line1.text)).toBeNull();
  });
});

// ── 5. Failure-path interruption notice renders （继续） affordance ─────────────

describe("failure-path interruption notice", () => {
  it("interruption line renders with （继续） when choices is empty", async () => {
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

    // The interruption text and continue button appear
    await screen.findByText("（对话暂时中断）");
    const continueBtn = await screen.findByRole("button", { name: "（继续）" });
    expect(continueBtn).toBeDefined();

    // Clicking continue calls onDone (normal queue-draining path)
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
  });
});
