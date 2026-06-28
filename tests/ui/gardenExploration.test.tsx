import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GardenOverviewScreen, type GardenSubAreaView } from "../../src/ui/screens/GardenOverviewScreen";

const subAreas: GardenSubAreaView[] = [
  { id: "jiangxuexuan", name: "绛雪轩", description: "轩前海棠成荫。", background: "/bg/jx.png", hasEvent: false, characters: [{ id: "gu_suhua", name: "顾素华", role: "承仪" }] },
  { id: "taiyechi", name: "太液池", description: "池水开阔。", background: "/bg/ty.png", hasEvent: true, eventHint: "似有一道孤影久立。", characters: [{ id: "wang_longcheng", name: "王龙城", role: "良驸" }, { id: "he_wenyuan", name: "贺文渊", role: "承德" }] },
  { id: "fubiting", name: "浮碧亭", description: "亭立水心。", background: "/bg/fb.png", hasEvent: false, characters: [] },
  { id: "tuixiushan", name: "堆秀山", description: "叠石为山。", background: "/bg/tx.png", hasEvent: false, characters: [] },
];

const base = {
  background: "/bg/garden.png",
  subAreas,
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

  it("总览不再渲染统一「园中之人」人物栏", () => {
    render(<GardenOverviewScreen {...base} />);
    expect(screen.queryByRole("group", { name: "园中之人" })).toBeNull();
    // 总览中的名字是纯文本提示，不是可交互人物按钮（无 chip 按钮 role）
    expect(screen.queryByRole("button", { name: "顾素华 · 承仪" })).toBeNull();
  });

  it("人物姓名显示在其所属子地点卡片下，每人恰好出现一次", () => {
    render(<GardenOverviewScreen {...base} />);
    const ty = screen.getByText("太液池").closest("button")!;
    const jx = screen.getByText("绛雪轩").closest("button")!;
    // 太液池：王龙城 + 贺文渊；绛雪轩：顾素华
    expect(within(ty).getByText(/王龙城/)).toBeInTheDocument();
    expect(within(ty).getByText(/贺文渊/)).toBeInTheDocument();
    expect(within(jx).getByText(/顾素华/)).toBeInTheDocument();
    // 每人全局恰好一次
    expect(screen.getAllByText(/王龙城/)).toHaveLength(1);
    expect(screen.getAllByText(/顾素华/)).toHaveLength(1);
    // 王龙城不出现在绛雪轩
    expect(within(jx).queryByText(/王龙城/)).toBeNull();
  });

  it("无人的子地点显示「暂无人在此」", () => {
    render(<GardenOverviewScreen {...base} />);
    const fb = screen.getByText("浮碧亭").closest("button")!;
    expect(within(fb).getByText("暂无人在此")).toBeInTheDocument();
  });
});

describe("GardenOverviewScreen — sub-area", () => {
  it("3/6. an entered sub-area shows its background scene + static description + return", async () => {
    const user = userEvent.setup();
    const onExitSubArea = vi.fn();
    render(
      <GardenOverviewScreen
        {...base}
        activeSubArea={subAreas[2]}
        onExitSubArea={onExitSubArea}
      />,
    );
    expect(screen.getByLabelText("御花园 · 浮碧亭")).toBeInTheDocument();
    expect(screen.getByText("亭立水心。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回御花园" }));
    expect(onExitSubArea).toHaveBeenCalledTimes(1);
  });

  it("5. a sub-area with no event + no people shows only static environment, no fabricated clues, no people bar", () => {
    render(<GardenOverviewScreen {...base} activeSubArea={subAreas[2]} />);
    expect(screen.getByText("亭立水心。")).toBeInTheDocument();
    expect(screen.queryByText(/孤影|人影|动静/)).toBeNull();
    // 0 人：不显示人物栏
    expect(screen.queryByRole("group", { name: "此处之人" })).toBeNull();
  });

  it("子地点只展示分配到该地点的人物（多人可切换），不混入其他地点的人", () => {
    render(
      <GardenOverviewScreen
        {...base}
        activeSubArea={subAreas[1]} // 太液池：王龙城 + 贺文渊
      />,
    );
    const bar = screen.getByRole("group", { name: "此处之人" });
    expect(within(bar).getByRole("button", { name: "王龙城 · 良驸" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "贺文渊 · 承德" })).toBeInTheDocument();
    // 顾素华属绛雪轩，不应出现在太液池
    expect(within(bar).queryByRole("button", { name: /顾素华/ })).toBeNull();
  });

  it("单人子地点：选中后立绘 + 叙话可达（App 自动聚焦由 selectedId 喂入）", () => {
    render(
      <GardenOverviewScreen
        {...base}
        activeSubArea={subAreas[0]} // 绛雪轩：顾素华一人
        selectedId="gu_suhua"
        focusedCharacter={{ id: "gu_suhua", name: "顾素华", role: "承仪", isConsort: true, isEmpress: false, actionable: true, portraitSrc: "/p.png" }}
        onConverse={() => {}}
        onViewProfile={() => {}}
      />,
    );
    expect(screen.getByRole("group", { name: "此处之人" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "顾素华" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "叙话" })).toBeInTheDocument();
  });

  it("多人子地点：点击某人触发 onSelectCharacter", async () => {
    const user = userEvent.setup();
    const onSelectCharacter = vi.fn();
    render(
      <GardenOverviewScreen
        {...base}
        activeSubArea={subAreas[1]}
        onSelectCharacter={onSelectCharacter}
      />,
    );
    await user.click(screen.getByRole("button", { name: "贺文渊 · 承德" }));
    expect(onSelectCharacter).toHaveBeenCalledExactlyOnceWith("he_wenyuan");
  });

  it("Blocker: a sub-area with an UNAFFORDABLE event shows the real reason, not 普通游览 silence", () => {
    const unaffordable: GardenSubAreaView = {
      ...subAreas[1]!,
      hasEvent: true,
      eventAffordable: false,
      eventReason: "行动力不足（需 1 行动点）。",
    };
    render(<GardenOverviewScreen {...base} activeSubArea={unaffordable} />);
    expect(screen.getByRole("note")).toHaveTextContent("行动力不足");
  });
});
