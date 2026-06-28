import { expect, test } from "@playwright/test";

// 生产新游戏用 crypto 真随机种子；E2E 构建（VITE_E2E）下可用 `?e2eSeed=N` 固定后宫，
// 以便确定性断言。seed=1 列表按位分降序：皇后、王龙城·良驸、…。
// 这里取「首位非皇后侍君」，姓名从按钮动态读取（不写死），调其位分为昭仪后验证新称呼。
test("promote a consort from the 乘风·管理侍君 list and return to her detail with new 称呼", async ({ page }) => {
  await page.goto("/?e2eSeed=1");
  await page.getByRole("button", { name: "新游戏" }).click();
  // 登基改元
  await page.getByPlaceholder("请输入年号（两字）").fill("永熙");
  await page.getByRole("button", { name: "确认年号" }).click();
  await page.getByRole("button", { name: "开始" }).click();

  // map-as-hub: enter 紫宸殿
  await page.getByRole("button", { name: "紫宸殿" }).click();
  await page.getByRole("button", { name: "传乘风" }).click();
  await page.getByRole("button", { name: "管理侍君" }).click();

  // 首位非皇后侍君（列表按位分降序，皇后恒在最前）。姓名从按钮读取，避免写死生成结果。
  const nonEmpressRows = page
    .locator(".consort-list__row")
    .filter({ hasNot: page.locator(".consort-list__rank", { hasText: "皇后" }) });
  const firstConsort = nonEmpressRows.first();
  const fullName = (await firstConsort.locator(".consort-list__name").innerText()).trim();
  const surname = fullName.slice(0, 1); // 调整后的称呼 = 姓 + 位分名
  await firstConsort.locator(".consort-list__pick").click();
  await page.getByRole("button", { name: "封号/位分管理" }).click();

  // 调为昭仪（seed=1 首位侍君为良驸，与昭仪不同，必为一次真实调整）
  await page.locator(".rank-modal select").selectOption("zhaoyi");
  await page.getByRole("button", { name: "确认调整" }).click();

  // 反应以新称呼「{姓}昭仪」开口
  await expect(
    page.locator(".dialogue-screen__speaker", { hasText: `${surname}昭仪` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "（继续）" }).click();

  // 反应结束后自动回到「查看侍君」并定位回该侍君详情，位分已更新为昭仪
  await expect(page.getByText("位分：昭仪")).toBeVisible();
  await expect(page.getByRole("button", { name: "封号/位分管理" })).toBeVisible();
});
