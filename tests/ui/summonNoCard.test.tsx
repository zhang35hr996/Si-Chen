/**
 * 召见侍君临场（Task 2.4b §11）：被召见侍君以「立绘+名+位分」临场呈现，绝非 CharacterCard / 属性网格，
 * 且保留普通互动（叙话）与真实结束（告退）路径；告退后召见态清空、紫宸殿默认场景回归。
 * 用真实内容映射 summonedConsortToView 喂入 ZichendianScreen，验证组件契约与状态往返。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import type { GameState } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { ZichendianScreen, type ZichendianScreenProps } from "../../src/ui/screens/ZichendianScreen";
import { summonedConsortToView } from "../../src/ui/zichendianView";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });
const state: GameState = { ...createNewGameState(db), playerLocation: "zichendian" };
const consortId = Object.keys(db.characters).find((id) => db.characters[id]!.kind === "consort")!;
const consortName = db.characters[consortId]!.profile.name;

const baseProps: ZichendianScreenProps = {
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
};

describe("summoned consort presentation", () => {
  it("renders as portrait/presence — no CharacterCard, no stat grid, not a dialog", () => {
    const { container } = render(
      <ZichendianScreen {...baseProps} summonedConsort={summonedConsortToView(db, state, registry, consortId)} />,
    );
    const presence = container.querySelector(".zichendian-summoned");
    expect(presence).not.toBeNull();
    expect(within(presence as HTMLElement).getByRole("img", { name: consortName })).toBeInTheDocument();
    expect(screen.getByText(consortName)).toBeInTheDocument();
    expect(container.querySelector(".character-card")).toBeNull();
    expect(container.querySelector(".stat-grid")).toBeNull();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0); // presence is not a second dialog landmark
  });

  it("exposes the ordinary interaction (叙话) which routes to the converse callback", async () => {
    const user = userEvent.setup();
    const onConverseSummonedConsort = vi.fn();
    render(
      <ZichendianScreen
        {...baseProps}
        summonedConsort={summonedConsortToView(db, state, registry, consortId)}
        onConverseSummonedConsort={onConverseSummonedConsort}
        onDismissSummonedConsort={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "叙话" }));
    expect(onConverseSummonedConsort).toHaveBeenCalledTimes(1);
  });

  it("告退 clears the summoned state and the default Zichendian scene returns", async () => {
    const user = userEvent.setup();

    function SummonHarness() {
      const [summonedId, setSummonedId] = useState<string | null>(consortId);
      return (
        <ZichendianScreen
          {...baseProps}
          audienceCount={2}
          summonedConsort={summonedId ? summonedConsortToView(db, state, registry, summonedId) : undefined}
          onConverseSummonedConsort={summonedId ? vi.fn() : undefined}
          onDismissSummonedConsort={summonedId ? () => setSummonedId(null) : undefined}
        />
      );
    }

    const { container } = render(<SummonHarness />);
    expect(container.querySelector(".zichendian-summoned")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "告退" }));

    expect(container.querySelector(".zichendian-summoned")).toBeNull(); // presence cleared
    expect(screen.queryByRole("button", { name: "告退" })).toBeNull();
    expect(screen.getByText("候见之人 2")).toBeInTheDocument(); // default factual summary returns
  });

  it("omitting both summoned callbacks renders no interaction buttons", () => {
    render(<ZichendianScreen {...baseProps} summonedConsort={summonedConsortToView(db, state, registry, consortId)} />);
    expect(screen.queryByRole("button", { name: "叙话" })).toBeNull();
    expect(screen.queryByRole("button", { name: "告退" })).toBeNull();
  });
});
