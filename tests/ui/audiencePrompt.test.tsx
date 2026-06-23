import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AudiencePrompt } from "../../src/ui/components/AudiencePrompt";

const base = {
  promptId: "ev_a",
  visitorName: "卫绥",
  visitorTitle: "礼官",
  message: "礼官卫绥在殿外候见，为传月祭仪向陛下请示。",
  onAdmit: () => {},
  onDefer: () => {},
};

describe("AudiencePrompt", () => {
  it("1. renders the visitor identity and message as a NON-modal dialog landmark", () => {
    render(<AudiencePrompt {...base} />);
    const dialog = screen.getByRole("dialog");
    // 非模态叙事面板：不得宣称 aria-modal（背景动作仍可交互），否则与无障碍语义冲突。
    expect(dialog).not.toHaveAttribute("aria-modal");
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

describe("AudiencePrompt — per-promptId dispatch lock (Blocker 1)", () => {
  it("changing promptId at the same position re-enables actions and dispatches B once; A is not re-fired", async () => {
    const user = userEvent.setup();
    const onAdmitA = vi.fn();
    const onDeferB = vi.fn();
    const { rerender } = render(<AudiencePrompt {...base} promptId="ev_a" onAdmit={onAdmitA} />);
    await user.click(screen.getByRole("button", { name: "宣进来" }));
    expect(onAdmitA).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "宣进来" })).toBeDisabled(); // A now locked

    // same component position, new logical prompt B
    rerender(<AudiencePrompt {...base} promptId="ev_b" onDefer={onDeferB} />);
    const admitB = screen.getByRole("button", { name: "宣进来" });
    const deferB = screen.getByRole("button", { name: "记入待宣" });
    expect(admitB).toBeEnabled(); // B inherits no lock
    expect(deferB).toBeEnabled();
    await user.click(deferB);
    expect(onDeferB).toHaveBeenCalledTimes(1); // B dispatched once
    expect(onAdmitA).toHaveBeenCalledTimes(1); // A callback not fired again
  });

  it("re-rendering with the SAME promptId keeps the action locked", async () => {
    const user = userEvent.setup();
    const onAdmit = vi.fn();
    const { rerender } = render(<AudiencePrompt {...base} promptId="ev_a" onAdmit={onAdmit} />);
    await user.click(screen.getByRole("button", { name: "宣进来" }));
    rerender(<AudiencePrompt {...base} promptId="ev_a" onAdmit={onAdmit} />); // same id
    expect(screen.getByRole("button", { name: "宣进来" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "宣进来" }));
    expect(onAdmit).toHaveBeenCalledTimes(1); // still locked
  });
});

describe("AudiencePrompt — identity-aware initial focus (Blocker 2)", () => {
  it("affordable prompt focuses 宣进来", () => {
    render(<AudiencePrompt {...base} affordable />);
    expect(screen.getByRole("button", { name: "宣进来" })).toHaveFocus();
  });

  it("unaffordable prompt focuses 记入待宣 (admit is disabled, can't hold focus)", () => {
    render(<AudiencePrompt {...base} affordable={false} disabledReason="行动力不足" />);
    expect(screen.getByRole("button", { name: "记入待宣" })).toHaveFocus();
  });

  it("busy prompt focuses the dialog landmark", () => {
    render(<AudiencePrompt {...base} busy />);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("changing promptId moves focus to the new prompt's appropriate target", () => {
    const { rerender } = render(<AudiencePrompt {...base} promptId="ev_a" affordable />);
    expect(screen.getByRole("button", { name: "宣进来" })).toHaveFocus();
    rerender(<AudiencePrompt {...base} promptId="ev_b" affordable={false} disabledReason="行动力不足" />);
    expect(screen.getByRole("button", { name: "记入待宣" })).toHaveFocus(); // refocus on the new prompt's enabled target
  });
});
