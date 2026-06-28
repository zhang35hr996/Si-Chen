/**
 * 殿选落库的原子性（review 第四轮 F1）：玩家多选 + NPC 留牌整批全成或全不成；委托流程把
 * pending/flag/侍君落库放在同一事务；任一冲突 state/flag/pending 不变且不 emit；成功只 emit 一次。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { generateCandidates, type Candidate } from "../../src/store/grandSelection";
import { daxuanDianxuanFlagKey } from "../../src/store/grandSelection";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** 取一个良家子候选（无母族，落库简单可控）。 */
function liangjiazi(state: GameState): Candidate {
  for (const year of [1, 4, 7, 10]) {
    const c = generateCandidates(db, state, year).find((x) => !x.motherOfficialId);
    if (c) return c;
  }
  throw new Error("no 良家子 candidate");
}

/** 同 id、不同 content 的候选（用于触发 batch 第二人冲突）。 */
function clashing(c: Candidate): Candidate {
  return { ...c, content: { ...c.content, profile: { ...c.content.profile, name: "冲突改名" } } };
}

function storeWithDianxuanPending(year: number): { store: GameStore; emits: () => number } {
  const s = createNewGameState(db, 1);
  s.pendingDaxuan = { kind: "dianxuan", year };
  const store = new GameStore();
  store.loadState(s);
  let count = 0;
  store.subscribe(() => { count += 1; });
  return { store, emits: () => count };
}

describe("commitDaxuanSelections — 玩家多选原子", () => {
  it("第二人冲突 → 三人均不落库、不 emit", () => {
    const s = createNewGameState(db, 1);
    const initialConsortCount = Object.keys(s.generatedConsorts).length;
    const store = new GameStore();
    store.loadState(s);
    let emits = 0;
    store.subscribe(() => { emits += 1; });

    const c1 = liangjiazi(s);
    const c3 = liangjiazi(s); // 同一年同一候选集，取同一个无妨——关键在第二人冲突
    const kept = [
      { candidate: c1, rank: "guiren" },
      { candidate: clashing(c1), rank: "changzai" }, // 同 id 不同 content → 冲突
      { candidate: c3, rank: "guiren" },
    ];
    const r = store.commitDaxuanSelections(db, kept);
    expect(r.ok).toBe(false);
    expect(Object.keys(store.getState().generatedConsorts)).toHaveLength(initialConsortCount);
    expect(emits).toBe(0);
  });

  it("成功路径整批落库且只 emit 一次", () => {
    const s = createNewGameState(db, 1);
    const store = new GameStore();
    store.loadState(s);
    let emits = 0;
    store.subscribe(() => { emits += 1; });

    const c1 = liangjiazi(s);
    const r = store.commitDaxuanSelections(db, [{ candidate: c1, rank: "guiren" }]);
    expect(r.ok).toBe(true);
    expect(store.getState().generatedConsorts[c1.content.id]).toBeDefined();
    expect(emits).toBe(1);
  });

  it("早退场 NPC 冲突时玩家选择也不部分提交", () => {
    const s = createNewGameState(db, 1);
    const store = new GameStore();
    store.loadState(s);
    const player = liangjiazi(s);
    const npcConflict = clashing(player); // NPC 留牌与玩家撞 id
    const r = store.commitDaxuanSelections(db, [
      { candidate: player, rank: "guiren" },
      { candidate: npcConflict, rank: "guiren" },
    ]);
    expect(r.ok).toBe(false);
    expect(store.getState().generatedConsorts[player.content.id]).toBeUndefined();
  });
});

describe("resolveDaxuanByDelegate — 委托原子事务", () => {
  it("第二人冲突 → pending/flag/侍君集合全部不变、不 emit", () => {
    const year = 1;
    const { store, emits } = storeWithDianxuanPending(year);
    const initialConsortCount = Object.keys(store.getState().generatedConsorts).length;
    const c1 = liangjiazi(store.getState());
    const kept = [
      { candidate: c1, rank: "guiren" },
      { candidate: clashing(c1), rank: "guiren" },
    ];
    const r = store.resolveDaxuanByDelegate(db, year, kept);
    expect(r.ok).toBe(false);
    const st = store.getState();
    expect(st.pendingDaxuan).toEqual({ kind: "dianxuan", year });
    expect(st.flags[daxuanDianxuanFlagKey(year)]).toBeUndefined();
    expect(Object.keys(st.generatedConsorts)).toHaveLength(initialConsortCount);
    expect(emits()).toBe(0);
  });

  it("无对应 pending → NO_PENDING_DAXUAN，不动 state", () => {
    const s = createNewGameState(db, 1); // 无 dianxuan pending
    const store = new GameStore();
    store.loadState(s);
    const r = store.resolveDaxuanByDelegate(db, 1, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NO_PENDING_DAXUAN");
  });

  it("成功路径：pending 清除、flag 置位、侍君落库，只 emit 一次", () => {
    const year = 1;
    const { store, emits } = storeWithDianxuanPending(year);
    const c1 = liangjiazi(store.getState());
    const r = store.resolveDaxuanByDelegate(db, year, [{ candidate: c1, rank: "guiren" }]);
    expect(r.ok).toBe(true);
    const st = store.getState();
    expect(st.pendingDaxuan).toBeUndefined();
    expect(st.flags[daxuanDianxuanFlagKey(year)]).toBe(true);
    expect(st.generatedConsorts[c1.content.id]).toBeDefined();
    expect(emits()).toBe(1);
  });
});
