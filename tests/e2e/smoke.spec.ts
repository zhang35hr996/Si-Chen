/**
 * Vertical-slice smoke (skeleton-plan §11/§13). One end-to-end journey:
 *   new game → trigger the starting-location event → advance dialogue →
 *   choose an outcome → verify AP/effects/memory/eventLog via the debug dump →
 *   manual save → reload page → continue → verify the state persisted.
 *
 * State is read straight from the debug panel's JSON dump (toggle: backtick),
 * the same surface a developer inspects by hand.
 */
import { expect, test, type Page } from "@playwright/test";
import type { GameState } from "../../src/engine/state/types";

async function readState(page: Page): Promise<GameState> {
  await page.keyboard.press("`"); // open debug panel
  const dump = page.locator(".debug-panel__dump");
  await expect(dump).toBeVisible();
  const text = await dump.textContent();
  await page.keyboard.press("`"); // close again
  return JSON.parse(text ?? "{}") as GameState;
}

test("vertical slice: new game → event → choose → save → reload → persist", async ({ page }) => {
  await page.goto("/");

  // ── title → new game (lands on the 皇城主地图 hub) ─────────────────────
  await page.getByRole("button", { name: "新游戏" }).click();
  await expect(page.getByText("卯时（早上）")).toBeVisible(); // 第一个行动点 = 卯时

  // ── enter the starting room (御书房) from the map, then its event ──────
  await page.getByRole("button", { name: /御书房/ }).click();
  await page.getByRole("button", { name: /司礼请示经血祭仪/ }).click();

  // ── dialogue: pick 准奏, then advance the closing line to commit ──────
  await page.getByRole("button", { name: /准奏/ }).click();
  await page.getByRole("button", { name: "（继续）" }).click();

  // back on the 皇城主地图 — one AP spent advances 卯时 → 辰时 (6 → 5)
  await expect(page.getByText("辰时（上午）")).toBeVisible();

  // ── verify the committed outcome ────────────────────────────────────
  const afterCommit = await readState(page);
  expect(afterCommit.calendar.ap).toBe(5);
  expect(afterCommit.flags.rite_scheduled).toBe(true);
  expect(afterCommit.eventLog.some((e) => e.eventId === "ev_menses_rite")).toBe(true);
  const siliMemories = afterCommit.memories.wei_sui?.entries ?? [];
  expect(siliMemories.some((m) => m.tags.includes("rite"))).toBe(true);

  // ── manual save to a slot ───────────────────────────────────────────
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "存档" }).click();
  await page
    .locator(".save-screen__slot", { hasText: "slot1" })
    .getByRole("button", { name: "保存" })
    .click();
  await expect(page.getByText(/已保存到 slot1/)).toBeVisible();

  // ── reload the page and continue from autosave ──────────────────────
  await page.reload();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByText("辰时（上午）")).toBeVisible();

  // ── state survived the roundtrip ────────────────────────────────────
  const afterReload = await readState(page);
  expect(afterReload.calendar.ap).toBe(5);
  expect(afterReload.flags.rite_scheduled).toBe(true);
  expect(afterReload.eventLog.some((e) => e.eventId === "ev_menses_rite")).toBe(true);
  expect((afterReload.memories.wei_sui?.entries ?? []).length).toBe(siliMemories.length);
});
