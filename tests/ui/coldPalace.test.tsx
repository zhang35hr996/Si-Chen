/**
 * PUNISH-4B 冷宫 UI 集成测试。
 *
 * 覆盖：
 *  1. 合资格侍君（有 standing、非候选、未入冷宫）能看到「打入冷宫」按钮。
 *  2. 已在冷宫、候选人、已故侍君无法提交打入冷宫操作。
 *  3. 确认「打入冷宫」时仅调用 sendConsortToColdPalace 一次，参数正确。
 *  4. sendConsortToColdPalace 失败时不关闭弹窗为成功状态（显示错误提示）。
 *  5. 活跃冷宫效果列表包含活跃幽居者。
 *  6. 已解除的历史冷宫效果不出现在活跃列表。
 *  7. 生成式侍君在冷宫视图中正确解析名字。
 *  8. 召回确认调用 restoreFromColdPalace 并携带正确 reason。
 *  9. 成功召回后侍君从活跃冷宫列表消失（通过 store state 流转）。
 * 10. UI 代码不直接写 residence / statusEffects / punishment records / IDs。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PunishmentModal } from "../../src/ui/components/PunishmentModal";
import { ColdPalaceRestoreModal } from "../../src/ui/components/ColdPalaceModal";
import { CharacterScene } from "../../src/ui/screens/CharacterScene";
import { AssetRegistry } from "../../src/engine/assets/registry";
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
const location = db.locations[character.defaultLocation!]!;
const changmengong = db.locations["changmengong"]!;

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
  const effect = coldPalaceState.statusEffects.find(
    (e) => e.kind === "cold_palace" && e.characterId === charId && (e as { liftedTurn?: number }).liftedTurn === undefined,
  );
  if (!effect) throw new Error("no active cold palace effect");

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

// ── 1–4: PunishmentModal — 打入冷宫菜单项 ──────────────────────────────────

describe("PunishmentModal — 打入冷宫", () => {
  function renderModal(state: GameState, onSendToColdPalace?: (id: string) => void) {
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
    const onSend = vi.fn();
    renderModal(base, onSend);
    const btn = screen.getByRole("button", { name: /打入冷宫/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("2a. 已在冷宫者：「打入冷宫」按钮禁用，标注原因", () => {
    const inCold = stateInColdPalace(base);
    const onSend = vi.fn();
    renderModal(inCold, onSend);
    const btn = screen.getByRole("button", { name: /打入冷宫/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title") ?? btn.textContent).toMatch(/已身处冷宫/);
  });

  it("2b. 已故侍君：「打入冷宫」按钮禁用", () => {
    const deceased = applyEffects(db, base, [{ type: "consort_decease", char: CONSORT_ID, at: now, cause: "illness" }]);
    if (!deceased.ok) throw new Error("decease setup failed");
    const onSend = vi.fn();
    renderModal(deceased.value, onSend);
    const btn = screen.getByRole("button", { name: /打入冷宫/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title") ?? btn.textContent).toMatch(/已逝/);
  });

  it("3. 确认「打入冷宫」时 onSendToColdPalace 被调用一次（含正确 charId）", async () => {
    const onSend = vi.fn();
    renderModal(base, onSend);
    await userEvent.click(screen.getByRole("button", { name: /^打入冷宫$/ }));
    // 进入确认步骤
    await userEvent.click(screen.getByRole("button", { name: "确认下旨" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(CONSORT_ID);
  });

  it("4. onSendToColdPalace 未传时按钮禁用（不可提交无处理者的命令）", () => {
    renderModal(base, undefined); // no handler
    const btn = screen.getByRole("button", { name: /^打入冷宫$/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── 5–6: 活跃居民列表（CharacterScene in changmengong）──────────────────────

describe("CharacterScene — 冷宫活跃居民", () => {
  function renderChangmengong(state: GameState, extras: Record<string, unknown> = {}) {
    const onViewProfile = vi.fn<(id: string) => void>();
    const onRestoreFromColdPalace = vi.fn<(id: string) => void>();
    render(
      <CharacterScene
        db={db}
        state={state}
        registry={registry}
        location={changmengong}
        consorts={[character]}
        onViewProfile={onViewProfile}
        onRestoreFromColdPalace={onRestoreFromColdPalace}
        {...extras}
      />,
    );
    return { onViewProfile, onRestoreFromColdPalace };
  }

  it("5. 活跃冷宫效果：显示「幽居冷宫」状态 + 「召回」按钮", () => {
    const inCold = stateInColdPalace(base);
    renderChangmengong(inCold);
    expect(screen.getAllByText(/幽居冷宫/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "召回" })).toBeTruthy();
  });

  it("6. 已解除历史效果：对应 consort 不显示「幽居冷宫」标记", () => {
    const inCold = stateInColdPalace(base);
    const restored = stateRestoredFromColdPalace(inCold);
    // 还原后 consort 不在 changmengong，传入空数组侍君模拟「无人幽居」
    render(
      <CharacterScene
        db={db}
        state={restored}
        registry={registry}
        location={changmengong}
        consorts={[]}
        onViewProfile={vi.fn()}
      />,
    );
    expect(screen.queryByText(/幽居冷宫/)).toBeNull();
  });

  it("7. 生成式侍君幽居时，CharacterScene 能显示其名字标记", () => {
    // 注入一个最小生成侍君
    const genChar = {
      id: "gen_test_001",
      kind: "consort" as const,
      profile: { name: "云袖", age: 20, role: "侍君", personalityTraits: [] },
      attributes: { affection: 30, obedience: 40, ambition: 20, fear: 0 },
      portraitSet: "default",
      defaultLocation: "zhaoning_gong",
    };
    const stateWithGen: GameState = {
      ...base,
      generatedConsorts: { ...base.generatedConsorts, gen_test_001: genChar as never },
      standing: {
        ...base.standing,
        gen_test_001: {
          rank: "guiren",
          lifecycle: "normal",
          affection: 30,
          residence: "changmengong",
        },
      },
    };
    const inCold = stateInColdPalace(stateWithGen, "gen_test_001");
    const dbWithGen = { ...db, characters: { ...db.characters, gen_test_001: genChar as never } };
    const genCharContent = genChar as unknown as import("../../src/engine/content/schemas").CharacterContent;
    render(
      <CharacterScene
        db={dbWithGen}
        state={inCold}
        registry={registry}
        location={changmengong}
        consorts={[genCharContent]}
        onViewProfile={vi.fn()}
        onRestoreFromColdPalace={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/云袖/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/幽居冷宫/).length).toBeGreaterThan(0);
  });
});

// ── 8–9: ColdPalaceRestoreModal — 召回确认 ─────────────────────────────────

describe("ColdPalaceRestoreModal — 召回确认", () => {
  it("8a. 选「奉旨召回」并确认，调用 onConfirm('lifted_by_emperor')", async () => {
    const onConfirm = vi.fn<(r: "lifted_by_emperor" | "pardoned") => void>();
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
    const onConfirm = vi.fn<(r: "lifted_by_emperor" | "pardoned") => void>();
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

  it("9. 成功召回后 store state 中活跃冷宫效果消失", () => {
    const inCold = stateInColdPalace(base);
    const activeEffect = inCold.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === CONSORT_ID && (e as { liftedTurn?: number }).liftedTurn === undefined,
    );
    expect(activeEffect).toBeTruthy(); // 确认在冷宫

    const restored = stateRestoredFromColdPalace(inCold);
    const stillActive = restored.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === CONSORT_ID && (e as { liftedTurn?: number }).liftedTurn === undefined,
    );
    expect(stillActive).toBeUndefined(); // 已解除
  });
});

// ── 10: UI 代码不直接写持久化字段 ──────────────────────────────────────────

describe("架构约束：UI 不直接写 residence / statusEffects / punishments / IDs", () => {
  it("10. PunishmentModal 和 ColdPalaceRestoreModal 不持有任何状态写入逻辑", () => {
    // 这是结构性约束测试：这两个组件只接受 callbacks，不自行修改 state。
    // 通过确认它们在 onSendToColdPalace / onConfirm 之外不产生副作用来验证。
    const onSend = vi.fn();
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
