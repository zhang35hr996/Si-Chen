/**
 * Memory v0 (skeleton-plan §7): written / stored / inspected — never driving
 * AI or gameplay logic. The subjectivity assertion from §11 lives here.
 */
import { describe, expect, it } from "vitest";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import {
  listMemories,
  memoryAgeDays,
  memoryOriginLabel,
  memoryOverview,
} from "../../src/engine/memory/inspect";
import { SceneRunner } from "../../src/engine/scenes/runner";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createLogger } from "../../src/engine/infra/logger";
import { createGameStore, type GameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

const startedStore = (): GameStore => {
  const store = createGameStore({ logger: createLogger({ now: () => 0 }) });
  store.newGame(db);
  return store;
};

/** Play ev_shen_neglect to completion through the real runner + commit. */
async function playNeglect(store: GameStore, choiceId: string): Promise<void> {
  const runner = new SceneRunner(db, mockProvider);
  const first = await runner.start(store.getState(), "ev_shen_neglect");
  if (!first.ok) throw new Error(first.error.message);
  const second = await runner.advance(choiceId);
  if (!second.ok) throw new Error(second.error.message);
  const end = await runner.advance();
  if (!end.ok) throw new Error(end.error.message);
  if (end.value.kind !== "end") throw new Error("expected end");
  const commit = store.resolveEvent(db, end.value.eventId, end.value.effects);
  if (!commit.ok) throw new Error(commit.error.map((e) => e.message).join("; "));
}

describe("subjectivity (acceptance §13 #8)", () => {
  it("one event writes to the witness only — absent characters learn nothing", async () => {
    const store = startedStore();
    await playNeglect(store, "c_cold");
    const state = store.getState();

    // 沈承徽 (present, rebuked) remembers it — her own POV wording
    const shen = listMemories(state, "shen_chenghui");
    expect(shen).toHaveLength(2);
    expect(shen[1]?.summary).toContain("斥我放肆");

    // 凤后 and 司礼女官 were absent: still only their authored seed
    expect(listMemories(state, "feng_hou")).toHaveLength(1);
    expect(listMemories(state, "feng_hou")[0]?.source).toBe("authored");
    expect(listMemories(state, "sili_nvguan")).toHaveLength(1);
  });

  it("different choices leave different memories (divergent POV per branch)", async () => {
    const comforted = startedStore();
    await playNeglect(comforted, "c_comfort");
    const cold = startedStore();
    await playNeglect(cold, "c_cold");

    const a = listMemories(comforted.getState(), "shen_chenghui")[1]!;
    const b = listMemories(cold.getState(), "shen_chenghui")[1]!;
    expect(a.summary).not.toBe(b.summary);
    expect(a.summary).toContain("疏忽了我");
  });
});

describe("origin trace (acceptance: source + writing scene)", () => {
  it("scene-committed entries carry originSceneId; authored seeds and debug batches do not", async () => {
    const store = startedStore();
    await playNeglect(store, "c_brush");

    const [seed, written] = listMemories(store.getState(), "shen_chenghui");
    expect(seed?.source).toBe("authored");
    expect(seed?.originSceneId).toBeUndefined();
    expect(memoryOriginLabel(seed!)).toBe("授定背景");

    expect(written?.source).toBe("scene_outcome");
    expect(written?.originSceneId).toBe("sc_shen_neglect");
    expect(memoryOriginLabel(written!)).toBe("场景 sc_shen_neglect");

    // direct effect batch (debug panel path) — no scene to blame
    store.applyEffects(db, [
      {
        type: "memory",
        char: "feng_hou",
        entry: { kind: "opinion", summary: "调试写入。", salience: 5, tags: ["debug"], participants: ["player"] },
      },
    ]);
    const direct = listMemories(store.getState(), "feng_hou")[1]!;
    expect(direct.originSceneId).toBeUndefined();
    expect(memoryOriginLabel(direct)).toBe("效果批");
  });
});

describe("inspection helpers", () => {
  it("per-character isolation, overview counts, and protected flags", () => {
    const state = createNewGameState(db);
    expect(listMemories(state, "char_ghost")).toEqual([]);
    const overview = memoryOverview(state).sort((a, b) => a.charId.localeCompare(b.charId));
    expect(overview).toEqual([
      { charId: "chu_jun", count: 1, protectedCount: 1 },
      { charId: "feng_hou", count: 1, protectedCount: 1 },
      { charId: "shen_chenghui", count: 1, protectedCount: 1 },
      { charId: "sili_nvguan", count: 1, protectedCount: 1 },
      { charId: "taihou", count: 0, protectedCount: 0 },
      { charId: "wenya_shijun", count: 1, protectedCount: 1 },
    ]);
  });

  it("memoryAgeDays counts action-days, clamped at 0", () => {
    const state = createNewGameState(db);
    const entry = listMemories(state, "feng_hou")[0]!;
    expect(memoryAgeDays(entry, { year: 1, month: 1, period: "early", dayIndex: 0 })).toBe(0);
    expect(memoryAgeDays(entry, { year: 1, month: 2, period: "mid", dayIndex: 4 })).toBe(4);
    expect(memoryAgeDays(entry, { year: 2, month: 1, period: "early", dayIndex: 36 })).toBe(36);
  });
});
