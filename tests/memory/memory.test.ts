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
  const runner = new SceneRunner(db, { provider: mockProvider });
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
    const shen = listMemories(state, "lu_huaijin");
    expect(shen).toHaveLength(2);
    expect(shen[1]?.summary).toContain("不可窥伺帝踪");

    // 皇后 and 司礼女官 were absent: still only their authored seed
    expect(listMemories(state, "shen_zhibai")).toHaveLength(1);
    expect(listMemories(state, "shen_zhibai")[0]?.ownerId).toBe("shen_zhibai");
    expect(listMemories(state, "wei_sui")).toHaveLength(1);
  });

  it("different choices leave different memories (divergent POV per branch)", async () => {
    const comforted = startedStore();
    await playNeglect(comforted, "c_comfort");
    const cold = startedStore();
    await playNeglect(cold, "c_cold");

    const a = listMemories(comforted.getState(), "lu_huaijin")[1]!;
    const b = listMemories(cold.getState(), "lu_huaijin")[1]!;
    expect(a.summary).not.toBe(b.summary);
    expect(a.summary).toContain("疏忽了我");
  });
});

describe("origin trace (acceptance: source + writing scene)", () => {
  it("entries carry ownerId; origin label reflects sourceEventId or default", async () => {
    const store = startedStore();
    await playNeglect(store, "c_brush");

    const [seed, written] = listMemories(store.getState(), "lu_huaijin");
    expect(seed?.ownerId).toBe("lu_huaijin");
    expect(seed?.sourceEventId).toBeUndefined();
    expect(memoryOriginLabel(seed!)).toBe("授定/直写");

    expect(written?.ownerId).toBe("lu_huaijin");
    expect(written?.sourceEventId).toBeUndefined(); // scene runner doesn't set sourceEventId by default
    expect(memoryOriginLabel(written!)).toBe("授定/直写");

    // direct effect batch (debug panel path)
    store.applyEffects(db, [
      {
        type: "memory",
        char: "shen_zhibai",
        entry: { kind: "impression", summary: "调试写入。", strength: 5, retention: "fast", subjectIds: ["player"], perspective: "witness", triggerTags: ["debug"], unresolved: false, emotions: {} },
      },
    ]);
    const direct = listMemories(store.getState(), "shen_zhibai")[1]!;
    expect(direct.sourceEventId).toBeUndefined();
    expect(memoryOriginLabel(direct)).toBe("授定/直写");
  });
});

describe("inspection helpers", () => {
  it("per-character isolation, overview counts, and permanentCount", () => {
    const state = createNewGameState(db);
    expect(listMemories(state, "char_ghost")).toEqual([]);
    const overview = memoryOverview(state)
      .filter((o) => !o.charId.startsWith("generated_consort"))
      .sort((a, b) => a.charId.localeCompare(b.charId));
    expect(overview).toEqual([
      { charId: "cheng_feng", count: 0, permanentCount: 0 },
      { charId: "lu_huaijin", count: 1, permanentCount: 1 },
      { charId: "shen_zhibai", count: 1, permanentCount: 1 },
      { charId: "taihou", count: 0, permanentCount: 0 },
      { charId: "wei_sui", count: 1, permanentCount: 1 },
      { charId: "wenya", count: 1, permanentCount: 0 },
      { charId: "xu_qinghuan", count: 1, permanentCount: 1 },
      { charId: "zhuchi", count: 0, permanentCount: 0 },
    ]);
  });

  it("memoryAgeDays counts action-days, clamped at 0", () => {
    const state = createNewGameState(db);
    const entry = listMemories(state, "shen_zhibai")[0]!;
    expect(memoryAgeDays(entry, { year: 1, month: 1, period: "early", dayIndex: 0 })).toBe(0);
    expect(memoryAgeDays(entry, { year: 1, month: 2, period: "mid", dayIndex: 4 })).toBe(4);
    expect(memoryAgeDays(entry, { year: 2, month: 1, period: "early", dayIndex: 36 })).toBe(36);
  });
});
