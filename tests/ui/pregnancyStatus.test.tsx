/**
 * 孕情展示组件集成（display-only）。用真实 GestationState（含 conceivedAt）经各 UI 表面呈现精确孕月，
 * 不 mock gestationMonth。覆盖 chip / 顶栏 / GameShell 透传 / 人物卡 / 详情抽屉 / 侍君列表 / 后宫格 /
 * 跨屏一致（MapScreen 与某专用屏派生同一帝王孕月）。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import { makeGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createGameStore } from "../../src/store/gameStore";
import type { GameState, GestationState } from "../../src/engine/state/types";
import { GameShell } from "../../src/ui/components/GameShell";
import { TopStatusBar } from "../../src/ui/components/TopStatusBar";
import { PregnancyStatusChip } from "../../src/ui/components/PregnancyStatusChip";
import { CharacterCard } from "../../src/ui/components/CharacterCard";
import { CharacterProfileDrawer } from "../../src/ui/components/CharacterProfileDrawer";
import { ConsortListModal } from "../../src/ui/components/ConsortListModal";
import { HaremGrid } from "../../src/ui/screens/HaremGrid";
import { MapScreen } from "../../src/ui/screens/MapScreen";
import { YuqingGongScreen } from "../../src/ui/screens/YuqingGongScreen";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });
const consortId = Object.keys(db.characters).find((id) => db.characters[id]!.kind === "consort" && id !== "shen_zhibai")!;
const consort = db.characters[consortId]!;

const gest = (carrier: string, cy: number, cm: number): GestationState => ({ carrier, conceivedAt: makeGameTime(cy, cm, "early") });

/** state at year2 month5 with the given gestations (consort conceived y2m2 → 孕4月 unless overridden). */
function stateWith(gestations: GestationState[]): GameState {
  const base = withConsort(createNewGameState(db), db, consortId);
  return {
    ...base,
    calendar: { ...base.calendar, year: 2, month: 5 },
    resources: { ...base.resources, bloodline: { ...base.resources.bloodline, gestations } },
  };
}
const consortPreg = () => stateWith([gest(consortId, 2, 2)]); // 孕4月
const plain = () => stateWith([]);

describe("PregnancyStatusChip", () => {
  it("10. renders visible accessible text", () => {
    render(<PregnancyStatusChip label="承嗣君 · 孕3月" />);
    expect(screen.getByText("承嗣君 · 孕3月")).toBeInTheDocument();
  });
});

describe("TopStatusBar / GameShell emperor pregnancy", () => {
  const cal = plain().calendar;
  it("17. displays 怀胎 · 孕N月 when a month is supplied", () => {
    render(<TopStatusBar calendar={cal} pregnancyMonth={3} />);
    expect(screen.getByText("怀胎 · 孕3月")).toBeInTheDocument();
  });
  it("18. renders no pregnancy status when month is absent", () => {
    render(<TopStatusBar calendar={cal} />);
    expect(screen.queryByText(/怀胎/)).toBeNull();
  });
  it("19. GameShell forwards the month to TopStatusBar", () => {
    render(<GameShell calendar={cal} crumbs={["紫宸殿"]} pregnancyMonth={6}>x</GameShell>);
    expect(screen.getByText("怀胎 · 孕6月")).toBeInTheDocument();
  });
});

describe("consort detail surfaces", () => {
  it("15. CharacterCard shows the exact pregnancy month and no bare 怀胎", () => {
    render(<CharacterCard db={db} state={consortPreg()} registry={registry} character={consort} />);
    expect(screen.getByText("承嗣君 · 孕4月")).toBeInTheDocument();
    expect(screen.queryByText("承嗣君·怀胎")).toBeNull();
  });

  it("11 & 12. CharacterProfileDrawer shows the exact month, independent of health", async () => {
    const user = userEvent.setup();
    render(<CharacterProfileDrawer db={db} state={consortPreg()} character={consort} onClose={vi.fn()} />);
    expect(screen.getByText("承嗣君 · 孕4月")).toBeInTheDocument(); // overview field
    await user.click(screen.getByRole("button", { name: "属性" }));
    // body 身体 section: health and pregnancy both present and separate
    expect(screen.getByText("健康")).toBeInTheDocument();
    expect(screen.getByText("孕育")).toBeInTheDocument();
    expect(screen.getByText("承嗣君 · 孕4月")).toBeInTheDocument(); // body chip
  });

  it("13. a non-pregnant consort profile contains no pregnancy chip", () => {
    const { container } = render(<CharacterProfileDrawer db={db} state={plain()} character={consort} onClose={vi.fn()} />);
    expect(container.querySelector(".pregnancy-chip")).toBeNull();
    expect(screen.queryByText("孕育")).toBeNull();
  });

  it("14. ConsortListModal selected detail shows the exact pregnancy month", async () => {
    const { container } = render(
      <ConsortListModal
        db={db} state={consortPreg()} registry={registry} sovereignPregnant={false}
        initialSelectedId={consortId}
        onManage={vi.fn()} onRelocate={vi.fn()} onSummon={vi.fn()} onAddCandidate={vi.fn()} onRemoveCandidate={vi.fn()} onClose={vi.fn()}
      />,
    );
    const detail = container.querySelector(".consort-detail") as HTMLElement;
    expect(within(detail).getByText("承嗣君 · 孕4月")).toBeInTheDocument();
    expect(detail.querySelector(".health-chip")).not.toBeNull(); // health still shown, separate chip
    expect(detail.querySelector(".pregnancy-chip")).not.toBeNull();
  });
});

describe("HaremGrid pregnancy marker", () => {
  it("16. the 孕 marker title includes the real month", () => {
    // place the pregnant consort's residence on the board so she renders
    const state = consortPreg();
    const locations = Object.values(db.locations).filter((l) => l.zone === "hougong");
    const { container } = render(
      <HaremGrid db={db} state={state} locations={locations} selectedId={null} onSelect={vi.fn()} />,
    );
    const pregMarker = Array.from(container.querySelectorAll(".harem-status")).find((el) => el.textContent === "孕");
    expect(pregMarker).toBeTruthy();
    expect(pregMarker!.getAttribute("title")).toContain("孕4月");
  });
});

describe("cross-screen emperor pregnancy consistency", () => {
  it("20. MapScreen and a specialized screen derive the same sovereign month", () => {
    const store = createGameStore();
    store.loadState(stateWith([gest("sovereign", 2, 3)])); // 孕3月

    const map = render(
      <MapScreen
        db={db} store={store} registry={registry} atRoot
        onTravelled={vi.fn()} onEnterCurrent={vi.fn()} onOpenView={vi.fn()} onOpenSettings={vi.fn()}
        onClose={vi.fn()} onOpenCourtyard={vi.fn()} onEnterShop={vi.fn()}
      />,
    );
    expect(within(map.container).getByText("怀胎 · 孕3月")).toBeInTheDocument();
    map.unmount();

    const yuqing = render(
      <YuqingGongScreen db={db} store={store} registry={registry} onOpenMap={vi.fn()} onOpenSettings={vi.fn()} onSummon={vi.fn()} />,
    );
    expect(within(yuqing.container).getByText("怀胎 · 孕3月")).toBeInTheDocument();
  });
});
