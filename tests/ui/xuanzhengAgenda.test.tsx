import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { XuanzhengdianScreen } from "../../src/ui/screens/XuanzhengdianScreen";
import type { CourtAgendaItem } from "../../src/engine/court/agenda";

const agenda: CourtAgendaItem[] = [
  { id: "ev_a", title: "漕运疏浚" },
  { id: "ev_b", title: "边镇请饷" },
];

const base = {
  background: "/bg/xzd.png",
  agenda,
  holdGate: { ok: true } as const,
  onHoldCourt: () => {},
  onLeave: () => {},
  onBackToHall: () => {},
  onBackToMap: () => {},
};

describe("XuanzhengdianScreen — agenda mode", () => {
  it("shows real agenda titles + 升朝", () => {
    render(<XuanzhengdianScreen {...base} />);
    expect(screen.getByText("漕运疏浚")).toBeInTheDocument();
    expect(screen.getByText("边镇请饷")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "升朝" })).toBeEnabled();
  });

  it("empty agenda → reasonable empty state, not blank", () => {
    render(<XuanzhengdianScreen {...base} agenda={[]} />);
    expect(screen.getByText("尚无待议政务。")).toBeInTheDocument();
  });

  it("AP/health gate blocks 升朝 with a real reason", () => {
    render(<XuanzhengdianScreen {...base} holdGate={{ ok: false, reason: "升朝须于卯时首理政务（行动力未满）。" }} />);
    expect(screen.getByRole("button", { name: "升朝" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("行动力未满");
  });

  it("升朝 fires onHoldCourt exactly once even on double-click (no double AP spend)", async () => {
    const user = userEvent.setup();
    const onHoldCourt = vi.fn();
    render(<XuanzhengdianScreen {...base} onHoldCourt={onHoldCourt} />);
    await user.dblClick(screen.getByRole("button", { name: "升朝" }));
    expect(onHoldCourt).toHaveBeenCalledTimes(1);
  });

  it("返回 leaves the hall", async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn();
    render(<XuanzhengdianScreen {...base} onLeave={onLeave} />);
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe("XuanzhengdianScreen — result mode", () => {
  it("shows real resource + attitude deltas with signs", () => {
    render(
      <XuanzhengdianScreen
        {...base}
        summary={{
          resources: [
            { id: "nation.treasury", label: "国库", delta: 500, polarity: 1 },
            { id: "sovereign.prestige", label: "威望", delta: -3, polarity: 1 },
          ],
          attitudes: [{ id: "lu_huaijin", label: "陆怀瑾", delta: 7, polarity: 1 }],
          empty: false,
        }}
      />,
    );
    expect(screen.getByText("朝议已毕")).toBeInTheDocument();
    expect(screen.getByText("国库")).toBeInTheDocument();
    expect(screen.getByText("+500")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
    expect(screen.getByText("陆怀瑾")).toBeInTheDocument();
    expect(screen.getByText("+7")).toBeInTheDocument();
  });

  it("empty summary → 'no change' message, nothing fabricated", () => {
    render(<XuanzhengdianScreen {...base} summary={{ resources: [], attitudes: [], empty: true }} />);
    expect(screen.getByText("朝议平和，诸事无大起落。")).toBeInTheDocument();
    expect(screen.queryByText(/国库|威望/)).toBeNull();
  });

  it("result actions return to hall or to map", async () => {
    const user = userEvent.setup();
    const onBackToHall = vi.fn();
    const onBackToMap = vi.fn();
    render(
      <XuanzhengdianScreen {...base} summary={{ resources: [], attitudes: [], empty: true }} onBackToHall={onBackToHall} onBackToMap={onBackToMap} />,
    );
    await user.click(screen.getByRole("button", { name: "返回宣政殿" }));
    await user.click(screen.getByRole("button", { name: "返回地图" }));
    expect(onBackToHall).toHaveBeenCalledTimes(1);
    expect(onBackToMap).toHaveBeenCalledTimes(1);
  });
});
