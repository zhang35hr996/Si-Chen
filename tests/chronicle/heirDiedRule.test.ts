import { describe, expect, it } from "vitest";
import { executeCourtEvent } from "../../src/engine/chronicle/commit";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { firstNonEmpressConsortId, withConsort } from "../helpers/consortFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

function stateWithHeirAndFosterFather(db = loadRealContent()) {
  // Consorts are procedurally generated; inject a story consort to serve as foster father.
  let state = withConsort(createNewGameState(db), db, "lu_huaijin");
  for (const e of [{ type: "pregnancy", op: "begin" }, { type: "pregnancy", op: "carry" }] as EventEffect[]) {
    state = (applyEffects(db, state, [e]) as { value: typeof state }).value;
  }
  state = (applyEffects(db, state, [{ type: "birth", bearer: "sovereign", fatherId: null, sex: "daughter", legitimate: true, favor: 50, bearerOutcome: "safe" }]) as { value: typeof state }).value;
  const heirId = state.resources.bloodline.heirs[0]!.id;
  const fosterId = firstNonEmpressConsortId(db, state);
  return { db, state, heirId, fosterId };
}

describe("heir_died 规则", () => {
  it("worldEffects 标记皇嗣 deceased + 养父 permanent 创伤 + acute_grief（无需传 worldEffects）", () => {
    const { db, state, heirId, fosterId } = stateWithHeirAndFosterFather();
    const r = executeCourtEvent(db, state, {
      type: "heir_died", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: fosterId, role: "adoptive_father" }, { charId: heirId, role: "deceased" }],
      payload: { heirId },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 100, retention: "slow", tags: ["death", "heir"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.bloodline.heirs.find((h) => h.id === heirId)!.lifecycle).toBe("deceased");
    const mem = r.value.state.memories[fosterId]!.entries.at(-1)!;
    expect(mem.kind).toBe("trauma");
    expect(mem.retention).toBe("permanent");
    expect((mem.emotions.grief ?? 0)).toBeGreaterThan(50);
    expect(r.value.state.emotionalConditions.find((c) => c.ownerId === fosterId)!.type).toBe("acute_grief");
  });

  it("同一人兼养父+生父：仅一条创伤、一个 condition，guilt 取 max(=90)", () => {
    const { db, state, heirId, fosterId } = stateWithHeirAndFosterFather();
    const r = executeCourtEvent(db, state, {
      type: "heir_died", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: fosterId, role: "adoptive_father" }, { charId: fosterId, role: "birth_father" }, { charId: heirId, role: "deceased" }],
      payload: { heirId },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 100, retention: "slow", tags: ["death", "heir"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.memories[fosterId]!.entries.filter((m) => m.kind === "trauma")).toHaveLength(1);
    expect(r.value.state.emotionalConditions.filter((c) => c.ownerId === fosterId)).toHaveLength(1);
    expect(r.value.state.memories[fosterId]!.entries.at(-1)!.emotions.guilt).toBe(90);
  });

  it("已夭折皇嗣再 commit heir_died → validate 拒绝", () => {
    const { db, state, heirId, fosterId } = stateWithHeirAndFosterFather();
    const once = executeCourtEvent(db, state, {
      type: "heir_died", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: fosterId, role: "adoptive_father" }, { charId: heirId, role: "deceased" }],
      payload: { heirId }, publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 100, retention: "slow", tags: ["death"],
    });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const again = executeCourtEvent(db, once.value.state, {
      type: "heir_died", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: fosterId, role: "adoptive_father" }, { charId: heirId, role: "deceased" }],
      payload: { heirId }, publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 100, retention: "slow", tags: ["death"],
    });
    expect(again.ok).toBe(false);
  });

  it("executeCourtEvent 传 record_after 草稿（rank_changed）→ 返回 ok===false（mode 不匹配）", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const cId = firstNonEmpressConsortId(db, state);
    const r = executeCourtEvent(db, state, {
      type: "rank_changed", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: cId, role: "subject" }],
      payload: { from: state.standing[cId]!.rank, to: "meiren", direction: "demote" },
      publicity: { scope: "palace", persistence: "contemporaneous" },
      publicSalience: 60, retention: "slow", tags: ["demotion"],
    });
    expect(r.ok).toBe(false);
  });
});
