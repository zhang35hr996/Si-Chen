import { describe, expect, it } from "vitest";
import { recordCourtEvent } from "../../src/engine/chronicle/commit";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("recordCourtEvent + residence_changed（record_after）", () => {
  it("迁居：前后住处一致才通过 + 为搬入者建 fast impression 记忆", () => {
    const db = loadRealContent();
    const before = createNewGameState(db);
    const mover = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    before.standing[mover.id]!.residence = "qixiagong";
    const after = structuredClone(before);
    after.standing[mover.id]!.residence = "xianfu_palace"; // 上游 relocate 已发生
    const r = recordCourtEvent(db, before, after, {
      type: "residence_changed", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: mover.id, role: "mover" }],
      locationId: "xianfu_palace", payload: { from: "qixiagong", to: "xianfu_palace" },
      publicity: { scope: "palace", persistence: "contemporaneous" },
      publicSalience: 40, retention: "fast", tags: ["residence"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mem = r.value.state.memories[mover.id]!.entries.at(-1)!;
    expect(mem.kind).toBe("impression");
    expect(mem.retention).toBe("fast");
    expect(mem.sourceEventId).toBe(r.value.event.id);
    expect(mem.subjectIds).toContain(mover.id);
  });

  it("after 未真正迁居（after.residence !== to）→ validateTransition 拒绝", () => {
    const db = loadRealContent();
    const before = createNewGameState(db);
    const mover = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    before.standing[mover.id]!.residence = "qixiagong";
    const after = structuredClone(before); // 未迁
    const r = recordCourtEvent(db, before, after, {
      type: "residence_changed", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: mover.id, role: "mover" }],
      payload: { from: "qixiagong", to: "xianfu_palace" },
      publicity: { scope: "palace", persistence: "contemporaneous" },
      publicSalience: 40, retention: "fast", tags: ["residence"],
    });
    expect(r.ok).toBe(false);
    expect(after.chronicle).toHaveLength(0);
  });
});
