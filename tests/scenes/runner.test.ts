import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import type { SceneContent } from "../../src/engine/content/schemas";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import { SceneRunner, type RunnerStep } from "../../src/engine/scenes/runner";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createLogger } from "../../src/engine/infra/logger";
import { createGameStore } from "../../src/store/gameStore";
import type { GameState } from "../../src/engine/state/types";
import type { GameError } from "../../src/engine/infra/errors";
import type { Result } from "../../src/engine/infra/result";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const fresh = (): GameState => createNewGameState(db);

const unwrap = (r: Result<RunnerStep, GameError>): RunnerStep => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const asFrame = (s: RunnerStep) => {
  if (s.kind !== "frame") throw new Error("expected frame");
  return s.frame;
};

describe("SceneRunner walkthrough (sc_shen_neglect, through the provider seam)", () => {
  it("start → intro line with 3 choices → effects accumulate → closing line → end batch", async () => {
    const runner = new SceneRunner(db, mockProvider);
    const state = fresh();

    const first = asFrame(unwrap(await runner.start(state, "ev_shen_neglect")));
    expect(first.awaiting).toBe("choice");
    expect(first.line.speakerId).toBe("lu_huaijin");
    expect(first.line.speakerName).toBe("陆承徽");
    // v0 ships only the shared "neutral" portrait per kind, so the scene's
    // authored expression ("frown") normalizes to neutral (orchestrator fallback).
    // Add per-expression art back to a character's `expressions` to restore it.
    expect(first.line.expression).toBe("neutral");
    expect(first.line.meta).toEqual({ generated: false, degraded: false });
    expect(first.line.choices.map((c) => c.id)).toEqual(["c_comfort", "c_brush", "c_cold"]);

    // mid-scene: session holds the reservation, GameState untouched
    expect(runner.getSession()?.reservedApCost).toBe(1);
    expect(runner.getSession()?.pendingEffects).toEqual([]);
    expect(state.calendar.ap).toBe(6);

    const second = asFrame(unwrap(await runner.advance("c_comfort")));
    expect(second.awaiting).toBe("continue"); // closing line, effects pending
    expect(second.line.expression).toBe("neutral"); // "smile" normalizes — v0 ships neutral only
    expect(runner.getSession()?.pendingEffects).toHaveLength(3);
    expect(state.calendar.ap).toBe(6); // STILL untouched

    const end = unwrap(await runner.advance());
    expect(end.kind).toBe("end");
    if (end.kind !== "end") return;
    expect(end.eventId).toBe("ev_shen_neglect");
    expect(end.effects).toHaveLength(3);
    expect(state.calendar.ap).toBe(6); // runner NEVER touches state — caller commits
  });

  it("invalid choice id is rejected without advancing", async () => {
    const runner = new SceneRunner(db, mockProvider);
    unwrap(await runner.start(fresh(), "ev_shen_neglect"));
    const bad = await runner.advance("c_ghost");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("BAD_CHOICE");
    const retry = await runner.advance("c_brush"); // session still alive
    expect(retry.ok).toBe(true);
  });

  it("start enforces affordability engine-side (行动点不足, no rollover) and once", async () => {
    const runner = new SceneRunner(db, mockProvider);
    const base = fresh();
    const broke: GameState = { ...base, calendar: { ...base.calendar, ap: 0 } };
    const blocked = await runner.start(broke, "ev_menses_rite"); // costs 1
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("AP_INSUFFICIENT");
    expect(broke.calendar.ap).toBe(0); // time did not advance

    const fired: GameState = {
      ...base,
      eventLog: [{ eventId: "ev_shen_neglect", firedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } }],
    };
    const again = await runner.start(fired, "ev_shen_neglect");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("EVENT_ALREADY_FIRED");
  });
});

describe("quit drill (acceptance §13 #6)", () => {
  it("abandon mid-scene: store state deep-equal incl. AP, once unconsumed, re-entry replays", async () => {
    const store = createGameStore({ logger: createLogger({ now: () => 0 }) });
    store.newGame(db);
    const before = store.getState();
    const snapshot = structuredClone(before);

    const runner = new SceneRunner(db, mockProvider);
    unwrap(await runner.start(store.getState(), "ev_shen_neglect"));
    unwrap(await runner.advance("c_cold")); // effects accumulated in session
    runner.abandon();

    expect(store.getState()).toBe(before); // same reference — nothing dispatched
    expect(store.getState()).toEqual(snapshot); // and deep-equal, AP included
    expect(runner.getSession()).toBeNull();

    // re-entry replays identically
    const replay = asFrame(unwrap(await runner.start(store.getState(), "ev_shen_neglect")));
    expect(replay.line.choices).toHaveLength(3);
  });

  it("full commit path through the store: effects + AP + fired + sceneHistory land together", async () => {
    const store = createGameStore({ logger: createLogger({ now: () => 0 }) });
    store.newGame(db);
    const runner = new SceneRunner(db, mockProvider);

    unwrap(await runner.start(store.getState(), "ev_shen_neglect"));
    unwrap(await runner.advance("c_comfort"));
    const end = unwrap(await runner.advance());
    if (end.kind !== "end") throw new Error("expected end");

    const commit = store.resolveEvent(db, end.eventId, end.effects);
    expect(commit.ok).toBe(true);
    const state = store.getState();
    expect(state.relationships["lu_huaijin"]).toMatchObject({ affinity: 49, trust: 27 });
    expect(state.memories["lu_huaijin"]?.entries).toHaveLength(2);
    expect(state.calendar.ap).toBe(5); // apCost spent at commit, not at entry
    expect(state.sceneHistory).toEqual(["sc_shen_neglect"]);
  });
});

describe("graph semantics (synthetic scenes)", () => {
  const sceneDb = (scene: SceneContent): ContentDB =>
    ({
      ...db,
      events: {
        ev_t: { id: "ev_t", title: "测试", sceneId: scene.id, checkpoint: "location_enter", condition: { atLocation: "zichendian" }, priority: 1, once: false, apCost: 0 },
      },
      scenes: { [scene.id]: scene },
    }) as ContentDB;

  it("branch routes on PRE-scene state — pending flags are invisible mid-scene", async () => {
    const scene: SceneContent = {
      id: "sc_t",
      locationId: "zichendian",
      participants: ["wei_sui"],
      startNodeId: "n_fx",
      nodes: [
        { type: "effect", id: "n_fx", effects: [{ type: "flag", key: "mid_flag", value: true }], next: "n_br" },
        { type: "branch", id: "n_br", condition: { flagSet: "mid_flag" }, ifTrue: "n_yes", ifFalse: "n_no" },
        { type: "line", id: "n_yes", speaker: "wei_sui", text: "看见了旗标。" },
        { type: "line", id: "n_no", speaker: "wei_sui", text: "未见旗标。" },
      ],
    };
    const runner = new SceneRunner(sceneDb(scene), mockProvider);
    const frame = asFrame(unwrap(await runner.start(fresh(), "ev_t")));
    expect(frame.line.text).toBe("未见旗标。"); // pending effect not visible to the branch
  });

  it("choice conditions filter visibility against pre-scene state", async () => {
    const scene: SceneContent = {
      id: "sc_t",
      locationId: "zichendian",
      participants: ["wei_sui"],
      startNodeId: "n_l",
      nodes: [
        { type: "line", id: "n_l", speaker: "wei_sui", text: "请示。", next: "n_c" },
        {
          type: "choice",
          id: "n_c",
          choices: [
            { id: "c_open", text: "总是可见", next: "n_end" },
            { id: "c_locked", text: "需要旗标", condition: { flagSet: "ghost" }, next: "n_end" },
          ],
        },
        { type: "line", id: "n_end", speaker: "wei_sui", text: "遵旨。" },
      ],
    };
    const runner = new SceneRunner(sceneDb(scene), mockProvider);
    const frame = asFrame(unwrap(await runner.start(fresh(), "ev_t")));
    expect(frame.line.choices.map((c) => c.id)).toEqual(["c_open"]); // locked one hidden
    const picked = await runner.advance("c_locked"); // picking the hidden one fails
    expect(picked.ok).toBe(false);
  });

  it("effect-node cycle trips the loop guard and discards the session", async () => {
    const scene: SceneContent = {
      id: "sc_t",
      locationId: "zichendian",
      participants: ["wei_sui"],
      startNodeId: "n_a",
      nodes: [
        { type: "effect", id: "n_a", effects: [{ type: "flag", key: "k", value: 1 }], next: "n_b" },
        { type: "effect", id: "n_b", effects: [{ type: "flag", key: "k", value: 2 }], next: "n_a" },
      ],
    };
    const runner = new SceneRunner(sceneDb(scene), mockProvider);
    const result = await runner.start(fresh(), "ev_t");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SCENE_LOOP");
    expect(runner.getSession()).toBeNull(); // backstop discards — no AP, no effects
  });
});
