/**
 * BedchamberPicker 呈现模式（Task 2.4b Blocker 3）：default=翻牌子（侍寝），summon=召见侍君（叙话/临场）。
 * 仅标题随模式变化；选人筛选（inPalaceConsorts + canSummon）与选中回调语义不变。侍寝门槛（canBedchamber）
 * 由各入口在 App 侧把关，不在本组件内。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import { inPalaceConsorts } from "../../src/engine/characters/presence";
import { canSummon } from "../../src/store/bedchamber";
import { createNewGameState } from "../../src/engine/state/newGame";
import { BedchamberPicker } from "../../src/ui/components/BedchamberPicker";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });
const state = createNewGameState(db);
const summonable = inPalaceConsorts(db, state).filter((c) => canSummon(state, c.id));

describe("BedchamberPicker presentation mode", () => {
  it("defaults to 翻牌子 (bedchamber)", () => {
    render(<BedchamberPicker db={db} state={state} registry={registry} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "翻牌子" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "召见侍君" })).toBeNull();
  });

  it("renders 召见侍君 in summon mode", () => {
    render(<BedchamberPicker db={db} state={state} registry={registry} mode="summon" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "召见侍君" })).toBeInTheDocument();
  });

  it("supplies the exact selected consort id on pick (selection semantics unchanged across modes)", async () => {
    expect(summonable.length).toBeGreaterThan(0); // fixture sanity
    const target = summonable[0]!;
    const onPick = vi.fn();
    render(<BedchamberPicker db={db} state={state} registry={registry} mode="summon" onPick={onPick} onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: new RegExp(target.profile.name) }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith(target.id);
  });
});
