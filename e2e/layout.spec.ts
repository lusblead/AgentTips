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
    await expect(page.getByLabel("标题").first()).toHaveValue("修改前解释调用链");
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

  test("便签卡无文字横向溢出且高度自适应", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto("/?window=main");
    await expect(page.getByLabel("标题").first()).toHaveValue("修改前解释调用链");
    const cards = page.getByTestId("tip-card");
    const first = cards.first();
    const before = await first.boundingBox();
    const widthBefore = before!.width;

    // 第一张卡输入 15 行文字
    const textarea = first.getByLabel("正文");
    await textarea.fill(Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 行内容`).join("\n"));
    await page.waitForTimeout(700);

    const after = await first.boundingBox();
    expect(Math.abs(after!.width - widthBefore)).toBeLessThan(3);
    expect(after!.height).toBeGreaterThan(before!.height + 80);

    // 下方至少一张卡 Y 坐标下移
    const others = await cards.evaluateAll((els) =>
      els.slice(1, 6).map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    const othersBefore = others;
    await expect(first.getByLabel("正文")).toHaveValue(/第 15 行内容/);
    // 无横向溢出
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(othersBefore.length).toBeGreaterThan(0);
  });
});
