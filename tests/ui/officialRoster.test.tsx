import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OfficialRoster } from "../../src/ui/officials/OfficialRoster";
import { OfficialDetail } from "../../src/ui/officials/OfficialDetail";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
// shen_zhibai is now event_only; inject her so OfficialDetail shows her as Shen family palace kin
const state = withConsort(createNewGameState(db, 1), db, "shen_zhibai");

const SHEN_HEAD = "official_fam_shen_main";
const headName = (id: string) => `${state.officials[id]!.surname}${state.officials[id]!.givenName}`;

describe("OfficialRoster", () => {
  it("renders generated officials grouped, showing name + post", () => {
    render(<OfficialRoster db={db} state={state} onSelect={() => {}} />);
    expect(screen.getByText(headName(SHEN_HEAD))).toBeInTheDocument();
    expect(screen.getByText(/官员名册/)).toBeInTheDocument();
  });

  it("shows a 宫中亲 badge for a family with palace consorts", () => {
    render(<OfficialRoster db={db} state={state} onSelect={() => {}} />);
    expect(screen.getAllByText(/宫中亲/).length).toBeGreaterThan(0);
  });

  it("clicking an official row invokes onSelect with its id", async () => {
    const onSelect = vi.fn();
    render(<OfficialRoster db={db} state={state} onSelect={onSelect} />);
    await userEvent.click(screen.getByText(headName(SHEN_HEAD)));
    expect(onSelect).toHaveBeenCalledWith(SHEN_HEAD);
  });

  it("renders an explicit empty state when there are no officials", () => {
    render(<OfficialRoster db={db} state={{ ...state, officials: {} }} onSelect={() => {}} />);
    expect(screen.getByText(/朝中暂无在册官员/)).toBeInTheDocument();
  });
});

describe("OfficialDetail", () => {
  it("shows family + palace consort kin for a linked official", () => {
    render(<OfficialDetail db={db} state={state} officialId={SHEN_HEAD} onBack={() => {}} />);
    expect(screen.getByText(/沈氏/)).toBeInTheDocument();
    expect(screen.getByText(state.generatedConsorts["shen_zhibai"]!.profile.name)).toBeInTheDocument();
  });

  it("shows an empty-kin state for an official whose family has no palace consorts", () => {
    // 无关联填充家族（fam_gen_*）必无宫中侍君。
    render(<OfficialDetail db={db} state={state} officialId="official_fam_gen_0001" onBack={() => {}} />);
    expect(screen.getByText(/族中无人入宫为侍/)).toBeInTheDocument();
  });

  it("back button invokes onBack", async () => {
    const onBack = vi.fn();
    render(<OfficialDetail db={db} state={state} officialId={SHEN_HEAD} onBack={onBack} />);
    await userEvent.click(screen.getByText(/返回名册/));
    expect(onBack).toHaveBeenCalled();
  });
});
