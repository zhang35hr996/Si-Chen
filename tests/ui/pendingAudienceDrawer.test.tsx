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

const admitButtons = () => screen.getAllByRole("button", { name: "宣进来" });
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

  it("18. dialog + buttons expose accessible names", () => {
    render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={noop} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog")).toHaveAccessibleName("待宣事务");
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(admitButtons().length).toBe(3);
  });

  it("4. clicking an enabled item calls onAdmit with the exact eventId", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    await user.click(admitButtons()[0]!);
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_a");
  });

  it("5/8. selecting item B emits B's id (and items remain actionable alongside an unaffordable one)", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    await user.click(admitButtons()[1]!); // ev_b
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_b");
  });

  it("6/7. unaffordable item: admit disabled, reason shown, no onAdmit", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    const evC = screen.getByText("陆参").closest("li")!;
    const admitC = within(evC).getByRole("button", { name: "宣进来" });
    expect(admitC).toBeDisabled();
    expect(within(evC).getByRole("note")).toHaveTextContent("行动力不足");
    await user.click(admitC);
    expect(onAdmit).not.toHaveBeenCalled();
  });

  it("9. empty list shows 当前无待宣事务 and no admit buttons", () => {
    render(<PendingAudienceDrawer items={[]} onAdmit={noop} onClose={noop} />);
    expect(screen.getByText("当前无待宣事务")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "宣进来" })).toHaveLength(0);
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
    await user.dblClick(admitButtons()[0]!);
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_a");
  });

  it("14. rapid clicks on two different items emit only the first selection", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<PendingAudienceDrawer items={items} onAdmit={onAdmit} onClose={noop} />);
    const [a, b] = admitButtons();
    await user.click(a!);
    await user.click(b!);
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith("ev_a");
  });

  it("15. initial focus lands on the close button", () => {
    render(<PendingAudienceDrawer items={items} onAdmit={noop} onClose={noop} />);
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("16. busy disables all actions and focuses the dialog landmark", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    const onClose = vi.fn();
    render(<PendingAudienceDrawer items={items} busy onAdmit={onAdmit} onClose={onClose} />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    for (const b of admitButtons()) expect(b).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled(); // busy → escape inert
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
