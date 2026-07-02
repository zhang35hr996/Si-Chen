import { describe, expect, it } from "vitest";
import { recordCourtEvent } from "../../src/engine/chronicle/commit";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

/** before=出生前（无嗣）；after=帝王自孕→生产后（有嗣）。applyEffects 不改入参，故 before 保持洁净。 */
function bornStates(db = loadRealContent()) {
  // Consorts are procedurally generated; inject a story consort to serve as birth father.
  const before = withConsort(createNewGameState(db), db, "lu_huaijin");
  let after = before;
  for (const e of [{ type: "pregnancy", op: "begin" }, { type: "pregnancy", op: "carry" }] as EventEffect[]) {
    after = (applyEffects(db, after, [e]) as { value: typeof after }).value;
  }
  after = (applyEffects(db, after, [{ type: "birth", bearer: "sovereign", fatherId: null, sex: "daughter", legitimate: true, favor: 50, bearerOutcome: "safe" }]) as { value: typeof after }).value;
  const father = before.generatedConsorts["lu_huaijin"]!;
  return { db, before, after, heirId: after.resources.bloodline.heirs[0]!.id, fatherId: father.id };
}

describe("recordCourtEvent + heir_born（record_after）", () => {
  it("生父 permanent 喜悦记忆；sovereign 跳过；before 无 heir、after 有", () => {
    const { db, before, after, heirId, fatherId } = bornStates();
    const r = recordCourtEvent(db, before, after, {
      type: "heir_born", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: fatherId, role: "birth_father" }, { charId: "player", role: "sovereign_parent" }, { charId: heirId, role: "newborn" }],
      payload: { heirId, birthOrder: 7 },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 85, retention: "slow", tags: ["birth"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mem = r.value.state.memories[fatherId]!.entries.at(-1)!;
    expect(mem.kind).toBe("episodic");
    expect(mem.retention).toBe("permanent");
    expect((mem.emotions.joy ?? 0)).toBeGreaterThan(0);
    expect(mem.subjectIds).toContain(heirId);
    expect(mem.sourceEventId).toBe(r.value.event.id);
    expect(r.value.state.memories["player"]).toBeUndefined();
  });

  it("同一人兼生父+养父：仅一条记忆（按 charId 去重）", () => {
    const { db, before, after, heirId, fatherId } = bornStates();
    const initialCount = after.memories[fatherId]!.entries.length;
    const r = recordCourtEvent(db, before, after, {
      type: "heir_born", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: fatherId, role: "birth_father" }, { charId: fatherId, role: "adoptive_father" }, { charId: heirId, role: "newborn" }],
      payload: { heirId },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 85, retention: "slow", tags: ["birth"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.memories[fatherId]!.entries).toHaveLength(initialCount + 1); // 不是 initialCount + 2（去重后仅加 1 条）
  });

  it("before 已含该 heir（非真正新生）→ validateTransition 拒绝", () => {
    const { db, after, heirId, fatherId } = bornStates();
    const r = recordCourtEvent(db, after, after, { // before===after：heir 已在 before
      type: "heir_born", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: fatherId, role: "birth_father" }, { charId: heirId, role: "newborn" }],
      payload: { heirId },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 85, retention: "slow", tags: ["birth"],
    });
    expect(r.ok).toBe(false);
  });
});
