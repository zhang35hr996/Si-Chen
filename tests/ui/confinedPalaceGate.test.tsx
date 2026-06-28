/**
 * 禁足宫门集成测试：进入被禁足侍君的宫殿时，CharacterScene 必须切换到
 * 「宫门闭锁」视图——无立绘、仅显示禁足状态、提供解除/传太医操作。
 * 正常未禁足时恢复立绘与常规操作。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import { CharacterScene } from "../../src/ui/screens/CharacterScene";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });
const base = withConsort(createNewGameState(db), db, "lu_huaijin");
const now = toGameTime(base.calendar);

const CONSORT_ID = "lu_huaijin";
const character = db.characters[CONSORT_ID]!;
const location = db.locations[character.defaultLocation!]!;

function confined() {
  const r = applyEffects(db, base, [
    {
      type: "confine",
      char: CONSORT_ID,
      startTurn: base.calendar.dayIndex,
      endTurnExclusive: base.calendar.dayIndex + 3,
      imposedAt: now,
    },
  ]);
  if (!r.ok) throw new Error("confine setup failed");
  return r.value;
}

function renderScene(state = base, extras: Record<string, unknown> = {}) {
  const onPunish = vi.fn<(id: string) => void>();
  const onSummonPhysician = vi.fn();
  const onViewProfile = vi.fn<(id: string) => void>();
  const onConverse = vi.fn<(id: string) => void>();
  render(
    <CharacterScene
      db={db}
      state={state}
      registry={registry}
      location={location}
      consorts={[character]}
      onViewProfile={onViewProfile}
      onConverse={onConverse}
      onPunish={onPunish}
      onSummonPhysician={onSummonPhysician}
      {...extras}
    />,
  );
  return { onPunish, onSummonPhysician, onViewProfile, onConverse };
}

describe("禁足宫门：进入被禁足侍君宫殿", () => {
  it("显示宫门闭锁文案而非立绘", () => {
    renderScene(confined());
    // 至少一处包含「宫门闭锁」的文本节点存在。
    expect(screen.getAllByText(/宫门闭锁/).length).toBeGreaterThan(0);
    // 立绘 img 不应出现（侍君头像）
    expect(screen.queryByRole("img", { name: character.profile.name })).toBeNull();
  });

  it("显示禁足状态描述（含期限信息）", () => {
    renderScene(confined());
    // 禁足说明段落存在（含期限文本）
    expect(screen.getAllByText(/禁足/).length).toBeGreaterThan(0);
  });

  it("「解除禁足」按钮调用 onPunish", async () => {
    const user = userEvent.setup();
    const { onPunish } = renderScene(confined());
    await user.click(screen.getByRole("button", { name: "解除禁足" }));
    expect(onPunish).toHaveBeenCalledWith(CONSORT_ID);
  });

  it("「奉旨传太医」按钮调用 onSummonPhysician", async () => {
    const user = userEvent.setup();
    const { onSummonPhysician } = renderScene(confined());
    await user.click(screen.getByRole("button", { name: "奉旨传太医" }));
    expect(onSummonPhysician).toHaveBeenCalledTimes(1);
  });

  it("禁足时不显示「对话」「侍寝」等常规操作", () => {
    const state = { ...confined(), calendar: { ...confined().calendar, ap: 3 } };
    renderScene(state, { onBedchamber: vi.fn() });
    expect(screen.queryByRole("button", { name: "对话" })).toBeNull();
    expect(screen.queryByRole("button", { name: "侍寝" })).toBeNull();
  });
});

describe("未禁足：正常宫殿场景", () => {
  it("显示立绘（img）", () => {
    renderScene(base);
    // 立绘 img 应存在（角色立绘）
    const imgs = screen.queryAllByRole("img");
    expect(imgs.length).toBeGreaterThan(0);
  });

  it("不显示宫门闭锁文案", () => {
    renderScene(base);
    expect(screen.queryByText(/宫门闭锁/)).toBeNull();
    expect(screen.queryByRole("button", { name: "解除禁足" })).toBeNull();
  });
});
