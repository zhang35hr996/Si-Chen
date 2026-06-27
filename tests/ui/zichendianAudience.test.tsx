/**
 * 紫宸殿候见接线集成（Task 2.4b）：用真实内容 + 合成候见事件，经 zichendianView 真实映射喂入 ZichendianScreen，
 * 验证「映射 → 组件」端到端：主动提示渲染、admit/defer 发出精确事件 ID、候见数 vs 待宣数区分、抽屉宣见精确 ID。
 * （App 装配本身无渲染基座，纯决策见 zichendianView.test.ts；本文件证明映射输出确实驱动组件。）
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameEventContent } from "../../src/engine/content/schemas";
import type { GameState } from "../../src/engine/state/types";
import {
  audienceCount,
  deferredAudienceCount,
  getAudienceQueue,
  getDeferredAudienceQueue,
} from "../../src/engine/events/audience";
import { createNewGameState } from "../../src/engine/state/newGame";
import { ZichendianScreen, type ZichendianScreenProps } from "../../src/ui/screens/ZichendianScreen";
import {
  audienceItemToPendingView,
  audienceItemToView,
  selectActiveAudience,
} from "../../src/ui/zichendianView";
import { loadRealContent } from "../helpers/contentFixture";

const real = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });

const mkEvent = (patch: Partial<GameEventContent>): GameEventContent =>
  ({
    id: "ev_a",
    title: "测试候见",
    sceneId: "sc_menses_rite",
    checkpoint: "location_enter",
    condition: { atLocation: "zichendian" },
    priority: 50,
    once: false,
    apCost: 1,
    presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "礼官候见，为月祭仪请示。" },
    ...patch,
  }) as GameEventContent;

const dbWith = (...events: GameEventContent[]): ContentDB =>
  ({ ...real, events: Object.fromEntries(events.map((e) => [e.id, e])) }) as ContentDB;

const freshAt = (db: ContentDB, flags: Record<string, unknown> = {}): GameState => ({
  ...createNewGameState(db),
  playerLocation: "zichendian",
  flags: flags as GameState["flags"],
});

/** Wire ZichendianScreen exactly as App does: real view-model mapping over (db, state). */
function wire(
  db: ContentDB,
  state: GameState,
  overrides: Partial<ZichendianScreenProps> = {},
): ZichendianScreenProps {
  const queue = getAudienceQueue(db, state, "zichendian");
  const deferredQueue = getDeferredAudienceQueue(db, state, "zichendian");
  const active = selectActiveAudience(queue);
  return {
    background: "/bg/zichendian.png",
    audienceCount: audienceCount(db, state, "zichendian"),
    deferredAudienceCount: deferredAudienceCount(db, state, "zichendian"),
    activeAudience: active ? audienceItemToView(db, state, registry, active) : undefined,
    pendingAudienceItems: deferredQueue.map((i) => audienceItemToPendingView(db, state, registry, i)),
    interruptible: true,
    onAdmitAudience: vi.fn(),
    onDeferAudience: vi.fn(),
    onAdmitPendingAudience: vi.fn(),
    onReviewMemorials: vi.fn(),
    onSummonConsort: vi.fn(),
    onRest: vi.fn(),
    onLeave: vi.fn(),
    onManageRank: vi.fn(),
    onBestow: vi.fn(),
    onPhysician: vi.fn(),
    ...overrides,
  };
}

describe("Zichendian audience wiring (mapping → component)", () => {
  it("renders the mapped active prompt (visitor name + message from the DB)", () => {
    const db = dbWith(mkEvent({ id: "ev_p" }));
    render(<ZichendianScreen {...wire(db, freshAt(db))} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(db.characters["wei_sui"]!.profile.name);
    expect(dialog).toHaveTextContent("为月祭仪请示");
  });

  it("admit emits the exact event id selected by the queue", async () => {
    const user = userEvent.setup();
    const db = dbWith(mkEvent({ id: "ev_p", priority: 90 }), mkEvent({ id: "ev_q", priority: 80, presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "shen_yan", audiencePrompt: "户部候见。" } }));
    const onAdmitAudience = vi.fn();
    render(<ZichendianScreen {...wire(db, freshAt(db), { onAdmitAudience })} />);
    await user.click(screen.getByRole("button", { name: "宣进来" }));
    expect(onAdmitAudience).toHaveBeenCalledExactlyOnceWith("ev_p"); // highest priority
  });

  it("defer emits the exact active event id", async () => {
    const user = userEvent.setup();
    const db = dbWith(mkEvent({ id: "ev_p" }));
    const onDeferAudience = vi.fn();
    render(<ZichendianScreen {...wire(db, freshAt(db), { onDeferAudience })} />);
    await user.click(screen.getByRole("button", { name: "记入待宣" }));
    expect(onDeferAudience).toHaveBeenCalledExactlyOnceWith("ev_p");
  });

  it("a brand-new available event shows 候见之人 1 / 待宣 · 0 and an empty drawer", async () => {
    const user = userEvent.setup();
    const db = dbWith(mkEvent({ id: "ev_p" }));
    render(<ZichendianScreen {...wire(db, freshAt(db))} />);
    expect(screen.getByText("候见之人 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^待宣/ })).toHaveTextContent("待宣 · 0");
    await user.click(screen.getByRole("button", { name: /^待宣/ }));
    expect(screen.getByText("当前无待宣事务")).toBeInTheDocument(); // available item never enters the drawer
  });

  it("a deferred (suppressed) event populates the drawer; drawer admit emits its exact id", async () => {
    const user = userEvent.setup();
    const db = dbWith(mkEvent({ id: "ev_p" }));
    // deferred but not yet at remind → suppressed → in the 待宣 drawer, not the active prompt
    const state = freshAt(db, { "audience:pending:ev_p": true, "audience:promptShownAt:ev_p": 1, "audience:remindAt:ev_p": 999 });
    const onAdmitPendingAudience = vi.fn();
    render(<ZichendianScreen {...wire(db, state, { onAdmitPendingAudience })} />);
    expect(screen.queryByRole("dialog")).toBeNull(); // suppressed item is not actively prompted
    expect(screen.getByRole("button", { name: /^待宣/ })).toHaveTextContent("待宣 · 1");
    await user.click(screen.getByRole("button", { name: /^待宣/ }));
    await user.click(screen.getByRole("button", { name: `宣进来：${db.characters["wei_sui"]!.profile.name}` }));
    expect(onAdmitPendingAudience).toHaveBeenCalledExactlyOnceWith("ev_p");
  });
});
