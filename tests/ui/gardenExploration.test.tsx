import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GardenOverviewScreen, type GardenSubAreaView } from "../../src/ui/screens/GardenOverviewScreen";

const subAreas: GardenSubAreaView[] = [
  { id: "jiangxuexuan", name: "绛雪轩", description: "轩前海棠成荫。", background: "/bg/jx.png", hasEvent: false },
  { id: "taiyechi", name: "太液池", description: "池水开阔。", background: "/bg/ty.png", hasEvent: true, eventHint: "似有一道孤影久立。" },
  { id: "fubiting", name: "浮碧亭", description: "亭立水心。", background: "/bg/fb.png", hasEvent: false },
  { id: "tuixiushan", name: "堆秀山", description: "叠石为山。", background: "/bg/tx.png", hasEvent: false },
];

const base = {
  background: "/bg/garden.png",
  subAreas,
  presentBar: [],
  onSelectCharacter: () => {},
  onEnterSubArea: () => {},
  onExitSubArea: () => {},
  onBack: () => {},
  onViewProfile: () => {},
};

describe("GardenOverviewScreen — overview", () => {
  it("1. shows all four real sub-areas with static descriptions", () => {
    render(<GardenOverviewScreen {...base} />);
    for (const sa of subAreas) {
      expect(screen.getByText(sa.name)).toBeInTheDocument();
      expect(screen.getByText(sa.description)).toBeInTheDocument();
    }
  });

  it("4/7. event hint shows ONLY for the sub-area with an eligible event; none fabricated elsewhere", () => {
    render(<GardenOverviewScreen {...base} />);
    expect(screen.getByText("似有一道孤影久立。")).toBeInTheDocument();
    // no fabricated "有人影/似有动静" on event-less areas
    const jx = screen.getByText("绛雪轩").closest("button")!;
    expect(within(jx).queryByText(/孤影|人影|动静/)).toBeNull();
  });

  it("a suppressed/ineligible event (hasEvent=false) shows no hint even if a stale hint string is passed", () => {
    const sneaky = subAreas.map((s) => (s.id === "fubiting" ? { ...s, hasEvent: false, eventHint: "线索" } : s));
    render(<GardenOverviewScreen {...base} subAreas={sneaky} />);
    expect(screen.queryByText("线索")).toBeNull();
  });

  it("2. entering a sub-area emits its id", async () => {
    const user = userEvent.setup();
    const onEnterSubArea = vi.fn();
    render(<GardenOverviewScreen {...base} onEnterSubArea={onEnterSubArea} />);
    await user.click(screen.getByText("太液池").closest("button")!);
    expect(onEnterSubArea).toHaveBeenCalledExactlyOnceWith("taiyechi");
  });

  it("garden present-people bar is shown only when there are present people (presentAt authority)", () => {
    const { rerender } = render(<GardenOverviewScreen {...base} />);
    expect(screen.queryByRole("group", { name: "园中之人" })).toBeNull();
    rerender(
      <GardenOverviewScreen
        {...base}
        presentBar={[{ id: "lu_huaijin", name: "陆怀瑾", role: "嫔" }]}
        selectedId="lu_huaijin"
        focusedCharacter={{ id: "lu_huaijin", name: "陆怀瑾", role: "嫔", isConsort: true, actionable: true, portraitSrc: "/p.png" }}
        onViewProfile={() => {}}
      />,
    );
    expect(screen.getByRole("group", { name: "园中之人" })).toBeInTheDocument();
    // 8. the present consort appears exactly once as a person item (one bar button) and one portrait
    expect(screen.getAllByRole("button", { name: /^陆怀瑾/ })).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: "陆怀瑾" })).toHaveLength(1);
  });

  it("8. accessible name for a present consort in the garden is correct + unique", () => {
    render(
      <GardenOverviewScreen
        {...base}
        presentBar={[{ id: "lu_huaijin", name: "陆怀瑾", role: "嫔" }]}
      />,
    );
    expect(screen.getByRole("button", { name: "陆怀瑾 · 嫔" })).toBeInTheDocument();
  });
});

describe("GardenOverviewScreen — sub-area", () => {
  it("3/6. an entered sub-area shows its background scene + static description + return", async () => {
    const user = userEvent.setup();
    const onExitSubArea = vi.fn();
    render(
      <GardenOverviewScreen
        {...base}
        activeSubArea={subAreas[1]}
        onExitSubArea={onExitSubArea}
      />,
    );
    expect(screen.getByLabelText("御花园 · 太液池")).toBeInTheDocument();
    expect(screen.getByText("池水开阔。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回御花园" }));
    expect(onExitSubArea).toHaveBeenCalledTimes(1);
  });

  it("5. a sub-area with no event shows only static environment (普通游览), no fabricated clues", () => {
    render(<GardenOverviewScreen {...base} activeSubArea={subAreas[0]} />);
    expect(screen.getByText("轩前海棠成荫。")).toBeInTheDocument();
    expect(screen.queryByText(/孤影|人影|动静/)).toBeNull();
  });
});
