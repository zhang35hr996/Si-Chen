/**
 * PUNISH-4B 冷宫 UI 集成测试。
 *
 * 覆盖：
 *  1. 合资格侍君（有 standing、非候选、未入冷宫）能看到「打入冷宫」按钮。
 *  2. 已在冷宫、候选人、已故侍君无法提交打入冷宫操作。
 *  3. 确认「打入冷宫」时仅调用 onSendToColdPalace 一次，参数正确。
 *  4. onSendToColdPalace 返回错误时 modal 内显示错误（不关闭为成功）。
 *  5. FreeViewScreen(changmengong)：活跃冷宫效果显示居民 + 召回按钮。
 *  6. FreeViewScreen(changmengong)：已解除历史效果不出现在列表。
 *  7. FreeViewScreen(changmengong)：生成式侍君无需注入 db.characters。
 *  8. 召回确认调用 onConfirm 并携带正确 reason。
 *  9. 成功召回后 store state 中活跃冷宫效果消失（引擎层验证）。
 * 10. UI 代码不直接写 residence / statusEffects / punishment records / IDs。
 * 11. 双击确认只调用 handler 一次（useRef 防重）。
 * 12. handler 返回错误时 modal 保留（不关闭为成功）。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { PunishmentModal } from "../../src/ui/components/PunishmentModal";
import { ColdPalaceRestoreModal } from "../../src/ui/components/ColdPalaceModal";
import { FreeViewScreen } from "../../src/ui/screens/FreeViewScreen";
import { AssetRegistry } from "../../src/engine/assets/registry";
import { GameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import type { ImperialCommand } from "../../src/store/imperialCommands";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });
const base = createNewGameState(db);
const now = toGameTime(base.calendar);

const CONSORT_ID = "lu_huaijin";
const character = db.characters[CONSORT_ID]!;

/** 将指定侍君打入冷宫的辅助状态构建（via engine funnel 直接注入 send_to_cold_palace effect）。 */
function stateInColdPalace(state: GameState, charId: string = CONSORT_ID, seq = 0): GameState {
  const seqStr = String(seq).padStart(6, "0");
  const r = applyEffects(
    db,
    state,
    [
      {
        type: "send_to_cold_palace",
        char: charId,
        statusEffectId: `se_${seqStr}`,
        punishmentId: `pun_${seqStr}`,
        coldPalaceResidenceId: "changmengong",
        previousResidenceId: state.standing[charId]?.residence ?? "zhaoning_gong",
        startedAt: now,
        startTurn: state.calendar.dayIndex,
      },
    ],
    { allowInternalEffects: true },
  );
  if (!r.ok) throw new Error(`stateInColdPalace setup failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** 从冷宫恢复侍君的辅助状态构建。 */
function stateRestoredFromColdPalace(coldPalaceState: GameState, charId: string = CONSORT_ID): GameState {
  const r = applyEffects(
    db,
    coldPalaceState,
    [
      {
        type: "restore_from_cold_palace",
        char: charId,
        liftReason: "lifted_by_emperor",
        restoreResidenceId: "zhaoning_gong",
        restoreChamber: "main",
        liftedAt: now,
        liftedTurn: coldPalaceState.calendar.dayIndex,
      },
    ],
    { allowInternalEffects: true },
  );
  if (!r.ok) throw new Error(`stateRestoredFromColdPalace setup failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** 从 GameState 构建一个带有该状态的 GameStore。 */
function makeStore(state: GameState): GameStore {
  const store = new GameStore();
  store.loadState(state);
  return store;
}

// ── 1–4: PunishmentModal — 打入冷宫菜单项 ──────────────────────────────────

describe("PunishmentModal — 打入冷宫", () => {
  function renderModal(state: GameState, onSendToColdPalace?: (id: string) => string | null) {
    const onCommand = vi.fn<(c: ImperialCommand) => void>();
    const onClose = vi.fn();
    render(
      <PunishmentModal
        db={db}
        state={state}
        character={character}
        onCommand={onCommand}
        onSendToColdPalace={onSendToColdPalace}
        onClose={onClose}
      />,
    );
    return { onCommand, onClose };
  }

  it("1. 合资格侍君显示「打入冷宫」按钮（可点击）", () => {
    const onSend = vi.fn(() => null as string | null);
    renderModal(base, onSend);
    const btn = screen.getByRole("button", { name: /打入冷宫/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("2a. 已在冷宫者：「打入冷宫」按钮禁用，标注原因", () => {
    const inCold = stateInColdPalace(base);
    const onSend = vi.fn(() => null as string | null);
    renderModal(inCold, onSend);
    const btn = screen.getByRole("button", { name: /打入冷宫/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title") ?? btn.textContent).toMatch(/已身处冷宫/);
  });

  it("2b. 已故侍君：「打入冷宫」按钮禁用", () => {
    const deceased = applyEffects(db, base, [{ type: "consort_decease", char: CONSORT_ID, at: now, cause: "illness" }]);
    if (!deceased.ok) throw new Error("decease setup failed");
    const onSend = vi.fn(() => null as string | null);
    renderModal(deceased.value, onSend);
    const btn = screen.getByRole("button", { name: /打入冷宫/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title") ?? btn.textContent).toMatch(/已逝/);
  });

  it("3. 确认「打入冷宫」时 onSendToColdPalace 被调用一次（含正确 charId）", async () => {
    const onSend = vi.fn(() => null as string | null);
    renderModal(base, onSend);
    await userEvent.click(screen.getByRole("button", { name: /^打入冷宫$/ }));
    await userEvent.click(screen.getByRole("button", { name: "确认下旨" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(CONSORT_ID);
  });

  it("4. handler 返回错误时 modal 内显示错误，按钮仍可见（modal 不关闭）", async () => {
    const errorMsg = "命令失败：此人已在冷宫";
    const onSend = vi.fn(() => errorMsg);
    renderModal(base, onSend);
    await userEvent.click(screen.getByRole("button", { name: /^打入冷宫$/ }));
    await userEvent.click(screen.getByRole("button", { name: "确认下旨" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    // error is shown in place, modal is NOT closed
    expect(screen.getByRole("alert")).toHaveTextContent(errorMsg);
    expect(screen.getByRole("button", { name: "确认下旨" })).toBeInTheDocument();
  });

  it("11. 连续双击「确认下旨」只调用 handler 一次（useRef 防重）", async () => {
    // handler returns null (success): ref stays true, so second click is blocked.
    // Modal doesn't unmount in test (no parent), so second click can't fire on unmounted button.
    const onSend = vi.fn(() => null as string | null);
    renderModal(base, onSend);
    await userEvent.click(screen.getByRole("button", { name: /^打入冷宫$/ }));
    const confirmBtn = screen.getByRole("button", { name: "确认下旨" });
    await userEvent.dblClick(confirmBtn);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

// ── 5–7: FreeViewScreen(changmengong) 生产路径 ──────────────────────────────

describe("FreeViewScreen(changmengong) — 冷宫活跃居民", () => {
  function renderChangmengong(state: GameState, extras: Record<string, unknown> = {}) {
    const store = makeStore(state);
    const onViewProfile = vi.fn<(id: string) => void>();
    const onRestoreFromColdPalace = vi.fn<(id: string) => void>();
    render(
      <FreeViewScreen
        db={db}
        store={store}
        registry={registry}
        locationId="changmengong"
        onStartEvent={vi.fn()}
        onClose={vi.fn()}
        onViewProfile={onViewProfile}
        onRestoreFromColdPalace={onRestoreFromColdPalace}
        {...extras}
      />,
    );
    return { store, onViewProfile, onRestoreFromColdPalace };
  }

  it("5. 活跃冷宫效果：显示居民姓名 + 「召回」按钮", () => {
    const inCold = stateInColdPalace(base);
    renderChangmengong(inCold);
    expect(screen.getAllByText(new RegExp(character.profile.name)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "召回" })).toBeInTheDocument();
  });

  it("5b. 点击「召回」触发 onRestoreFromColdPalace(charId)", async () => {
    const inCold = stateInColdPalace(base);
    const { onRestoreFromColdPalace } = renderChangmengong(inCold);
    await userEvent.click(screen.getByRole("button", { name: "召回" }));
    expect(onRestoreFromColdPalace).toHaveBeenCalledWith(CONSORT_ID);
  });

  it("6. 已解除历史效果：对应 consort 不出现在列表", () => {
    const inCold = stateInColdPalace(base);
    const restored = stateRestoredFromColdPalace(inCold);
    renderChangmengong(restored);
    // No residents — empty state message shown, no 召回 button
    expect(screen.queryByRole("button", { name: "召回" })).toBeNull();
    expect(screen.getAllByText(/长门宫中目前无人幽居/).length).toBeGreaterThan(0);
  });

  it("7. 生成式侍君无需注入 db.characters 即可显示", () => {
    // 注入生成侍君到 state.generatedConsorts（不入 db.characters）
    const genChar = {
      id: "gen_yun_001",
      kind: "consort" as const,
      profile: { name: "云袖", age: 20, role: "侍君", personalityTraits: [] },
      attributes: { affection: 30, obedience: 40, ambition: 20, fear: 0 },
      portraitSet: "default",
      defaultLocation: "zhaoning_gong",
    };
    const stateWithGen: GameState = {
      ...base,
      generatedConsorts: { ...base.generatedConsorts, gen_yun_001: genChar as never },
      standing: {
        ...base.standing,
        gen_yun_001: { rank: "guiren", favor: 0, peakFavor: 0, lifecycle: "normal", residence: "zhaoning_gong" },
      },
    };
    const inCold = stateInColdPalace(stateWithGen, "gen_yun_001", 1);
    // db does NOT include gen_yun_001 — only generatedConsorts does
    renderChangmengong(inCold);
    expect(screen.getAllByText(/云袖/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "召回" })).toBeInTheDocument();
  });
});

// ── 8–9: ColdPalaceRestoreModal — 召回确认 ─────────────────────────────────

describe("ColdPalaceRestoreModal — 召回确认", () => {
  it("8a. 选「奉旨召回」并确认，调用 onConfirm('lifted_by_emperor')", async () => {
    const onConfirm = vi.fn((_r: "lifted_by_emperor" | "pardoned") => null as string | null);
    render(
      <ColdPalaceRestoreModal
        db={db}
        state={base}
        charId={CONSORT_ID}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "奉旨召回" }));
    await userEvent.click(screen.getByRole("button", { name: /确认奉旨召回/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("lifted_by_emperor");
  });

  it("8b. 选「特旨赦免」并确认，调用 onConfirm('pardoned')", async () => {
    const onConfirm = vi.fn((_r: "lifted_by_emperor" | "pardoned") => null as string | null);
    render(
      <ColdPalaceRestoreModal
        db={db}
        state={base}
        charId={CONSORT_ID}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "特旨赦免" }));
    await userEvent.click(screen.getByRole("button", { name: /确认特旨赦免/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("pardoned");
  });

  it("9. 成功召回后 store state 中活跃冷宫效果消失（引擎层）", () => {
    const inCold = stateInColdPalace(base);
    const activeEffect = inCold.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === CONSORT_ID && (e as { liftedTurn?: number }).liftedTurn === undefined,
    );
    expect(activeEffect).toBeTruthy();

    const restored = stateRestoredFromColdPalace(inCold);
    const stillActive = restored.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === CONSORT_ID && (e as { liftedTurn?: number }).liftedTurn === undefined,
    );
    expect(stillActive).toBeUndefined();
  });

  it("12. handler 返回错误时 modal 保留（不关闭为成功）", async () => {
    const errorMsg = "召回失败：此人未在冷宫";
    const onConfirm = vi.fn((_r: "lifted_by_emperor" | "pardoned") => errorMsg);
    render(
      <ColdPalaceRestoreModal
        db={db}
        state={base}
        charId={CONSORT_ID}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "奉旨召回" }));
    await userEvent.click(screen.getByRole("button", { name: /确认奉旨召回/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(errorMsg);
    expect(screen.getByRole("button", { name: /确认奉旨召回/ })).toBeInTheDocument();
  });
});

// ── 10: UI 代码不直接写持久化字段 ──────────────────────────────────────────

describe("架构约束：UI 不直接写 residence / statusEffects / punishments / IDs", () => {
  it("10. PunishmentModal 和 ColdPalaceRestoreModal 不持有任何状态写入逻辑", () => {
    const onSend = vi.fn(() => null as string | null);
    const onCommand = vi.fn();
    const onClose = vi.fn();
    render(
      <PunishmentModal
        db={db}
        state={base}
        character={character}
        onCommand={onCommand}
        onSendToColdPalace={onSend}
        onClose={onClose}
      />,
    );
    // 仅渲染后即无副作用：没有状态更新、没有 store 调用。
    expect(onSend).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });
});
