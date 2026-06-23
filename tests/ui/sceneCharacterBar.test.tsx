import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SceneCharacterBar, type SceneCharacterBarItem } from "../../src/ui/components/SceneCharacterBar";

const many: SceneCharacterBarItem[] = [
  { id: "wei_ling", name: "卫绫", role: "贵妃" },
  { id: "shen_zhibai", name: "沈知白", role: "君卿" },
  { id: "lu_can", name: "陆参", role: "美人" },
];

describe("SceneCharacterBar", () => {
  it("1a. 0 people → natural empty state, no buttons, no empty card frame", () => {
    const { container } = render(<SceneCharacterBar characters={[]} onFocus={() => {}} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("此处无人。")).toBeInTheDocument();
    expect(container.querySelector(".character-card")).toBeNull();
  });

  it("1a. custom empty hint is honored", () => {
    render(<SceneCharacterBar characters={[]} emptyHint="园中无人。" onFocus={() => {}} />);
    expect(screen.getByText("园中无人。")).toBeInTheDocument();
  });

  it("1b. 1 person renders exactly one selectable item", () => {
    render(<SceneCharacterBar characters={[many[0]!]} onFocus={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "卫绫 · 贵妃" })).toBeInTheDocument();
  });

  it("1c. many people render one item each with name + role", () => {
    render(<SceneCharacterBar characters={many} onFocus={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "卫绫 · 贵妃" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "沈知白 · 君卿" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "陆参 · 美人" })).toBeInTheDocument();
  });

  it("2. current selection is marked with aria-pressed", () => {
    render(<SceneCharacterBar characters={many} selectedId="shen_zhibai" onFocus={() => {}} />);
    expect(screen.getByRole("button", { name: "沈知白 · 君卿" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "卫绫 · 贵妃" })).toHaveAttribute("aria-pressed", "false");
  });

  it("3a. mouse click selects (emits id)", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(<SceneCharacterBar characters={many} onFocus={onFocus} />);
    await user.click(screen.getByRole("button", { name: "陆参 · 美人" }));
    expect(onFocus).toHaveBeenCalledExactlyOnceWith("lu_can");
  });

  it("3b. keyboard (Tab + Enter) selects", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(<SceneCharacterBar characters={many} onFocus={onFocus} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "卫绫 · 贵妃" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onFocus).toHaveBeenCalledExactlyOnceWith("wei_ling");
  });

  it("3c. ArrowRight moves focus to the next item", async () => {
    const user = userEvent.setup();
    render(<SceneCharacterBar characters={many} onFocus={() => {}} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "卫绫 · 贵妃" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "沈知白 · 君卿" })).toHaveFocus();
  });

  it("4. an unavailable item is shown but disabled and never emits", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(
      <SceneCharacterBar
        characters={[{ ...many[0]!, disabled: true, disabledReason: "禁足" }]}
        onFocus={onFocus}
      />,
    );
    const btn = screen.getByRole("button", { name: /卫绫/ });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("6. renders no CharacterCard (lightweight selector only)", () => {
    const { container } = render(<SceneCharacterBar characters={many} onFocus={() => {}} />);
    expect(container.querySelector(".character-card")).toBeNull();
    // no full profile stats grid leaks into the bar
    expect(screen.queryByText(/恩宠|健康|容貌/)).toBeNull();
  });

  it("7. accessible names are unique per item", () => {
    render(<SceneCharacterBar characters={many} onFocus={() => {}} />);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(new Set(names).size).toBe(names.length);
  });

  it("8. group landmark, not a dialog (no duplicate dialog landmark on mobile)", () => {
    render(<SceneCharacterBar characters={many} onFocus={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("group", { name: "在场人物" })).toBeInTheDocument();
  });

  it("5. selection reconciliation: when the selected char leaves the list, no stale aria-pressed remains", () => {
    const { rerender } = render(
      <SceneCharacterBar characters={many} selectedId="lu_can" onFocus={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "陆参 · 美人" })).toHaveAttribute("aria-pressed", "true");
    // lu_can physically leaves; parent reconciles selectedId to wei_ling
    rerender(
      <SceneCharacterBar
        characters={[many[0]!, many[1]!]}
        selectedId="wei_ling"
        onFocus={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "陆参 · 美人" })).toBeNull();
    expect(screen.getByRole("button", { name: "卫绫 · 贵妃" })).toHaveAttribute("aria-pressed", "true");
  });
});
