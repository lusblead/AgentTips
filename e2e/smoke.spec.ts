import { expect, test } from "@playwright/test";

test("默认进入主管理窗口", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("提示库")).toBeVisible();
  await expect(page.getByText("修改前解释调用链")).toBeVisible();
});
