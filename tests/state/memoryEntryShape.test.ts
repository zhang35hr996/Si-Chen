import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { listMemories } from "../../src/engine/memory/inspect";
import { loadRealContent } from "../helpers/contentFixture";

describe("MemoryEntry 新形状（端到端）", () => {
  it("memory 效果写出新形状条目，含 ownerId/strength/retention/triggerTags，通过 schema", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const charId = Object.keys(state.memories)[0]!;
    const r = applyEffects(db, state, [{
      type: "memory", char: charId,
      entry: {
        kind: "impression", summary: "侍身记下了一桩小事。", strength: 40, retention: "fast",
        subjectIds: ["player"], perspective: "witness", triggerTags: ["daily"], unresolved: false,
        emotions: { joy: 20 },
      },
    }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = listMemories(r.value, charId).at(-1)!;
    expect(m.ownerId).toBe(charId);
    expect(m.strength).toBe(40);
    expect(m.retention).toBe("fast");
    expect(m.triggerTags).toEqual(["daily"]);
    expect(m.subjectIds).toEqual(["player"]);
    expect(gameStateSchema.safeParse(r.value).success).toBe(true);
    expect((m as unknown as { salience?: number }).salience).toBeUndefined();
    expect((m as unknown as { protected?: boolean }).protected).toBeUndefined();
  });

  it("effect 可写 permanent 创伤（取消 v0 protected 禁令）", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const charId = Object.keys(state.memories)[0]!;
    const r = applyEffects(db, state, [{
      type: "memory", char: charId,
      entry: { kind: "trauma", summary: "怀中夭折。", strength: 100, retention: "permanent",
        subjectIds: ["heir_000007"], perspective: "parent", triggerTags: ["anniversary"], unresolved: true,
        emotions: { grief: 95, guilt: 90 } },
    }]);
    expect(r.ok).toBe(true);
  });
});
