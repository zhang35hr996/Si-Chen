/**
 * PR3 必修缺陷（寝殿侧）：宫室住客此刻外出时——
 *  - 宫室槽保留姓名 + 明确「外出」状态；
 *  - 主体不显示侍君本人立绘，不显示对话/侍寝等针对在场人物的快捷操作；
 *  - 由宫人禀报真实去向（立绘明确标注为宫人，不让玩家误认侍君本人仍在寝殿）。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { CharacterScene } from "../../src/ui/screens/CharacterScene";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });
const consort = db.characters.lu_huaijin!; // 住 zhongcui_gong（设宫室）
const location = db.locations.zhongcui_gong!;

function render_away() {
  const state: GameState = createNewGameState(db);
  return render(
    <CharacterScene
      db={db}
      state={state}
      registry={registry}
      location={location}
      consorts={[consort]}
      absence={{ lu_huaijin: "yuhuayuan" }}
      onConverse={() => {}}
      onBedchamber={() => {}}
      onViewProfile={() => {}}
      onManage={() => {}}
      onRelocate={() => {}}
    />,
  );
}

describe("bedchamber occupant away → residence slot keeps name + 外出, no portrait/interaction", () => {
  it("the chamber slot shows the occupant name AND a 外出 status", () => {
    const { container } = render_away();
    expect(screen.getByText(consort.profile.name)).toBeInTheDocument();
    expect(container.querySelector(".char-scene__chip-away")).toHaveTextContent("外出");
    expect(container.querySelector(".char-scene__chip.is-away")).not.toBeNull();
  });

  it("does NOT show the consort's own portrait, and shows a 宫人 report instead", () => {
    render_away();
    // her own portrait is not shown (the sprite alt is the 宫人, not the consort)
    expect(screen.queryByRole("img", { name: consort.profile.name })).toBeNull();
    // an away report line is shown (御花园 destination)
    expect(screen.getByText(/御花园/)).toBeInTheDocument();
  });

  it("does NOT offer 对话 / 侍寝 for an away occupant", () => {
    render_away();
    expect(screen.queryByRole("button", { name: "对话" })).toBeNull();
    expect(screen.queryByRole("button", { name: "侍寝" })).toBeNull();
  });
});
