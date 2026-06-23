/**
 * jsdom/RTL 测试 lane 的最小自证（PR2 harness commit）。证明：
 *  - jsdom 环境 + @vitejs/plugin-react 能渲染 TSX；
 *  - @testing-library/react render + screen 查询可用；
 *  - @testing-library/user-event 点击可触发回调；
 *  - @testing-library/jest-dom 匹配器（toBeDisabled / toHaveTextContent）已注册。
 * 实际组件测试在各组件 commit 中加入；本文件仅验证 lane 本身。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Counter({ onClick }: { onClick: () => void }) {
  const [n, setN] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        setN((v) => v + 1);
        onClick();
      }}
    >
      count {n}
    </button>
  );
}

describe("jsdom/RTL harness", () => {
  it("renders TSX and reflects state through accessible role/name", () => {
    render(<Counter onClick={() => {}} />);
    expect(screen.getByRole("button")).toHaveTextContent("count 0");
  });

  it("user-event click fires the handler and updates visible state", async () => {
    const onClick = vi.fn();
    render(<Counter onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveTextContent("count 1");
  });
});
