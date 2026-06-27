import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChengfengDispatch } from "../../src/ui/components/ChengfengDispatch";

const noop = () => {};
const handlers = {
  onSummonConsort: noop,
  onManageRank: noop,
  onBestow: noop,
  onPhysician: noop,
  onClose: noop,
};

// The four decree actions, each with a distinct accessible name (no positional indexing).
const decrees = ["召见侍君", "管理侍君", "赏赐", "传太医"];
const decreeButtons = () => decrees.map((name) => screen.getByRole("button", { name }));

describe("ChengfengDispatch", () => {
  it("renders 乘风's framing as a dialog landmark with an accessible name", () => {
    render(<ChengfengDispatch interruptible {...handlers} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("传乘风");
    expect(dialog).toHaveTextContent("乘风");
    expect(dialog).toHaveTextContent("臣在"); // 乘风 入殿应答（approved design）
  });

  it("renders exactly one full-screen modal layer wrapping a single dialog (no nested dialog)", () => {
    const { container } = render(<ChengfengDispatch interruptible {...handlers} />);
    const layers = container.querySelectorAll(".chengfeng-dispatch-layer");
    expect(layers).toHaveLength(1);
    expect(layers[0]).not.toHaveAttribute("role", "dialog"); // the layer itself is not a landmark
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(screen.getByRole("dialog")).queryByRole("dialog")).toBeNull(); // no nested dialog
  });

  it("exposes all four decree actions plus close, each by a distinct accessible name", () => {
    render(<ChengfengDispatch interruptible {...handlers} />);
    for (const name of decrees) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作罢" })).toBeInTheDocument();
  });

  it.each([
    ["召见侍君", "onSummonConsort"],
    ["管理侍君", "onManageRank"],
    ["赏赐", "onBestow"],
    ["传太医", "onPhysician"],
  ] as const)("clicking %s invokes only %s", async (name, key) => {
    const user = userEvent.setup();
    const spies = {
      onSummonConsort: vi.fn(),
      onManageRank: vi.fn(),
      onBestow: vi.fn(),
      onPhysician: vi.fn(),
      onClose: vi.fn(),
    };
    render(<ChengfengDispatch interruptible {...spies} />);
    await user.click(screen.getByRole("button", { name }));
    expect(spies[key]).toHaveBeenCalledTimes(1);
    for (const other of Object.keys(spies) as (keyof typeof spies)[]) {
      if (other !== key) expect(spies[other]).not.toHaveBeenCalled();
    }
  });

  it("single terminal claim: clicking two different decrees emits only the first", async () => {
    const user = userEvent.setup();
    const onSummonConsort = vi.fn();
    const onBestow = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} onBestow={onBestow} />);
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    await user.click(screen.getByRole("button", { name: "赏赐" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(onBestow).not.toHaveBeenCalled();
  });

  it("rapid double-click dispatches a decree only once", async () => {
    const user = userEvent.setup();
    const onManageRank = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onManageRank={onManageRank} />);
    await user.dblClick(screen.getByRole("button", { name: "管理侍君" }));
    expect(onManageRank).toHaveBeenCalledTimes(1);
  });

  it("interruptible=false: every decree is disabled with the reason shown; close still works", async () => {
    const user = userEvent.setup();
    const onSummonConsort = vi.fn();
    const onClose = vi.fn();
    render(
      <ChengfengDispatch
        interruptible={false}
        disabledReason="陛下正料理要务，乘风不便分身"
        {...handlers}
        onSummonConsort={onSummonConsort}
        onClose={onClose}
      />,
    );
    for (const b of decreeButtons()) expect(b).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("陛下正料理要务");
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    expect(onSummonConsort).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "作罢" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("作罢 invokes onClose exactly once", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "作罢" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape invokes onClose exactly once, and a second press after the claim is inert", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onClose={onClose} />);
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("after a decree is claimed (close fired) Escape no longer re-dispatches", async () => {
    const user = userEvent.setup();
    const onSummonConsort = vi.fn();
    const onClose = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    await user.keyboard("{Escape}");
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // terminal claim already spent
  });

  it("merely rendering invokes no callback", () => {
    const spies = {
      onSummonConsort: vi.fn(),
      onManageRank: vi.fn(),
      onBestow: vi.fn(),
      onPhysician: vi.fn(),
      onClose: vi.fn(),
    };
    render(<ChengfengDispatch interruptible {...spies} />);
    for (const fn of Object.values(spies)) expect(fn).not.toHaveBeenCalled();
  });

  it("initial focus lands on the first decree when interruptible", () => {
    render(<ChengfengDispatch interruptible {...handlers} />);
    expect(screen.getByRole("button", { name: "召见侍君" })).toHaveFocus();
  });

  it("initial focus falls back to close when interruptible=false (decrees disabled)", () => {
    render(<ChengfengDispatch interruptible={false} disabledReason="不便分身" {...handlers} />);
    expect(screen.getByRole("button", { name: "作罢" })).toHaveFocus();
  });

  it("interruptible true → false moves focus from a decree to close; false → true restores it", () => {
    const { rerender } = render(<ChengfengDispatch interruptible {...handlers} />);
    expect(screen.getByRole("button", { name: "召见侍君" })).toHaveFocus();
    rerender(<ChengfengDispatch interruptible={false} disabledReason="不便分身" {...handlers} />);
    expect(screen.getByRole("button", { name: "作罢" })).toHaveFocus();
    rerender(<ChengfengDispatch interruptible {...handlers} />);
    expect(screen.getByRole("button", { name: "召见侍君" })).toHaveFocus();
  });

  it("after a decree is claimed but the menu stays mounted, focus moves to the dialog and all decrees disable", async () => {
    const user = userEvent.setup();
    const onSummonConsort = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} />);
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toHaveFocus(); // not stranded on the now-disabled button
    for (const b of decreeButtons()) expect(b).toBeDisabled();
    expect(screen.getByRole("button", { name: "作罢" })).toBeDisabled(); // terminal: no second exit path
  });

  it("blocks close after a decree has already claimed the session", async () => {
    const user = userEvent.setup();
    const onSummonConsort = vi.fn();
    const onClose = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    const closeBtn = screen.getByRole("button", { name: "作罢" });
    expect(closeBtn).toBeDisabled();
    await user.click(closeBtn);
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // single terminal action per session
  });

  it("blocks decree dispatch after close has claimed the session (re-entrant, still mounted)", async () => {
    const user = userEvent.setup();
    const onManageRank = vi.fn();
    // onClose 内（菜单尚未卸载时）再尝试派发谕令：close 已先于回调同步 claim，应被挡下。
    const onClose = vi.fn(() => {
      screen.getByRole("button", { name: "管理侍君" }).click();
    });
    render(<ChengfengDispatch interruptible {...handlers} onManageRank={onManageRank} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "作罢" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onManageRank).not.toHaveBeenCalled();
  });

  it("a claim survives an interruptible toggle (terminal state is not reset by interruptibility)", async () => {
    const user = userEvent.setup();
    const onSummonConsort = vi.fn();
    const { rerender } = render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} />);
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    rerender(<ChengfengDispatch interruptible={false} disabledReason="x" {...handlers} onSummonConsort={onSummonConsort} />);
    rerender(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} />);
    for (const b of decreeButtons()) expect(b).toBeDisabled(); // still spent
    await user.click(screen.getByRole("button", { name: "管理侍君" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1); // no further dispatch
  });

  it("cancel path: external dismissal without selecting a decree restores focus to the opener", () => {
    render(<button data-testid="opener">opener</button>);
    const opener = screen.getByTestId("opener");
    opener.focus();
    expect(opener).toHaveFocus();
    const { unmount } = render(<ChengfengDispatch interruptible {...handlers} />);
    expect(opener).not.toHaveFocus(); // menu took focus
    unmount();
    expect(opener).toHaveFocus(); // restored
  });

  it("cancel path: 作罢 then unmount restores focus to the opener", async () => {
    const user = userEvent.setup();
    render(<button data-testid="opener">opener</button>);
    const opener = screen.getByTestId("opener");
    opener.focus();
    const { unmount } = render(<ChengfengDispatch interruptible {...handlers} />);
    await user.click(screen.getByRole("button", { name: "作罢" }));
    unmount();
    expect(opener).toHaveFocus();
  });

  it("cancel path: Escape then unmount restores focus to the opener", async () => {
    const user = userEvent.setup();
    render(<button data-testid="opener">opener</button>);
    const opener = screen.getByTestId("opener");
    opener.focus();
    const { unmount } = render(<ChengfengDispatch interruptible {...handlers} />);
    await user.keyboard("{Escape}");
    unmount();
    expect(opener).toHaveFocus();
  });

  it("handoff path: decree selection then unmount does NOT pull focus back to the opener", async () => {
    const user = userEvent.setup();
    render(<button data-testid="opener">opener</button>);
    const opener = screen.getByTestId("opener");
    opener.focus();
    const { unmount } = render(<ChengfengDispatch interruptible {...handlers} />);
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    unmount();
    expect(opener).not.toHaveFocus(); // business surface owns focus now
  });

  it("handoff path: after Chengfeng unmounts, the next business surface keeps focus (no trap interference, no opener-restore)", async () => {
    const user = userEvent.setup();
    render(<button data-testid="opener">opener</button>);
    screen.getByTestId("opener").focus();
    const onSummonConsort = vi.fn();
    const { unmount } = render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} />);
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    // real handoff: the parent unmounts Chengfeng (foreground → none) BEFORE the business modal opens.
    unmount();
    // now the next existing business surface (册封/搬迁/赏赐…) takes focus — the unmounted Chengfeng's
    // focus trap (isConnected===false) must not pull it back, and the opener must not be restored.
    render(<button data-testid="next-surface">next</button>);
    const next = screen.getByTestId("next-surface");
    next.focus();
    expect(next).toHaveFocus();
    expect(screen.getByTestId("opener")).not.toHaveFocus();
  });

  it("the claim is established synchronously before the callback runs (re-entrant dispatch is blocked while still mounted)", async () => {
    const user = userEvent.setup();
    const onManageRank = vi.fn();
    // 回调内（菜单尚未卸载时）再次尝试派发另一道谕令：claim 已先于本回调同步置位，应被挡下。
    const onSummonConsort = vi.fn(() => {
      screen.getByRole("button", { name: "管理侍君" }).click();
    });
    render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} onManageRank={onManageRank} />);
    await user.click(screen.getByRole("button", { name: "召见侍君" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(onManageRank).not.toHaveBeenCalled(); // re-entrant attempt blocked by the already-spent claim
  });

  it("no .modal-backdrop overlay node is rendered by the component itself", () => {
    const { container } = render(<ChengfengDispatch interruptible {...handlers} />);
    expect(container.querySelector(".modal-backdrop")).toBeNull();
  });
});

describe("ChengfengDispatch — true modal focus containment (Blocker 2)", () => {
  it("Tab and Shift+Tab cycle within the dialog; outside buttons are unreachable", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside-before</button>
        <ChengfengDispatch interruptible {...handlers} />
        <button type="button">outside-after</button>
      </>,
    );
    const before = screen.getByRole("button", { name: "outside-before" });
    const after = screen.getByRole("button", { name: "outside-after" });
    for (let i = 0; i < 10; i++) {
      await user.tab();
      expect(before).not.toHaveFocus();
      expect(after).not.toHaveFocus();
    }
    for (let i = 0; i < 10; i++) {
      await user.tab({ shift: true });
      expect(before).not.toHaveFocus();
      expect(after).not.toHaveFocus();
    }
  });
});

describe("ChengfengDispatch — focus recovery after escape (Blocker 2 / re-review P1)", () => {
  it("focusing an outside element is immediately returned inside the dialog", () => {
    render(
      <>
        <button type="button">outside</button>
        <ChengfengDispatch interruptible {...handlers} />
      </>,
    );
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    expect(outside).not.toHaveFocus();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("after focus escapes, Tab keeps focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <ChengfengDispatch interruptible {...handlers} />
      </>,
    );
    screen.getByRole("button", { name: "outside" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "outside" })).not.toHaveFocus();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});
