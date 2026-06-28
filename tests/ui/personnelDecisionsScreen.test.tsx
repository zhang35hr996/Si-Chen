import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PersonnelDecisionsScreen } from "../../src/ui/officials/PersonnelDecisionsScreen";
import { personnelDecisionCard } from "../../src/ui/officials/personnelDecisionView";
import { GameStore } from "../../src/store/gameStore";
import {
  generateConsortPetition,
  generateFamilyImplication,
  generateMemorial,
} from "../../src/engine/officials/personnelDecisions";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";
import type { GameState, Official } from "../../src/engine/state/types";
import type { PunishmentRecord } from "../../src/engine/justice/types";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const LU_CONSORT = "lu_huaijin";
const WEN_OFFICIAL = "official_fam_wen_main";
const NOW = toGameTime(createNewGameState(db, 1).calendar);

/** Base state that includes lu_huaijin in standing (required for consort-related decisions). */
function freshWithLu() {
  return withConsort(createNewGameState(db, 1), db, LU_CONSORT);
}

function withConsortPun(s: GameState): GameState {
  const rec: PunishmentRecord = {
    id: "pun_000001", targetId: LU_CONSORT, targetKind: "consort", actorId: "player", kind: "rank_demotion",
    severity: "severe", imposedAt: NOW, publicity: "palace", lifecycle: { status: "active" },
    details: { fromRankId: "rank_a", toRankId: "rank_b" },
  };
  return { ...s, justice: { ...s.justice, punishments: { pun_000001: rec }, nextSeq: { ...s.justice.nextSeq, punishment: 2 } } };
}
const tune = (s: GameState, id: string, p: Partial<Official["reviewState"]>): GameState => {
  const o = s.officials[id]!;
  return { ...s, officials: { ...s.officials, [id]: { ...o, reviewState: { ...o.reviewState, ...p } } } };
};

function mount(state: GameState) {
  const store = new GameStore();
  store.loadState(state);
  const onCommitted = vi.fn();
  render(<PersonnelDecisionsScreen db={db} store={store} onBack={() => {}} onCommitted={onCommitted} />);
  return { store, onCommitted };
}

describe("PersonnelDecisionsScreen — rendering", () => {
  it("shows an explicit empty state when there are no pending decisions", () => {
    mount(freshWithLu());
    expect(screen.getByText(/暂无待裁人事奏折/)).toBeInTheDocument();
  });

  it("renders a petition card with administrative tag and approve/reject options", () => {
    const g = generateConsortPetition(freshWithLu(), db, LU_CONSORT, NOW)!;
    mount(g.state);
    expect(screen.getByText(/侍君请托·擢拔亲族/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /准其所请·擢拔/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /回绝/ })).toBeEnabled();
    expect(screen.getByText(/不记为惩罚/)).toBeInTheDocument(); // 行政标签
  });

  it("renders implication card with punishment tag on demote/dismiss", () => {
    const s = withConsortPun(freshWithLu());
    const g = generateFamilyImplication(s, db, "pun_000001", NOW)!;
    mount(g.state);
    expect(screen.getByText(/获罪牵连/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /罪止其身·不牵连/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /牵连·免官/ })).toBeEnabled();
    expect(screen.getAllByText(/皇帝亲发惩戒/).length).toBeGreaterThan(0); // 惩戒标签
  });

  it("disables demote with a reason when no lower seat is available", () => {
    // 牵连决策但无低品空缺 → demote 选项禁用。
    const s = withConsortPun(freshWithLu());
    const g = generateFamilyImplication(s, db, "pun_000001", NOW)!;
    // 把建议席位塞满（占用 recommendedPostId）。
    const blocked = { ...g.state, officials: { ...g.state.officials, [WEN_OFFICIAL]: { ...g.state.officials[WEN_OFFICIAL]!, postId: g.decision.recommendedPostId! } } };
    mount(blocked);
    const demote = screen.getByRole("button", { name: /牵连·降职/ });
    expect(demote).toBeDisabled();
  });
});

describe("PersonnelDecisionsScreen — resolution", () => {
  it("approving a petition resolves it, calls onCommitted, and removes the card", async () => {
    const g = generateConsortPetition(freshWithLu(), db, LU_CONSORT, NOW)!;
    const { store, onCommitted } = mount(g.state);
    await userEvent.click(screen.getByRole("button", { name: /准其所请·擢拔/ }));
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(store.getState().personnelDecisions[g.decision.id]!.status).toBe("resolved");
    expect(screen.getByText(/已办妥/)).toBeInTheDocument();
    expect(screen.queryByText(/侍君请托·擢拔亲族/)).toBeNull(); // 卡片消失
  });

  it("approving a dismissal memorial routes through PUNISH (creates a record)", async () => {
    const s = tune(freshWithLu(), WEN_OFFICIAL, { underperformanceYears: 2 });
    const g = generateMemorial(s, db, WEN_OFFICIAL, "memorial_dismissal", NOW)!;
    const { store } = mount(g.state);
    await userEvent.click(screen.getByRole("button", { name: /准奏·免官/ }));
    const puns = Object.values(store.getState().justice.punishments);
    expect(puns.some((p) => p.kind === "official_dismissal")).toBe(true);
  });
});

describe("personnelDecisionCard — view model", () => {
  it("derives administrative tone for petition approve, punishment tone for demote", () => {
    const g = generateConsortPetition(freshWithLu(), db, LU_CONSORT, NOW)!;
    const card = personnelDecisionCard(db, g.state, g.decision);
    expect(card.options.find((o) => o.resolution === "approve")!.tone).toBe("administrative");
    expect(card.officialName).toContain("陆");
    expect(card.recommendedPostLabel).toBeDefined();

    const s = withConsortPun(freshWithLu());
    const imp = generateFamilyImplication(s, db, "pun_000001", NOW)!;
    const impCard = personnelDecisionCard(db, imp.state, imp.decision);
    expect(impCard.options.find((o) => o.resolution === "demote")!.tone).toBe("punishment");
    expect(impCard.options.find((o) => o.resolution === "dismiss")!.tone).toBe("punishment");
    expect(impCard.options.find((o) => o.resolution === "spare")!.tone).toBe("neutral");
  });
});

describe("regression — no free appointment UI", () => {
  it("the personnel screen never renders raw promote/demote/transfer/dismiss roster buttons", () => {
    const g = generateConsortPetition(freshWithLu(), db, LU_CONSORT, NOW)!;
    const { container } = (() => {
      const store = new GameStore();
      store.loadState(g.state);
      return render(<PersonnelDecisionsScreen db={db} store={store} onBack={() => {}} onCommitted={() => {}} />);
    })();
    const list = within(container);
    // 不应出现名册式自由任免文案（升职/调任/免职 作为独立按钮）。
    expect(list.queryByRole("button", { name: /^调任/ })).toBeNull();
    expect(list.queryByRole("button", { name: /^免职$/ })).toBeNull();
  });
});
