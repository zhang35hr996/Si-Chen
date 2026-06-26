/**
 * P1-A 集成测试：国库台账链在混合操作后保持完整
 * （奏折批阅 + 商店购买 + 存档/读档回路 + 第二次奏折批阅）。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { generateDisasterMemorial } from "../../src/engine/court/memorials";
import { validateTreasuryLedger } from "../../src/engine/court/treasuryLedger";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function storeWithTreasury(treasury: number): GameStore {
  const base = createNewGameState(db, 1);
  const state: GameState = {
    ...base,
    resources: { ...base.resources, nation: { ...base.resources.nation, treasury } },
  };
  const store = new GameStore();
  store.loadState(state);
  return store;
}

describe("P1-A: 台账链完整性 — 奏折批阅 → 商店购买 → 存档读档 → 再次奏折批阅", () => {
  it("三条混合条目后链路完整、validateTreasuryLedger 无错、存档读档通过", () => {
    const INITIAL_TREASURY = 10_000;
    const store = storeWithTreasury(INITIAL_TREASURY);
    const at = toGameTime(store.getState().calendar);

    // 1. 生成并批阅灾情奏折（relief 选项，cost -900）
    const gen1 = generateDisasterMemorial(store.getState(), "jiangnan", "major", at)!;
    store.loadState(gen1.state);
    const r1 = store.resolveMemorial(db, gen1.memorial.id, "relief");
    expect(r1.ok).toBe(true);
    expect(store.getState().treasuryLedger).toHaveLength(1);
    expect(store.getState().resources.nation.treasury).toBe(INITIAL_TREASURY - 900);
    expect(store.getState().treasuryLedger[0]!.source.kind).toBe("memorial");

    // 2. 商店购买 — 产生 shop_purchase 台账条目
    const bought = store.buyItem("luozidai", 100);
    expect(bought).toBe(true);
    expect(store.getState().treasuryLedger).toHaveLength(2);
    expect(store.getState().resources.nation.treasury).toBe(INITIAL_TREASURY - 900 - 100);

    const ledger1 = store.getState().treasuryLedger;
    expect(ledger1[0]!.source.kind).toBe("memorial");
    expect(ledger1[1]!.source.kind).toBe("shop_purchase");
    // 相邻链接
    expect(ledger1[0]!.balanceAfter).toBe(ledger1[1]!.balanceBefore);

    // 3. 批阅后台账无错
    expect(validateTreasuryLedger(store.getState())).toEqual([]);

    // 4. 存档/读档回路
    const storage = createMemoryStorage();
    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(validateTreasuryLedger(loaded.value.state)).toEqual([]);

    // 读档后重载 store
    store.loadState(loaded.value.state);

    // 5. 再生成并批阅第二条灾情奏折（另一地域+下一年，避免 sourceId 重复）
    const at2 = { ...at, year: at.year + 1 };
    const gen2 = generateDisasterMemorial(store.getState(), "hebei", "major", at2)!;
    store.loadState(gen2.state);
    const r2 = store.resolveMemorial(db, gen2.memorial.id, "relief");
    expect(r2.ok).toBe(true);
    expect(store.getState().treasuryLedger).toHaveLength(3);

    // 6. 完整链路校验
    const ledger2 = store.getState().treasuryLedger;
    expect(ledger2[0]!.balanceAfter).toBe(ledger2[1]!.balanceBefore);
    expect(ledger2[1]!.balanceAfter).toBe(ledger2[2]!.balanceBefore);
    expect(ledger2[2]!.balanceAfter).toBe(store.getState().resources.nation.treasury);
    expect(validateTreasuryLedger(store.getState())).toEqual([]);
  });

  it("buyItem 不足额时返回 false、台账不变", () => {
    const store = storeWithTreasury(50);
    const before = JSON.stringify(store.getState().treasuryLedger);
    const ok = store.buyItem("luozidai", 9_999);
    expect(ok).toBe(false);
    expect(JSON.stringify(store.getState().treasuryLedger)).toBe(before);
    expect(store.getState().resources.nation.treasury).toBe(50); // unchanged
  });
});
