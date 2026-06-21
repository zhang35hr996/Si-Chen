import { describe, expect, it } from "vitest";
import { recordCourtEvent } from "../../src/engine/chronicle/commit";
import { makeGameTime, toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { CourtEvent } from "../../src/engine/state/types";

function rankDraft(state: ReturnType<typeof createNewGameState>, subject: string, from: string, to: string, over: Partial<Omit<CourtEvent,"id">> = {}): Omit<CourtEvent,"id"> {
  return {
    type: "rank_changed", occurredAt: toGameTime(state.calendar),
    participants: [{ charId: subject, role: "subject" }],
    payload: { from, to, direction: "demote" },
    publicity: { scope: "palace", persistence: "contemporaneous" },
    publicSalience: 60, retention: "slow", tags: ["demotion"], ...over,
  };
}

function setup() {
  const db = loadRealContent();
  const before = createNewGameState(db);
  const c = Object.values(db.characters).find((x) => x.kind === "consort" && x.initialStanding && x.initialStanding.rank !== "fenghou")!;
  return { db, before, id: c.id, from: before.standing[c.id]!.rank };
}

describe("recordCourtEvent + rank_changed（record_after，前后态验证）", () => {
  it("降位：validateTransition 通过 + 落编年史 + 被降者 target grievance 记忆；入参不变", () => {
    const { db, before, id, from } = setup();
    const after = structuredClone(before);
    after.standing[id]!.rank = "meiren"; // 上游 set_rank 已发生
    const r = recordCourtEvent(db, before, after, rankDraft(after, id, from, "meiren"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.event.id).toBe("evt_000001");
    expect(after.chronicle).toHaveLength(0); // 入参不变
    const mem = r.value.state.memories[id]!.entries.at(-1)!;
    expect(mem.perspective).toBe("target");
    expect(mem.kind).toBe("grievance");
    expect(mem.unresolved).toBe(true);
    expect(mem.sourceEventId).toBe(r.value.event.id);
  });

  it("声称的 from 与 before 不符 → validateTransition 拒绝（终态一致不够）", () => {
    const { db, before, id } = setup();
    const after = structuredClone(before);
    after.standing[id]!.rank = "meiren";
    const r = recordCourtEvent(db, before, after, rankDraft(after, id, "__not_real_from__", "meiren"));
    expect(r.ok).toBe(false);
  });

  it("after 未真正改位分（after.rank !== to）→ 拒绝", () => {
    const { db, before, id, from } = setup();
    const after = structuredClone(before); // 未改
    const r = recordCourtEvent(db, before, after, rankDraft(after, id, from, "meiren"));
    expect(r.ok).toBe(false);
    expect(after.chronicle).toHaveLength(0);
  });

  it("未来事件 → err", () => {
    const { db, before, id, from } = setup();
    const after = structuredClone(before);
    after.standing[id]!.rank = "meiren";
    const r = recordCourtEvent(db, before, after, rankDraft(after, id, from, "meiren", { occurredAt: makeGameTime(5, 1, "early") }));
    expect(r.ok).toBe(false);
  });
});
