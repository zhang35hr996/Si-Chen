/**
 * Vertical-slice smoke (skeleton-plan §11/§13). One end-to-end journey:
 *   new game → 登基改元 → enter 紫宸殿 → trigger its location_enter event →
 *   advance dialogue → choose an outcome → verify AP/effects/memory/eventLog
 *   via the debug dump → manual save → reload page → continue → verify persist.
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

test("vertical slice: new game → 登基 → event → choose → save → reload → persist", async ({ page }) => {
  await page.goto("/");

  // ── title → new game → 登基改元（输入年号 → 开始）─────────────────────
  await page.getByRole("button", { name: "新游戏" }).click();
  await page.getByPlaceholder("请输入年号（两字）").fill("永熙");
  await page.getByRole("button", { name: "确认年号" }).click();
  await page.getByRole("button", { name: "开始" }).click();

  // lands on the 皇城主地图 hub; first 行动点 = 卯时
  await expect(page.getByText("卯时（早上）")).toBeVisible();

  // ── enter the starting room (紫宸殿); its request-audience event shows as a
  //    non-blocking AudiencePrompt — admit it (宣进来) to start the dialogue ──
  await page.getByRole("button", { name: "紫宸殿" }).click();
  await page.getByRole("button", { name: "宣进来" }).click();

  // ── dialogue: pick 准奏, then advance the closing line to commit ──────
  await page.getByRole("button", { name: /准奏/ }).click();
  await page.getByRole("button", { name: "（继续）" }).click();

  // committed audience returns to 紫宸殿 ({kind:"zichendian"}); one AP spent
  // advances 卯时 → 辰时 (5 → 4) — shown in the top bar.
  await expect(page.getByText("辰时（上午）")).toBeVisible();

  // ── verify the committed outcome ────────────────────────────────────
  const afterCommit = await readState(page);
  expect(afterCommit.calendar.ap).toBe(4); // apMax=5, apCost=1 → 4
  expect(afterCommit.flags.rite_scheduled).toBe(true);
  expect(afterCommit.eventLog.some((e) => e.eventId === "ev_menses_rite")).toBe(true);
  const siliMemories = afterCommit.memories.wei_sui?.entries ?? [];
  expect(siliMemories.some((m) => m.triggerTags.includes("rite"))).toBe(true);

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
