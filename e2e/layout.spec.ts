import { expect, test } from "@playwright/test";

test.describe("布局溢出检查", () => {
  test("快捷窗口无横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 420 });
    await page.goto("/?window=quick-note");
    await expect(page.getByRole("heading", { name: "新建提示" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("主窗口 Grid 无横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto("/?window=main");
    await expect(page.getByText("修改前解释调用链")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const grid = page.getByTestId("tip-grid");
    await expect(grid).toBeVisible();
    const gridOverflow = await grid.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(gridOverflow).toBeLessThanOrEqual(0);
  });

  test("提醒窗口卡片在视口内", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 360 });
    await page.goto("/?window=reminder");
    const dialog = page.getByRole("dialog", { name: "Cursor 提醒" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(420);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(360);
    }
  });

  test("设置页卡片在视口内", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/?window=settings");
    await expect(page.getByRole("button", { name: "重新录制" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("列表卡片无文字横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto("/?window=main");
    await expect(page.getByText("修改前解释调用链")).toBeVisible();
    const overflowing = await page
      .locator('[data-window="main"] button[aria-pressed]')
      .evaluateAll((cards) =>
        cards
          .filter((card) => card.scrollWidth > card.clientWidth + 1)
          .map((card) => `${card.scrollWidth}/${card.clientWidth}`),
      );
    expect(overflowing).toEqual([]);
  });
});
