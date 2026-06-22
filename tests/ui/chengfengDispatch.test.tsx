import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChengfengDispatch } from "../../src/ui/components/ChengfengDispatch";

const noop = () => {};
const handlers = {
  onSummonConsort: noop,
  onManageRank: noop,
  onRelocate: noop,
  onBestow: noop,
  onPhysician: noop,
  onClose: noop,
};

// The five decree actions, each with a distinct accessible name (no positional indexing).
const decrees = ["召见妃嫔", "调整位分", "安排迁居", "赏赐", "传太医"];
const decreeButtons = () => decrees.map((name) => screen.getByRole("button", { name }));

describe("ChengfengDispatch", () => {
  it("renders 乘风's framing as a dialog landmark with an accessible name", () => {
    render(<ChengfengDispatch interruptible {...handlers} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("传乘风");
    expect(dialog).toHaveTextContent("乘风");
  });

  it("exposes all five decree actions plus close, each by a distinct accessible name", () => {
    render(<ChengfengDispatch interruptible {...handlers} />);
    for (const name of decrees) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作罢" })).toBeInTheDocument();
  });

  it.each([
    ["召见妃嫔", "onSummonConsort"],
    ["调整位分", "onManageRank"],
    ["安排迁居", "onRelocate"],
    ["赏赐", "onBestow"],
    ["传太医", "onPhysician"],
  ] as const)("clicking %s invokes only %s", async (name, key) => {
    const user = userEvent.setup();
    const spies = {
      onSummonConsort: vi.fn(),
      onManageRank: vi.fn(),
      onRelocate: vi.fn(),
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
    await user.click(screen.getByRole("button", { name: "召见妃嫔" }));
    await user.click(screen.getByRole("button", { name: "赏赐" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(onBestow).not.toHaveBeenCalled();
  });

  it("rapid double-click dispatches a decree only once", async () => {
    const user = userEvent.setup();
    const onRelocate = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onRelocate={onRelocate} />);
    await user.dblClick(screen.getByRole("button", { name: "安排迁居" }));
    expect(onRelocate).toHaveBeenCalledTimes(1);
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
    await user.click(screen.getByRole("button", { name: "召见妃嫔" }));
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
    await user.click(screen.getByRole("button", { name: "召见妃嫔" }));
    await user.keyboard("{Escape}");
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // terminal claim already spent
  });

  it("merely rendering invokes no callback", () => {
    const spies = {
      onSummonConsort: vi.fn(),
      onManageRank: vi.fn(),
      onRelocate: vi.fn(),
      onBestow: vi.fn(),
      onPhysician: vi.fn(),
      onClose: vi.fn(),
    };
    render(<ChengfengDispatch interruptible {...spies} />);
    for (const fn of Object.values(spies)) expect(fn).not.toHaveBeenCalled();
  });

  it("initial focus lands on the first decree when interruptible", () => {
    render(<ChengfengDispatch interruptible {...handlers} />);
    expect(screen.getByRole("button", { name: "召见妃嫔" })).toHaveFocus();
  });

  it("initial focus falls back to close when interruptible=false (decrees disabled)", () => {
    render(<ChengfengDispatch interruptible={false} disabledReason="不便分身" {...handlers} />);
    expect(screen.getByRole("button", { name: "作罢" })).toHaveFocus();
  });

  it("interruptible true → false moves focus from a decree to close; false → true restores it", () => {
    const { rerender } = render(<ChengfengDispatch interruptible {...handlers} />);
    expect(screen.getByRole("button", { name: "召见妃嫔" })).toHaveFocus();
    rerender(<ChengfengDispatch interruptible={false} disabledReason="不便分身" {...handlers} />);
    expect(screen.getByRole("button", { name: "作罢" })).toHaveFocus();
    rerender(<ChengfengDispatch interruptible {...handlers} />);
    expect(screen.getByRole("button", { name: "召见妃嫔" })).toHaveFocus();
  });

  it("after a decree is claimed but the menu stays mounted, focus moves to the dialog and all decrees disable", async () => {
    const user = userEvent.setup();
    const onSummonConsort = vi.fn();
    render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} />);
    await user.click(screen.getByRole("button", { name: "召见妃嫔" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toHaveFocus(); // not stranded on the now-disabled button
    for (const b of decreeButtons()) expect(b).toBeDisabled();
  });

  it("a claim survives an interruptible toggle (terminal state is not reset by interruptibility)", async () => {
    const user = userEvent.setup();
    const onSummonConsort = vi.fn();
    const { rerender } = render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} />);
    await user.click(screen.getByRole("button", { name: "召见妃嫔" }));
    rerender(<ChengfengDispatch interruptible={false} disabledReason="x" {...handlers} onSummonConsort={onSummonConsort} />);
    rerender(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} />);
    for (const b of decreeButtons()) expect(b).toBeDisabled(); // still spent
    await user.click(screen.getByRole("button", { name: "调整位分" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1); // no further dispatch
  });

  it("unmount restores focus to the element that opened the menu", () => {
    render(<button data-testid="opener">opener</button>);
    const opener = screen.getByTestId("opener");
    opener.focus();
    expect(opener).toHaveFocus();
    const { unmount } = render(<ChengfengDispatch interruptible {...handlers} />);
    expect(opener).not.toHaveFocus(); // menu took focus
    unmount();
    expect(opener).toHaveFocus(); // restored
  });

  it("the claim is established synchronously before the callback runs (re-entrant dispatch is blocked while still mounted)", async () => {
    const user = userEvent.setup();
    const onManageRank = vi.fn();
    // 回调内（菜单尚未卸载时）再次尝试派发另一道谕令：claim 已先于本回调同步置位，应被挡下。
    const onSummonConsort = vi.fn(() => {
      screen.getByRole("button", { name: "调整位分" }).click();
    });
    render(<ChengfengDispatch interruptible {...handlers} onSummonConsort={onSummonConsort} onManageRank={onManageRank} />);
    await user.click(screen.getByRole("button", { name: "召见妃嫔" }));
    expect(onSummonConsort).toHaveBeenCalledTimes(1);
    expect(onManageRank).not.toHaveBeenCalled(); // re-entrant attempt blocked by the already-spent claim
  });

  it("no .modal-backdrop overlay node is rendered by the component itself", () => {
    const { container } = render(<ChengfengDispatch interruptible {...handlers} />);
    expect(container.querySelector(".modal-backdrop")).toBeNull();
  });
});
