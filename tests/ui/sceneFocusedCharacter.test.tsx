import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SceneFocusedCharacter } from "../../src/ui/components/SceneFocusedCharacter";
import type { FocusedCharacterView } from "../../src/ui/sceneView";

const consort = (patch: Partial<FocusedCharacterView> = {}): FocusedCharacterView => ({
  id: "lu_huaijin",
  name: "陆怀瑾",
  role: "嫔",
  portraitSrc: "/p/lu.png",
  isConsort: true,
  actionable: true,
  ...patch,
});

describe("SceneFocusedCharacter", () => {
  it("renders portrait + name + role (not a CharacterCard / stat grid)", () => {
    const { container } = render(<SceneFocusedCharacter view={consort()} onViewProfile={() => {}} />);
    expect(screen.getByRole("img", { name: "陆怀瑾" })).toBeInTheDocument();
    expect(screen.getByText("陆怀瑾")).toBeInTheDocument();
    expect(screen.getByText("嫔")).toBeInTheDocument();
    expect(container.querySelector(".character-card")).toBeNull();
    expect(container.querySelector(".stat-grid")).toBeNull();
  });

  it("actionable consort shows 叙话 + 侍寝 + 查看详情", () => {
    render(
      <SceneFocusedCharacter view={consort()} onConverse={() => {}} onBedchamber={() => {}} onViewProfile={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "叙话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "侍寝" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看详情" })).toBeInTheDocument();
  });

  it("查看详情 opens the existing drawer via callback", async () => {
    const user = userEvent.setup();
    const onViewProfile = vi.fn();
    render(<SceneFocusedCharacter view={consort()} onViewProfile={onViewProfile} />);
    await user.click(screen.getByRole("button", { name: "查看详情" }));
    expect(onViewProfile).toHaveBeenCalledExactlyOnceWith("lu_huaijin");
  });

  it("non-actionable consort hides 叙话/侍寝 and shows the real reason", () => {
    render(
      <SceneFocusedCharacter
        view={consort({ actionable: false, unavailableReason: "今旬行动力已尽。" })}
        onConverse={() => {}}
        onBedchamber={() => {}}
        onViewProfile={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "叙话" })).toBeNull();
    expect(screen.queryByRole("button", { name: "侍寝" })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("今旬行动力已尽。");
  });

  it("official (non-consort) shows only 查看详情, never 侍寝", () => {
    render(
      <SceneFocusedCharacter
        view={consort({ id: "wei_sui", name: "卫绥", role: "司礼", isConsort: false, actionable: false })}
        onConverse={() => {}}
        onBedchamber={() => {}}
        onViewProfile={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "侍寝" })).toBeNull();
    expect(screen.queryByRole("button", { name: "叙话" })).toBeNull();
    expect(screen.getByRole("button", { name: "查看详情" })).toBeInTheDocument();
  });

  it("更多 menu exposes 管理位分 and 安排迁居", async () => {
    const user = userEvent.setup();
    const onManage = vi.fn();
    const onRelocate = vi.fn();
    render(
      <SceneFocusedCharacter view={consort()} onViewProfile={() => {}} onManage={onManage} onRelocate={onRelocate} />,
    );
    await user.click(screen.getByRole("button", { name: "更多 ▾" }));
    await user.click(screen.getByRole("button", { name: "管理位分 / 封号" }));
    expect(onManage).toHaveBeenCalledExactlyOnceWith("lu_huaijin");
  });
});
