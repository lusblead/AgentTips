import { expect, test } from "@playwright/test";

test("默认进入主管理窗口", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("AgentTips")).toBeVisible();
  await expect(page.getByLabel("标题").first()).toHaveValue("修改前解释调用链");
});
