import { expect, test } from "@playwright/test";

test("promote a summoned consort and see the new 称呼", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新游戏" }).click();
  // 登基改元
  await page.getByPlaceholder("请输入年号（两字）").fill("永熙");
  await page.getByRole("button", { name: "确认年号" }).click();
  await page.getByRole("button", { name: "开始" }).click();

  // map-as-hub: enter 紫宸殿, dismiss its location_enter event prompt
  await page.getByRole("button", { name: "紫宸殿" }).click();
  await page.getByRole("button", { name: "稍后再说" }).click();

  // 查看侍君 → 陆怀瑾（承徽）→ 召见 到紫宸殿（避开列表叠层，单一弹窗管理）
  await page.getByRole("button", { name: "查看侍君" }).click();
  await page.getByRole("button", { name: "陆怀瑾 承徽" }).click();
  await page.getByRole("button", { name: "召见", exact: true }).click();

  // 召见卡片上「管理位分 / 封号」→ 选 君（value "jun"）→ 确认
  await page.getByRole("button", { name: "管理位分 / 封号" }).click();
  await page.locator(".rank-modal select").selectOption("jun");
  await page.getByRole("button", { name: "确认调整" }).click();

  // 反应以新称呼「陆君」开口
  await expect(page.locator(".dialogue-screen__speaker", { hasText: "陆君" })).toBeVisible();
  await page.getByRole("button", { name: "（继续）" }).click();

  // 召见卡片显示新位分
  await expect(page.getByText("位分：君")).toBeVisible();
});
