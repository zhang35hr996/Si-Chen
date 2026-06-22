import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { GameStore } from "../../src/store/gameStore";
import { planPhysicianVisit } from "../../src/store/physician";
import type { GameTime } from "../../src/engine/calendar/time";

const _content = loadGameContent();
if (!_content.ok) throw new Error("content failed to load");
const db = _content.value;

const at: GameTime = { year: 1, month: 1, period: "early", dayIndex: 0 };

// GameStore 构造接收 GameStoreOptions（非 GameState）；完整状态经 loadState 载入。
function freshStore() {
  const store = new GameStore();
  store.loadState(createNewGameState(db));
  return store;
}

describe("看诊事务（resolveTimedAction 整笔回滚）", () => {
  it("第一次看诊：加血、记录月键、扣 1 AP", () => {
    const store = freshStore();
    const before = store.getState();
    const apBefore = before.calendar.ap;
    const hpBefore = before.resources.sovereign.health;
    const plan = planPhysicianVisit(before, { kind: "sovereign" }, at)!;
    const r = store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    // TimedOutcome 只含 { rolledOver, monthChanged, healthOutcome }——状态变更读 getState()。
    const after = store.getState();
    expect(after.calendar.ap).toBe(apBefore - 1);
    expect(after.resources.sovereign.health).toBe(hpBefore + plan.actualHealing);
    expect(after.resources.sovereign.lastPhysicianVisitMonthKey).toBe("1:1");
  });

  it("同月对同一目标第二次（非法效果）：整笔失败，health/AP/calendar 不变", () => {
    const store = freshStore();
    const plan1 = planPhysicianVisit(store.getState(), { kind: "sovereign" }, at)!;
    const r1 = store.resolveTimedAction(db, plan1.effects, { type: "SPEND_AP", amount: 1 });
    expect(r1.ok).toBe(true);
    const snapshot = structuredClone(store.getState());
    const illegal = [
      { type: "set_sovereign_health", healthDelta: 9 } as const,
      { type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: "1:1" } as const,
    ];
    const r2 = store.resolveTimedAction(db, illegal, { type: "SPEND_AP", amount: 1 });
    expect(r2.ok).toBe(false); // record validate 拒绝（本月已请脉）
    const after = store.getState();
    expect(after.resources.sovereign.health).toBe(snapshot.resources.sovereign.health); // 未加 9
    expect(after.calendar).toEqual(snapshot.calendar); // AP/时间未动（整笔回滚）
  });

  it("planPhysicianVisit 对本月已看诊目标返回 null", () => {
    const store = freshStore();
    const plan1 = planPhysicianVisit(store.getState(), { kind: "sovereign" }, at)!;
    store.resolveTimedAction(db, plan1.effects, { type: "SPEND_AP", amount: 1 });
    expect(planPhysicianVisit(store.getState(), { kind: "sovereign" }, at)).toBeNull();
  });
});
