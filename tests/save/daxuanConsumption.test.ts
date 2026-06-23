/**
 * 持久化回归：消费大选日历事件后必须落盘，否则重载会重播 pending（announce 重弹 / dianxuan 重决）。
 * 用真实存档系统 autosave → loadWithRecovery 往返，检查「实际保存的状态」而非手搓对象的 schema 解析。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { autosave, loadWithRecovery } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createLogger } from "../../src/engine/infra/logger";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { daxuanAnnounceDue, daxuanAnnounceFlagKey } from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function freshStoreAt(month: number, period: "early" | "mid" | "late") {
  const store = new GameStore();
  store.newGame(db);
  const s = store.getState();
  store.loadState({
    ...s,
    calendar: { ...s.calendar, month, period, dayIndex: dayIndexOf(s.calendar.year, month, period), ap: s.calendar.apMax },
    pendingDaxuan: undefined,
  });
  return store;
}

const logger = createLogger({ now: () => 0 });

/** 推进越过节点 → 落盘（含 pending）→ 消费 → 再落盘 → 读回实际保存状态。 */
function consumeAnnounceAndReload(month: number, period: "early" | "mid" | "late") {
  const storage = createMemoryStorage();
  const store = freshStoreAt(month, period);
  store.advanceTime(db, { type: "SPEND_AP", amount: 1 }); // 越过节点 → pendingDaxuan=announce
  autosave(storage, db, store.getState(), { logger }); // 行动落盘：此时存档含 announce pending（重载会重播）
  const beats = store.consumeDaxuanAnnounce(db);
  autosave(storage, db, store.getState(), { logger }); // 消费后落盘（修复点）
  const loaded = loadWithRecovery(storage, db, { logger });
  if (!loaded.ok) throw new Error("reload failed");
  return { beats, saved: loaded.value.state };
}

describe("消费二月报告后落盘", () => {
  it("存档含 announce flag、且无 announce pending；重载不重播报告", () => {
    const { beats, saved } = consumeAnnounceAndReload(2, "early");
    expect(beats.length).toBeGreaterThan(0);
    expect(saved.flags[daxuanAnnounceFlagKey(1)]).toBe(true);
    expect(saved.pendingDaxuan?.kind).not.toBe("announce");
    // 重载后到期判定为假 → 不会再产生报告。
    expect(daxuanAnnounceDue(saved)).toBe(false);
  });

  it("跳过二月直到四月：存档含 announce flag、且 pending 为同年 dianxuan", () => {
    const { saved } = consumeAnnounceAndReload(4, "late");
    expect(saved.flags[daxuanAnnounceFlagKey(1)]).toBe(true);
    expect(saved.pendingDaxuan).toEqual({ kind: "dianxuan", year: 1 });
  });
});
