/**
 * PUNISH-4C: ColdPalaceIncidentModal rendering tests.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColdPalaceIncidentModal } from "../../src/ui/components/ColdPalaceIncidentModal";
import type { ColdPalaceIncident, GameState } from "../../src/engine/state/types";
import { createInitialState } from "../../src/engine/state/initialState";
import type { ContentDB } from "../../src/engine/content/loader";

// ── Minimal mock DB ──────────────────────────────────────────────────────────

function makeDb(overrides: Partial<ContentDB> = {}): ContentDB {
  return {
    characters: {
      consort_a: {
        id: "consort_a",
        kind: "consort",
        profile: { name: "芸儿", age: 20, role: "侍君", appearance: "清丽", personalityTraits: ["温柔"], reactionTraits: [], coreFacts: ["出身书香"], goals: ["侍君"], speechStyle: "温婉" },
        defaultLocation: "yanhe_gong",
        portraitSet: "default",
        expressions: ["neutral"],
        voice: { register: "formal", quirks: [], tabooTopics: [] },
        selfRefs: { toPlayer: ["陛下"], formal: ["臣妾"] },
        initialMemories: [],
        secrets: [],
      },
    },
    ranks: {
      jieyu: { id: "jieyu", name: "婕妤", aliases: [], deprecatedAliases: [], grade: "3a", selfRefs: { toPlayer: [], formal: [] }, order: 3, domain: "harem", favorTerm: "恩宠", deprecated: false },
    },
    locations: {},
    events: {},
    items: {},
    officialFamilyTemplates: [],
    ...overrides,
  } as unknown as ContentDB;
}

function makeState(): GameState {
  const s = createInitialState({ rngSeed: 1 });
  return {
    ...s,
    standing: {
      ...s.standing,
      consort_a: { rank: "jieyu", favor: 0, peakFavor: 0, loyalty: 60, affection: 50, fear: 10, health: 80 },
    },
    statusEffects: [
      {
        id: "se_000001",
        kind: "cold_palace" as const,
        characterId: "consort_a",
        startedAt: { year: 1, month: 1, period: "early" as const, dayIndex: 0 },
        startTurn: 0,
        previousResidenceId: "yanhe_gong",
        coldPalaceResidenceId: "changmengong",
        sourcePunishmentId: "pun_000001",
      },
    ],
  };
}

function makePetitionIncident(): ColdPalaceIncident {
  return {
    id: "cpi_consort_a_1_01",
    residentId: "consort_a",
    effectId: "se_000001",
    kind: "petition",
    occurredAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    acknowledged: false,
  };
}

function makeHealthIncident(): ColdPalaceIncident {
  return {
    id: "cpi_consort_a_1_02",
    residentId: "consort_a",
    effectId: "se_000001",
    kind: "health_deterioration",
    occurredAt: { year: 1, month: 2, period: "early", dayIndex: 0 },
    acknowledged: false,
    healthDelta: -7,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ColdPalaceIncidentModal — petition", () => {
  it("shows 长门宫通报 title", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    expect(screen.getByText("长门宫通报")).toBeInTheDocument();
  });

  it("shows resident name and incident title", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    expect(screen.getByText("上书陈情")).toBeInTheDocument();
    expect(screen.getByText("芸儿")).toBeInTheDocument();
  });

  it("shows 知道了 button", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "知道了" })).toBeInTheDocument();
  });

  it("calls onAcknowledge when 知道了 is clicked", async () => {
    const onAcknowledge = vi.fn();
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={onAcknowledge}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it("shows 前往长门宫 button when onNavigate is provided", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={vi.fn()}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "前往长门宫" })).toBeInTheDocument();
  });

  it("does not show 前往长门宫 button when onNavigate is absent", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "前往长门宫" })).not.toBeInTheDocument();
  });

  it("shows 召回 button when onRestore is provided", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={vi.fn()}
        onRestore={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "召回" })).toBeInTheDocument();
  });

  it("clicking 召回 calls both onAcknowledge and onRestore with charId", async () => {
    const onAcknowledge = vi.fn();
    const onRestore = vi.fn();
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={onAcknowledge}
        onRestore={onRestore}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "召回" }));
    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(onRestore).toHaveBeenCalledWith("consort_a");
  });

  it("clicking 前往长门宫 calls both onAcknowledge and onNavigate", async () => {
    const onAcknowledge = vi.fn();
    const onNavigate = vi.fn();
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={onAcknowledge}
        onNavigate={onNavigate}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "前往长门宫" }));
    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});

describe("ColdPalaceIncidentModal — health_deterioration", () => {
  it("shows 身体每况愈下 incident title", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makeHealthIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    expect(screen.getByText("身体每况愈下")).toBeInTheDocument();
  });

  it("shows health damage qualitative text in the description", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makeHealthIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    // Raw health number is not exposed; qualitative phrase appears instead
    expect(screen.getByText(/身体有所损伤/)).toBeInTheDocument();
  });

  it("shows resident rank", () => {
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makeHealthIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    expect(screen.getByText("婕妤")).toBeInTheDocument();
  });

  it("shows confinement duration when active effect is present", () => {
    // Active effect startedAt year:1 month:1; incident occurredAt year:1 month:2 → 1 month
    render(
      <ColdPalaceIncidentModal
        db={makeDb()}
        state={makeState()}
        incident={makeHealthIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    expect(screen.getByText(/幽居已/)).toBeInTheDocument();
  });
});

describe("ColdPalaceIncidentModal — unknown character fallback", () => {
  it("falls back to residentId when character not in db", () => {
    const db = makeDb({ characters: {} });
    render(
      <ColdPalaceIncidentModal
        db={db}
        state={makeState()}
        incident={makePetitionIncident()}
        onAcknowledge={vi.fn()}
      />
    );
    // Should show residentId as fallback
    expect(screen.getByText("consort_a")).toBeInTheDocument();
  });
});
