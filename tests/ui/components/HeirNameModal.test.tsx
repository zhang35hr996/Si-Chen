/**
 * HeirNameModal 双胎命名队列 key 重置行为：
 * 当 key 变更时（队头 ID 切换），React 卸载旧实例并挂载新实例，
 * 内部 useState("") 重新执行，输入框恢复为空且确认按钮恢复禁用。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HeirNameModal } from "../../../src/ui/components/HeirNameModal";

/**
 * 模拟 App 中的双胎命名队列：持有 [id1, id2] → 确认后弹出队头。
 * HeirNameModal 带 key={currentId}，队头变化时 React 重置组件实例。
 */
function TwinNamingQueue({
  ids,
  onConfirm,
}: {
  ids: string[];
  onConfirm: (id: string, name: string) => void;
}) {
  const [queue, setQueue] = useState(ids);
  const currentId = queue[0] ?? null;
  return currentId ? (
    <HeirNameModal
      key={currentId}
      title={`为新生皇嗣起个小名 (${currentId})`}
      hint="乳名一双字，亲昵相唤。"
      confirmLabel="起名"
      onConfirm={(name) => {
        onConfirm(currentId, name);
        setQueue((q) => q.slice(1));
      }}
    />
  ) : null;
}

describe("HeirNameModal — twin naming queue key reset", () => {
  it("input starts empty and confirm is disabled", () => {
    render(<HeirNameModal title="起名" hint="" confirmLabel="起名" onConfirm={vi.fn()} />);
    expect(screen.getByPlaceholderText("二字名")).toHaveValue("");
    expect(screen.getByRole("button", { name: "起名" })).toBeDisabled();
  });

  it("confirm enables only after valid input (1–2 chars)", async () => {
    const user = userEvent.setup();
    render(<HeirNameModal title="起名" hint="" confirmLabel="起名" onConfirm={vi.fn()} />);
    const input = screen.getByPlaceholderText("二字名");
    const btn = screen.getByRole("button", { name: "起名" });
    await user.type(input, "小");
    expect(btn).not.toBeDisabled();
  });

  it("switching key resets input — simulates queue progression to second twin", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<TwinNamingQueue ids={["heir_000001", "heir_000002"]} onConfirm={onConfirm} />);

    // First modal: heir_000001
    const input = screen.getByPlaceholderText("二字名");
    expect(input).toHaveValue("");

    await user.type(input, "小一");
    expect(screen.getByRole("button", { name: "起名" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "起名" }));
    expect(onConfirm).toHaveBeenCalledWith("heir_000001", "小一");

    // Second modal: heir_000002 — key changed, input MUST be empty
    expect(screen.getByPlaceholderText("二字名")).toHaveValue("");
    expect(screen.getByRole("button", { name: "起名" })).toBeDisabled();
  });

  it("names both twins in full queue flow, queue empties after second", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<TwinNamingQueue ids={["heir_000001", "heir_000002"]} onConfirm={onConfirm} />);

    // Name first
    await user.type(screen.getByPlaceholderText("二字名"), "小一");
    await user.click(screen.getByRole("button", { name: "起名" }));

    // Name second
    await user.type(screen.getByPlaceholderText("二字名"), "小二");
    await user.click(screen.getByRole("button", { name: "起名" }));

    expect(onConfirm).toHaveBeenNthCalledWith(1, "heir_000001", "小一");
    expect(onConfirm).toHaveBeenNthCalledWith(2, "heir_000002", "小二");

    // Queue exhausted — modal unmounts
    expect(screen.queryByPlaceholderText("二字名")).toBeNull();
  });
});
