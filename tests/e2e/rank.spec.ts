import { expect, test } from "@playwright/test";

// 新游戏 rngSeed 固定为 1（store.newGame 默认值）。
// seed=1 生成侍君（按位分降序，不含皇后）：王龙城·良驸、长孙鸿羽·驸、顾素华·承仪、贺文渊·承德。
// 取首位（王龙城·良驸）作为位分调整测试目标，调为昭仪。
test("promote a consort from the 乘风·管理侍君 list and return to her detail with new 称呼", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新游戏" }).click();
  // 登基改元
  await page.getByPlaceholder("请输入年号（两字）").fill("永熙");
  await page.getByRole("button", { name: "确认年号" }).click();
  await page.getByRole("button", { name: "开始" }).click();

  // map-as-hub: enter 紫宸殿
  await page.getByRole("button", { name: "紫宸殿" }).click();
  await page.getByRole("button", { name: "传乘风" }).click();
  await page.getByRole("button", { name: "管理侍君" }).click();

  // 王龙城（良驸）是 seed=1 位分最高的生成侍君（皇后之后列表第一）
  await page.getByRole("button", { name: "王龙城 良驸" }).click();
  await page.getByRole("button", { name: "封号/位分管理" }).click();

  // 调为昭仪（从良驸降位）
  await page.locator(".rank-modal select").selectOption("zhaoyi");
  await page.getByRole("button", { name: "确认调整" }).click();

  // 反应以新称呼「王昭仪」开口
  await expect(page.locator(".dialogue-screen__speaker", { hasText: "王昭仪" })).toBeVisible();
  await page.getByRole("button", { name: "（继续）" }).click();

  // 反应结束后自动回到「查看侍君」并定位回王龙城详情，位分已更新为昭仪
  await expect(page.getByText("位分：昭仪")).toBeVisible();
  await expect(page.getByRole("button", { name: "封号/位分管理" })).toBeVisible();
});
