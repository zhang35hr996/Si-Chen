import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ZichendianScreen, type ZichendianScreenProps } from "../../src/ui/screens/ZichendianScreen";
import type { PendingAudienceViewItem } from "../../src/ui/components/PendingAudienceDrawer";

const audience: ZichendianScreenProps["activeAudience"] = {
  eventId: "ev_a",
  visitorName: "卫绥",
  visitorTitle: "礼官",
  message: "礼官卫绥候见，为传月祭仪请示。",
  affordable: true,
};

const pendingItems: PendingAudienceViewItem[] = [
  { eventId: "ev_p1", visitorName: "沈砚", message: "户部奏报。", status: "pending", affordable: true },
];

function makeProps(overrides: Partial<ZichendianScreenProps> = {}): ZichendianScreenProps {
  return {
    background: "/bg/zichendian.png",
    audienceCount: 0,
    deferredAudienceCount: 0,
    pendingAudienceItems: [],
    interruptible: true,
    onAdmitAudience: vi.fn(),
    onDeferAudience: vi.fn(),
    onAdmitPendingAudience: vi.fn(),
    onReviewMemorials: vi.fn(),
    onSummonConsort: vi.fn(),
    onRest: vi.fn(),
    onLeave: vi.fn(),
    onManageRank: vi.fn(),
    onRelocate: vi.fn(),
    onBestow: vi.fn(),
    onPhysician: vi.fn(),
    ...overrides,
  };
}

const dialogs = () => screen.queryAllByRole("dialog");
const action = (name: string | RegExp) => screen.getByRole("button", { name });

describe("ZichendianScreen — idle / default state", () => {
  it("1. renders a SceneShell with the six screen actions", () => {
    render(<ZichendianScreen {...makeProps()} />);
    expect(screen.getByRole("region", { name: "紫宸殿" })).toBeInTheDocument();
    expect(action("批阅奏折")).toBeInTheDocument();
    expect(action("召见侍君")).toBeInTheDocument();
    expect(action("传乘风")).toBeInTheDocument();
    expect(action("休息")).toBeInTheDocument();
    expect(action("离开")).toBeInTheDocument();
    expect(action(/^待宣/)).toBeInTheDocument();
  });

  it("2. renders no CharacterCard", () => {
    const { container } = render(<ZichendianScreen {...makeProps()} />);
    expect(container.querySelector(".character-card")).toBeNull();
  });

  it("3. renders no dialog when no active audience exists", () => {
    render(<ZichendianScreen {...makeProps()} />);
    expect(dialogs()).toHaveLength(0);
  });

  it("4. summary shows the exact supplied audience count", () => {
    render(<ZichendianScreen {...makeProps({ audienceCount: 3 })} />);
    expect(screen.getByText("候见之人 3")).toBeInTheDocument();
  });

  it("5. shows a memorial capability label, not a fabricated number", () => {
    render(<ZichendianScreen {...makeProps()} />);
    expect(screen.getByText("可批阅奏折")).toBeInTheDocument();
    expect(screen.queryByText(/待批奏折/)).toBeNull();
    expect(screen.queryByText(/奏折\s*[:：]\s*\d/)).toBeNull();
  });

  it("23. merely rendering invokes no callback", () => {
    const props = makeProps();
    render(<ZichendianScreen {...props} />);
    for (const fn of [
      props.onAdmitAudience, props.onDeferAudience, props.onAdmitPendingAudience,
      props.onReviewMemorials, props.onSummonConsort, props.onRest, props.onLeave,
      props.onManageRank, props.onRelocate, props.onBestow, props.onPhysician,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("ZichendianScreen — active audience", () => {
  it("6. active audience renders exactly one AudiencePrompt dialog", () => {
    render(<ZichendianScreen {...makeProps({ activeAudience: audience })} />);
    const dlgs = dialogs();
    expect(dlgs).toHaveLength(1);
    expect(dlgs[0]).toHaveTextContent("卫绥");
  });

  it("7. audience admit emits the exact event ID", async () => {
    const user = userEvent.setup();
    const onAdmitAudience = vi.fn();
    render(<ZichendianScreen {...makeProps({ activeAudience: audience, onAdmitAudience })} />);
    await user.click(screen.getByRole("button", { name: "宣进来" }));
    expect(onAdmitAudience).toHaveBeenCalledExactlyOnceWith("ev_a");
  });

  it("8. audience defer emits the exact event ID", async () => {
    const user = userEvent.setup();
    const onDeferAudience = vi.fn();
    render(<ZichendianScreen {...makeProps({ activeAudience: audience, onDeferAudience })} />);
    await user.click(screen.getByRole("button", { name: "记入待宣" }));
    expect(onDeferAudience).toHaveBeenCalledExactlyOnceWith("ev_a");
  });
});

describe("ZichendianScreen — pending drawer foreground", () => {
  it("9 & 10. opening the pending drawer unmounts AudiencePrompt and is the only dialog", async () => {
    const user = userEvent.setup();
    render(<ZichendianScreen {...makeProps({ activeAudience: audience, deferredAudienceCount: 1, pendingAudienceItems: pendingItems })} />);
    expect(screen.getByRole("button", { name: "宣进来" })).toBeInTheDocument();
    await user.click(action(/^待宣/));
    const dlgs = dialogs();
    expect(dlgs).toHaveLength(1);
    expect(dlgs[0]).toHaveAccessibleName("待宣事务");
    expect(screen.queryByRole("button", { name: "宣进来" })).toBeNull(); // AudiencePrompt admit gone
  });

  it("11. closing the pending drawer returns to AudiencePrompt when still supplied", async () => {
    const user = userEvent.setup();
    render(<ZichendianScreen {...makeProps({ activeAudience: audience, pendingAudienceItems: pendingItems })} />);
    await user.click(action(/^待宣/));
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(dialogs()).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("卫绥"); // back to AudiencePrompt
  });

  it("12. pending count zero still opens an empty drawer", async () => {
    const user = userEvent.setup();
    render(<ZichendianScreen {...makeProps({ deferredAudienceCount: 0, pendingAudienceItems: [] })} />);
    await user.click(action(/^待宣/));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("待宣事务");
    expect(screen.getByText("当前无待宣事务")).toBeInTheDocument();
  });

  it("18. pending item selection emits its exact event ID exactly once", async () => {
    const user = userEvent.setup();
    const onAdmitPendingAudience = vi.fn();
    render(<ZichendianScreen {...makeProps({ pendingAudienceItems: pendingItems, deferredAudienceCount: 1, onAdmitPendingAudience })} />);
    await user.click(action(/^待宣/));
    await user.click(screen.getByRole("button", { name: "宣进来：沈砚" }));
    expect(onAdmitPendingAudience).toHaveBeenCalledExactlyOnceWith("ev_p1");
  });

  it("drawer close calls no audience mutation callback", async () => {
    const user = userEvent.setup();
    const onAdmitPendingAudience = vi.fn();
    const onDeferAudience = vi.fn();
    render(<ZichendianScreen {...makeProps({ pendingAudienceItems: pendingItems, onAdmitPendingAudience, onDeferAudience })} />);
    await user.click(action(/^待宣/));
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onAdmitPendingAudience).not.toHaveBeenCalled();
    expect(onDeferAudience).not.toHaveBeenCalled();
  });
});

describe("ZichendianScreen — Chengfeng foreground & handoff", () => {
  it("13 & 14. opening Chengfeng unmounts AudiencePrompt and is the only dialog", async () => {
    const user = userEvent.setup();
    render(<ZichendianScreen {...makeProps({ activeAudience: audience })} />);
    await user.click(action("传乘风"));
    const dlgs = dialogs();
    expect(dlgs).toHaveLength(1);
    expect(dlgs[0]).toHaveAccessibleName("传乘风");
    expect(screen.queryByRole("button", { name: "记入待宣" })).toBeNull(); // AudiencePrompt gone
  });

  it("15. closing Chengfeng returns to AudiencePrompt when still supplied", async () => {
    const user = userEvent.setup();
    render(<ZichendianScreen {...makeProps({ activeAudience: audience })} />);
    await user.click(action("传乘风"));
    await user.click(screen.getByRole("button", { name: "作罢" }));
    expect(dialogs()).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("卫绥");
  });

  it("16. a Chengfeng decree closes its menu and emits only its matching callback", async () => {
    const user = userEvent.setup();
    const props = makeProps({ activeAudience: audience });
    render(<ZichendianScreen {...props} />);
    await user.click(action("传乘风"));
    await user.click(screen.getByRole("button", { name: "调整位分" }));
    expect(props.onManageRank).toHaveBeenCalledTimes(1);
    expect(props.onRelocate).not.toHaveBeenCalled();
    expect(props.onBestow).not.toHaveBeenCalled();
    expect(props.onPhysician).not.toHaveBeenCalled();
    // menu closed → AudiencePrompt visible again (still supplied)
    expect(screen.getByRole("dialog")).toHaveTextContent("卫绥");
    expect(screen.queryByRole("button", { name: "调整位分" })).toBeNull();
  });

  it("Chengfeng close calls no business callback", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ZichendianScreen {...props} />);
    await user.click(action("传乘风"));
    await user.click(screen.getByRole("button", { name: "作罢" }));
    for (const fn of [props.onManageRank, props.onRelocate, props.onBestow, props.onPhysician, props.onSummonConsort]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("21. a disabled Chengfeng trigger cannot open the menu and exposes its reason", async () => {
    const user = userEvent.setup();
    render(<ZichendianScreen {...makeProps({ interruptible: false, interruptDisabledReason: "陛下正料理要务" })} />);
    const trigger = action("传乘风");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAccessibleDescription("陛下正料理要务");
    await user.click(trigger);
    expect(dialogs()).toHaveLength(0); // never opened
  });
});

describe("ZichendianScreen — single-dialog invariant", () => {
  it("17. no state ever exposes more than one dialog", async () => {
    const user = userEvent.setup();
    render(<ZichendianScreen {...makeProps({ activeAudience: audience, deferredAudienceCount: 1, pendingAudienceItems: pendingItems })} />);
    expect(dialogs().length).toBeLessThanOrEqual(1); // audience only
    await user.click(action(/^待宣/));
    expect(dialogs().length).toBeLessThanOrEqual(1); // drawer only
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(dialogs().length).toBeLessThanOrEqual(1); // back to audience
    await user.click(action("传乘风"));
    expect(dialogs().length).toBeLessThanOrEqual(1); // chengfeng only
    await user.click(screen.getByRole("button", { name: "作罢" }));
    expect(dialogs().length).toBeLessThanOrEqual(1); // back to audience
  });
});

describe("ZichendianScreen — summoned consort presentation", () => {
  it("19. summoned consort renders as portrait/presence, not a CharacterCard or stat grid", () => {
    const { container } = render(
      <ZichendianScreen
        {...makeProps({
          summonedConsort: { characterId: "c1", name: "苏蘅", role: "婕妤", portraitSrc: "/p/suheng.png" },
        })}
      />,
    );
    const presence = container.querySelector(".zichendian-summoned");
    expect(presence).not.toBeNull();
    expect(within(presence as HTMLElement).getByRole("img", { name: "苏蘅" })).toBeInTheDocument();
    expect(screen.getByText("苏蘅")).toBeInTheDocument();
    expect(screen.getByText("婕妤")).toBeInTheDocument();
    expect(container.querySelector(".character-card")).toBeNull();
    expect(container.querySelector(".stat-grid")).toBeNull();
    expect(dialogs()).toHaveLength(0); // presence is not a second dialog landmark
  });
});

describe("ZichendianScreen — busy & per-action routing", () => {
  it("20. busy disables conflicting screen actions", () => {
    render(<ZichendianScreen {...makeProps({ busy: true })} />);
    expect(action("批阅奏折")).toBeDisabled();
    expect(action("召见侍君")).toBeDisabled();
    expect(action("传乘风")).toBeDisabled();
    expect(action("休息")).toBeDisabled();
    expect(action(/^待宣/)).toBeDisabled();
  });

  it("22. memorial / summon / rest / leave each call only their own callback", async () => {
    const user = userEvent.setup();
    for (const [label, key] of [
      ["批阅奏折", "onReviewMemorials"],
      ["召见侍君", "onSummonConsort"],
      ["休息", "onRest"],
      ["离开", "onLeave"],
    ] as const) {
      const props = makeProps();
      const { unmount } = render(<ZichendianScreen {...props} />);
      await user.click(action(label));
      expect(props[key]).toHaveBeenCalledTimes(1);
      for (const other of ["onReviewMemorials", "onSummonConsort", "onRest", "onLeave"] as const) {
        if (other !== key) expect(props[other]).not.toHaveBeenCalled();
      }
      unmount();
    }
  });
});
