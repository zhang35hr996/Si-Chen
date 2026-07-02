/**
 * PunishmentModal interaction tests (jsdom + @testing-library/react).
 * 验证两个 UI 入口共用的惩罚组件：菜单项启用/禁用、禁足期限→精确日期确认、
 * 赐死高危二次确认（输入姓名）、已禁足显示详情与解除。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PunishmentModal } from "../../src/ui/components/PunishmentModal";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import type { GameState } from "../../src/engine/state/types";
import type { ImperialCommand } from "../../src/store/imperialCommands";

const db = loadRealContent();
const base = withConsort(createNewGameState(db), db, "lu_huaijin");
const character = base.generatedConsorts.lu_huaijin!;

function renderModal(state: GameState) {
  const onCommand = vi.fn<(c: ImperialCommand) => void>();
  const onClose = vi.fn();
  render(<PunishmentModal db={db} state={state} character={character} onCommand={onCommand} onClose={onClose} />);
  return { onCommand, onClose };
}

describe("PunishmentModal — 惩罚菜单", () => {
  it("下狱/株连九族为禁用项，点击不发命令", () => {
    const { onCommand } = renderModal(base);
    const jail = screen.getByRole("button", { name: /下狱/ });
    const clan = screen.getByRole("button", { name: /株连九族/ });
    expect((jail as HTMLButtonElement).disabled).toBe(true);
    expect((clan as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(jail);
    fireEvent.click(clan);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("禁足→选期限→确认，展示精确到期旬并发 impose_confinement", () => {
    const { onCommand } = renderModal(base);
    fireEvent.click(screen.getByRole("button", { name: "禁足" }));
    fireEvent.click(screen.getByRole("button", { name: "一个月" }));
    // 确认弹窗须展示具体到期旬（非只「一个月」）。
    expect(screen.getByText(/解除/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认下旨" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 3 });
  });

  it("无诏不得出：确认文案标明无自动期限", () => {
    const { onCommand } = renderModal(base);
    fireEvent.click(screen.getByRole("button", { name: "禁足" }));
    fireEvent.click(screen.getByRole("button", { name: "无诏不得出" }));
    expect(screen.getByText(/没有自动期限/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认下旨" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "impose_confinement", targetId: "lu_huaijin", durationTurns: null });
  });

  it("赐死须输入姓名方可确认（防误触）", () => {
    const { onCommand } = renderModal(base);
    fireEvent.click(screen.getByRole("button", { name: "赐死" }));
    const confirmBtn = screen.getByRole("button", { name: "赐死" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true); // 未输入姓名
    const input = screen.getByLabelText("确认姓名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: input.placeholder } }); // 须与显示名一致
    expect(confirmBtn.disabled).toBe(false);
    fireEvent.click(confirmBtn);
    expect(onCommand).toHaveBeenCalledWith({ type: "execute", targetId: "lu_huaijin" });
  });
});

describe("PunishmentModal — 已禁足显示详情与解除", () => {
  function confinedState(durationTurns: number | null): GameState {
    const now = toGameTime(base.calendar);
    const r = applyEffects(db, base, [
      {
        type: "confine",
        char: "lu_huaijin",
        startTurn: base.calendar.dayIndex,
        endTurnExclusive: durationTurns === null ? null : base.calendar.dayIndex + durationTurns,
        imposedAt: now,
      },
    ]);
    if (!r.ok) throw new Error("setup failed");
    return r.value;
  }

  it("有期限：显示精确到期旬 + 解除禁足按钮", () => {
    const { onCommand } = renderModal(confinedState(3));
    expect(screen.getByText(/当前禁足开始/)).toBeTruthy();
    expect(screen.getByText(/预计解除/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "解除禁足" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "lift_confinement", targetId: "lu_huaijin" });
  });

  it("无期限：显示「无诏不得出」", () => {
    renderModal(confinedState(null));
    expect(screen.getAllByText(/无诏不得出/).length).toBeGreaterThan(0);
  });
});
