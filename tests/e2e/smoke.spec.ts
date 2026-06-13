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

  // ── title → new game ────────────────────────────────────────────────
  await page.getByRole("button", { name: "新游戏" }).click();
  await expect(page.getByText("行动点：5/5")).toBeVisible();

  // ── trigger the event eligible at the starting location (御书房) ──────
  await page.getByRole("button", { name: /司礼女官请示经血祭仪/ }).click();

  // ── dialogue: pick 准奏, then advance the closing line to commit ──────
  await page.getByRole("button", { name: /准奏/ }).click();
  await page.getByRole("button", { name: "（继续）" }).click();

  // back at the location screen — AP spent once (5 → 4)
  await expect(page.getByText("行动点：4/5")).toBeVisible();

  // ── verify the committed outcome ────────────────────────────────────
  const afterCommit = await readState(page);
  expect(afterCommit.calendar.ap).toBe(4);
  expect(afterCommit.flags.rite_scheduled).toBe(true);
  expect(afterCommit.eventLog.some((e) => e.eventId === "ev_menses_rite")).toBe(true);
  const siliMemories = afterCommit.memories.sili_nvguan?.entries ?? [];
  expect(siliMemories.some((m) => m.tags.includes("rite"))).toBe(true);
  // the 准奏 branch raised 宗嗣合法性 and 圣威 (effect funnel applied)
  expect(afterCommit.resources.bloodline.legitimacy).toBeGreaterThan(0);

  // ── manual save to a slot ───────────────────────────────────────────
  await page.getByRole("button", { name: "存档" }).click();
  await page
    .locator(".save-screen__slot", { hasText: "slot1" })
    .getByRole("button", { name: "保存" })
    .click();
  await expect(page.getByText(/已保存到 slot1/)).toBeVisible();

  // ── reload the page and continue from autosave ──────────────────────
  await page.reload();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByText("行动点：4/5")).toBeVisible();

  // ── state survived the roundtrip ────────────────────────────────────
  const afterReload = await readState(page);
  expect(afterReload.calendar.ap).toBe(4);
  expect(afterReload.flags.rite_scheduled).toBe(true);
  expect(afterReload.eventLog.some((e) => e.eventId === "ev_menses_rite")).toBe(true);
  expect((afterReload.memories.sili_nvguan?.entries ?? []).length).toBe(siliMemories.length);
});
