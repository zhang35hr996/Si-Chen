import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  PendingAudienceDrawer,
  type PendingAudienceViewItem,
} from "../../src/ui/components/PendingAudienceDrawer";

const items: PendingAudienceViewItem[] = [
  { eventId: "ev_a", visitorName: "卫绥", visitorTitle: "礼官", message: "传月祭仪请示。", status: "pending", deferredLabel: "候见于初一", affordable: true },
  { eventId: "ev_b", visitorName: "沈砚", message: "户部奏报。", status: "suppressed", affordable: true },
  { eventId: "ev_c", visitorName: "陆参", message: "边关急报。", status: "pending", affordable: false, disabledReason: "行动力不足" },
];

// All admit buttons regardless of visitor (identity-specific names start with 宣进来).
const allAdmitButtons = () => screen.getAllByRole("button", { name: /^宣进来/ });
const admitFor = (visitorName: string) => screen.getByRole("button", { name: `宣进来：${visitorName}` });
const noop = () => {};

describe("PendingAudienceDrawer", () => {
  it("1/2/3. renders every pending AND suppressed item with name + message (no filtering)", () => {
    render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={noop} />);
    for (const it of items) {
      expect(screen.getByText(it.visitorName)).toBeInTheDocument();
      expect(screen.getByText(it.message)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(3); // includes the suppressed one
  });

  it("Blocker 1. each admit button has an identity-specific accessible name", () => {
    render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={noop} />);
    expect(admitFor("卫绥")).toBeInTheDocument();
    expect(admitFor("沈砚")).toBeInTheDocument();
    expect(admitFor("陆参")).toBeInTheDocument();
    expect(allAdmitButtons()).toHaveLength(3);
  });

  it("18. dialog + close button expose accessible names", () => {
    render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={noop} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog")).toHaveAccessibleName("待宣事务");
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("4. clicking 卫绥's action emits ev_a (by identity, not position)", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    await user.click(admitFor("卫绥"));
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_a");
  });

  it("5/8. clicking 沈砚's action emits ev_b (actionable alongside an unaffordable sibling)", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    await user.click(admitFor("沈砚"));
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_b");
  });

  it("6/7. unaffordable 陆参: admit disabled, reason shown, no onAdmit", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    const admitC = admitFor("陆参");
    expect(admitC).toBeDisabled();
    const evC = screen.getByText("陆参").closest("li")!;
    expect(within(evC).getByRole("note")).toHaveTextContent("行动力不足");
    await user.click(admitC);
    expect(onAdmit).not.toHaveBeenCalled();
  });

  it("9. empty list shows 当前无待宣事务 and no admit buttons", () => {
    render(<PendingAudienceDrawer items={[]} onAdmit={noop} onClose={noop} />);
    expect(screen.getByText("当前无待宣事务")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^宣进来/ })).toHaveLength(0);
  });

  it("10. merely rendering calls neither onAdmit nor onClose", () => {
    const onAdmit = vi.fn();
    const onClose = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={onClose} />);
    expect(onAdmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("11. Escape calls onClose exactly once", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={onClose} />);
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("12. close button calls onClose exactly once", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("13. rapid double-click admits only once", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    await user.dblClick(admitFor("卫绥"));
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_a");
  });

  it("14. rapid clicks on two NAMED visitors emit only the first visitor's id", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    await user.click(admitFor("卫绥"));
    await user.click(admitFor("沈砚"));
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_a"); // exact id, not by DOM order
  });

  it("15. initial focus lands on the close button", () => {
    render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={noop} />);
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("16. initial busy disables all actions, focuses the dialog, Escape inert", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PendingAudienceDrawer items={items} busy onAdmit={noop} onClose={onClose} />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    for (const b of allAdmitButtons()) expect(b).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Blocker 2 / regr 3. busy false → true moves focus from close to dialog", () => {
    const { rerender } = render(<PendingAudienceDrawer items={items} busy={false} onAdmit={noop} onClose={noop} />);
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    rerender(<PendingAudienceDrawer items={items} busy={true} onAdmit={noop} onClose={noop} />);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("Blocker 2 / regr 4. busy true → false (no dispatch) moves focus from dialog to close", () => {
    const { rerender } = render(<PendingAudienceDrawer items={items} busy={true} onAdmit={noop} onClose={noop} />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    rerender(<PendingAudienceDrawer items={items} busy={false} onAdmit={noop} onClose={noop} />);
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("Blocker 2 / regr 5. after admit is claimed but the drawer stays mounted, focus moves to dialog and all actions disable", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    await user.click(admitFor("卫绥"));
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_a");
    expect(screen.getByRole("dialog")).toHaveFocus(); // not stranded on the now-disabled button
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    for (const b of allAdmitButtons()) expect(b).toBeDisabled();
  });

  it("17. unmount restores focus to the element that opened the drawer", () => {
    render(<button data-testid="opener">opener</button>);
    const opener = screen.getByTestId("opener");
    opener.focus();
    expect(opener).toHaveFocus();
    const { unmount } = render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={noop} />);
    expect(opener).not.toHaveFocus(); // drawer took focus
    unmount();
    expect(opener).toHaveFocus(); // restored
  });

  it("no silent removal: renders directly from a frozen props array without mutating/hiding items", async () => {
    const user = userEvent.setup();
    const frozen = Object.freeze(items.map((i) => Object.freeze({ ...i }))) as readonly PendingAudienceViewItem[];
    render(<PendingAudienceDrawer items={frozen} onAdmit={noop} onClose={noop} />);
    await user.click(screen.getByRole("button", { name: "关闭" })); // interaction must not mutate the array
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(frozen).toHaveLength(3);
  });
});
