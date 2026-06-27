import { expect, test } from "@playwright/test";

test("promote a consort from the 乘风·调整位分 list and return to her detail with new 称呼", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新游戏" }).click();
  // 登基改元
  await page.getByPlaceholder("请输入年号（两字）").fill("永熙");
  await page.getByRole("button", { name: "确认年号" }).click();
  await page.getByRole("button", { name: "开始" }).click();

  // map-as-hub: enter 紫宸殿. Its request-audience prompt is non-blocking, so the
  // scene actions stay live — open the consort list via 乘风 → 调整位分.
  await page.getByRole("button", { name: "紫宸殿" }).click();
  await page.getByRole("button", { name: "传乘风" }).click();
  await page.getByRole("button", { name: "调整位分" }).click();

  // 陆怀瑾（承徽）→ 封号管理（直接从列表进；列表会先收起，弹窗不再被遮挡）
  await page.getByRole("button", { name: "陆怀瑾 承徽" }).click();
  await page.getByRole("button", { name: "封号管理" }).click();

  // 选 驸（value "fu"，旧 jun → 新 fu 重命名后的从一品位分）→ 确认（修复前此处被列表叠层拦截而点不动）
  await page.locator(".rank-modal select").selectOption("fu");
  await page.getByRole("button", { name: "确认调整" }).click();

  // 反应以新称呼「陆驸」开口
  await expect(page.locator(".dialogue-screen__speaker", { hasText: "陆驸" })).toBeVisible();
  await page.getByRole("button", { name: "（继续）" }).click();

  // 反应结束后自动回到「查看侍君」并定位回陆怀瑾详情，位分已更新为 驸
  await expect(page.getByText("位分：驸")).toBeVisible();
  await expect(page.getByRole("button", { name: "封号管理" })).toBeVisible();
});
