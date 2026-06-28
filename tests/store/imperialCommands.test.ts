import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { planImperialCommand } from "../../src/store/imperialCommands";
import { isConfined } from "../../src/engine/characters/confinement";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();

function freshStore() {
  const store = createGameStore();
  store.loadState(withConsort(createNewGameState(db), db, "lu_huaijin"));
  return store;
}

describe("consortGate 皇后例外", () => {
  const state = withConsort(createNewGameState(db), db, "xu_qinghuan");

  it("禁足令对皇后：缺 administrator 时被拒", () => {
    const r = planImperialCommand(db, state, { type: "impose_confinement", targetId: "shen_zhibai", durationTurns: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("皇后禁足须同时指定");
  });

  it("禁足令对皇后：提供合格 administrator 时通过", () => {
    const r = planImperialCommand(db, state, {
      type: "impose_confinement",
      targetId: "shen_zhibai",
      durationTurns: 3,
      administrator: { kind: "consort", charId: "xu_qinghuan" },
    });
    expect(r.ok).toBe(true);
  });

  it("赐死令对皇后也明确拒绝", () => {
    const r = planImperialCommand(db, state, { type: "execute", targetId: "shen_zhibai" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("皇后");
  });
});

describe("planImperialCommand 校验与组装", () => {
  const state = withConsort(createNewGameState(db), db, "lu_huaijin");

  it("禁足组装 confine + memory + 编年史草稿（startTurn=当前旬）", () => {
    const r = planImperialCommand(db, state, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const confine = r.plan.effects.find((e) => e.type === "confine");
    expect(confine).toMatchObject({ char: "lu_huaijin", startTurn: state.calendar.dayIndex, endTurnExclusive: state.calendar.dayIndex + 3 });
    expect(r.plan.chronicle[0]!.payload.decree).toBe("confinement_imposed");
  });

  it("已禁足时再下旨被拒（应改走解除/详情）", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 3 });
    const r = planImperialCommand(db, store.getState(), { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 9 });
    expect(r.ok).toBe(false);
  });

  it("解除禁足要求当前在禁足中", () => {
    const r = planImperialCommand(db, state, { type: "lift_confinement", targetId: "lu_huaijin" });
    expect(r.ok).toBe(false);
  });

  it("赐死组装 consort_decease + enqueue_aftermath（完整死亡管线）", () => {
    const r = planImperialCommand(db, state, { type: "execute", targetId: "lu_huaijin" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.effects.some((e) => e.type === "consort_decease")).toBe(true);
    const aftermath = r.plan.effects.find((e) => e.type === "enqueue_aftermath");
    expect(aftermath).toBeDefined();
    if (aftermath?.type === "enqueue_aftermath") {
      expect(aftermath.kind).toBe("consort");
      expect(aftermath.subjectId).toBe("lu_huaijin");
    }
  });

  it("非侍君 / 已故目标被拒", () => {
    const dead = createGameStore();
    dead.loadState(createNewGameState(db));
    dead.applyImperialCommand(db, { type: "execute", targetId: "lu_huaijin" });
    const r = planImperialCommand(db, dead.getState(), { type: "execute", targetId: "lu_huaijin" });
    expect(r.ok).toBe(false);
  });
});

describe("GameStore.applyImperialCommand — 单一入口（紫宸殿与侍君宫殿共用）", () => {
  it("禁足：原子应用效果 + append 编年史", () => {
    const store = freshStore();
    const before = store.getState().chronicle.length;
    const r = store.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 9 });
    expect(r.ok).toBe(true);
    expect(isConfined(store.getState(), "lu_huaijin")).toBe(true);
    expect(store.getState().chronicle.length).toBe(before + 1);
    expect(store.getState().chronicle.at(-1)!.payload.decree).toBe("confinement_imposed");
  });

  it("解除：当旬立即恢复资格，写解除史", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 9 });
    const r = store.applyImperialCommand(db, { type: "lift_confinement", targetId: "lu_huaijin" });
    expect(r.ok).toBe(true);
    expect(isConfined(store.getState(), "lu_huaijin")).toBe(false);
    expect(store.getState().chronicle.at(-1)!.payload.decree).toBe("confinement_lifted");
  });

  it("赐死走统一死亡管线：deceased + deathRecord + 移出候选 + 写赐死史", () => {
    const store = freshStore();
    const r = store.applyImperialCommand(db, { type: "execute", targetId: "lu_huaijin" });
    expect(r.ok).toBe(true);
    const st = store.getState().standing.lu_huaijin!;
    expect(st.lifecycle).toBe("deceased");
    expect(st.deathRecord?.cause).toBe("imperial_execution");
    const evt = store.getState().chronicle.at(-1)!;
    expect(evt.payload.decree).toBe("execution");
    expect(evt.payload.orderedBy).toBe("player");
    expect(evt.participants.some((p) => p.role === "executed")).toBe(true);
  });

  it("死亡角色实体与关系保留（不物理删除）", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "execute", targetId: "lu_huaijin" });
    expect(store.getState().standing.lu_huaijin).toBeDefined();
    expect(store.getState().memories.lu_huaijin).toBeDefined();
  });

  it("重复赐死不会重复执行（幂等被拒）", () => {
    const store = freshStore();
    expect(store.applyImperialCommand(db, { type: "execute", targetId: "lu_huaijin" }).ok).toBe(true);
    const before = store.getState().chronicle.length;
    expect(store.applyImperialCommand(db, { type: "execute", targetId: "lu_huaijin" }).ok).toBe(false);
    expect(store.getState().chronicle.length).toBe(before); // 无新增史
  });

  it("赐死清理活跃禁足与冲突安排", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: null });
    store.applyImperialCommand(db, { type: "execute", targetId: "lu_huaijin" });
    expect(isConfined(store.getState(), "lu_huaijin")).toBe(false);
  });
});
