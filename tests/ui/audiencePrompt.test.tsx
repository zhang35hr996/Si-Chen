import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AudiencePrompt } from "../../src/ui/components/AudiencePrompt";

const base = {
  visitorName: "卫绥",
  visitorTitle: "礼官",
  message: "礼官卫绥在殿外候见，为传月祭仪向陛下请示。",
  onAdmit: () => {},
  onDefer: () => {},
};

describe("AudiencePrompt", () => {
  it("1. renders the visitor identity and message as a dialog landmark", () => {
    render(<AudiencePrompt {...base} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("卫绥");
    expect(dialog).toHaveTextContent("礼官");
    expect(dialog).toHaveTextContent("为传月祭仪");
  });

  it("8. action buttons have accessible names", () => {
    render(<AudiencePrompt {...base} />);
    expect(screen.getByRole("button", { name: "宣进来" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记入待宣" })).toBeInTheDocument();
  });

  it("2. 宣进来 invokes only onAdmit", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    const onDefer = vi.fn();
    render(<AudiencePrompt {...base} onAdmit={onAdmit} onDefer={onDefer} />);
    await user.click(screen.getByRole("button", { name: "宣进来" }));
    expect(onAdmit).toHaveBeenCalledTimes(1);
    expect(onDefer).not.toHaveBeenCalled();
  });

  it("3. 记入待宣 invokes only onDefer", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    const onDefer = vi.fn();
    render(<AudiencePrompt {...base} onAdmit={onAdmit} onDefer={onDefer} />);
    await user.click(screen.getByRole("button", { name: "记入待宣" }));
    expect(onDefer).toHaveBeenCalledTimes(1);
    expect(onAdmit).not.toHaveBeenCalled();
  });

  it("4. busy disables both actions and blocks dispatch", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    const onDefer = vi.fn();
    render(<AudiencePrompt {...base} busy onAdmit={onAdmit} onDefer={onDefer} />);
    const admit = screen.getByRole("button", { name: "宣进来" });
    const defer = screen.getByRole("button", { name: "记入待宣" });
    expect(admit).toBeDisabled();
    expect(defer).toBeDisabled();
    await user.click(admit);
    await user.click(defer);
    expect(onAdmit).not.toHaveBeenCalled();
    expect(onDefer).not.toHaveBeenCalled();
  });

  it("5. the primary admit action receives initial focus", () => {
    render(<AudiencePrompt {...base} />);
    expect(screen.getByRole("button", { name: "宣进来" })).toHaveFocus();
  });

  it("6. Escape invokes defer exactly once", async () => {
    const user = userEvent.setup();
    const onDefer = vi.fn();
    render(<AudiencePrompt {...base} onDefer={onDefer} />);
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}"); // second press after defer is locked
    expect(onDefer).toHaveBeenCalledTimes(1);
  });

  it("7. repeated fast clicks cannot dispatch admit twice", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    render(<AudiencePrompt {...base} onAdmit={onAdmit} />);
    const admit = screen.getByRole("button", { name: "宣进来" });
    await user.dblClick(admit);
    expect(onAdmit).toHaveBeenCalledTimes(1);
  });

  it("affordability: unaffordable disables 宣入 and shows the reason; 记入待宣 still works", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    const onDefer = vi.fn();
    render(<AudiencePrompt {...base} affordable={false} disabledReason="行动力不足" onAdmit={onAdmit} onDefer={onDefer} />);
    const admit = screen.getByRole("button", { name: "宣进来" });
    expect(admit).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("行动力不足");
    await user.click(admit);
    expect(onAdmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "记入待宣" }));
    expect(onDefer).toHaveBeenCalledTimes(1);
  });

  it("no .modal-backdrop overlay (non-blocking, in-scene prompt)", () => {
    const { container } = render(<AudiencePrompt {...base} />);
    expect(container.querySelector(".modal-backdrop")).toBeNull();
  });
});
