import { expect, test } from "@playwright/test";

test("promote a consort from 御书房 and see the new 称呼", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新游戏" }).click();
  // map-as-hub: enter 御书房 from the map
  await page.getByRole("button", { name: /御书房/ }).click();
  // 后宫名册 → 管理 沈承徽
  const row = page.locator(".roster-row", { hasText: "沈承徽" });
  await row.getByRole("button", { name: "管理" }).click();
  // pick 君 (option value "jun"), confirm
  await page.locator(".rank-modal select").selectOption("jun");
  await page.getByRole("button", { name: "确认调整" }).click();
  // reaction shows the new 称呼 沈君 as the speaker name
  await expect(page.locator(".dialogue-screen__speaker", { hasText: "沈君" })).toBeVisible();
  await page.getByRole("button", { name: "（继续）" }).click();
  // roster now lists 沈君
  await expect(page.locator(".roster-row", { hasText: "沈君" })).toBeVisible();
});
