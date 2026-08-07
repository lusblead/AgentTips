import { expect, test, type Page } from "@playwright/test";

function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test.describe("Phase 1.5 交互流程", () => {
  test("快捷窗口：输入并 Ctrl+Enter 保存后重置", async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto("/?window=quick-note");
    await expect(page.getByRole("heading", { name: "新建提示" })).toBeVisible();
    const textarea = page.getByLabel("正文");
    await expect(textarea).toHaveValue("");
    await textarea.fill("通过快捷键保存的便签");
    await page.getByRole("button", { name: /添加 Agent/ }).click();
    await page.getByRole("menuitem", { name: /Cursor/ }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector('[role="menu"]') &&
        Boolean(document.querySelector('[aria-label="Cursor 默认携带"]')),
    );
    await page.waitForTimeout(120);
    await textarea.click();
    await page.keyboard.press("Control+Enter");
    await expect(page.getByRole("status")).toHaveText("已保存");
    await expect(textarea).toHaveValue("");
    expect(errors).toEqual([]);
  });

  test("主窗口：搜索与 Agent 筛选", async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto("/?window=main");
    await expect(page.getByLabel("标题").first()).toHaveValue("修改前解释调用链");

    await page.getByRole("button", { name: "搜索" }).click();
    await page.getByLabel("搜索便签").fill("测试");
    await expect(page.getByLabel("标题").first()).toHaveValue("完成后运行全部测试");
    await expect(page.getByLabel("标题").first()).not.toHaveValue("修改前解释调用链");

    await page.getByLabel("搜索便签").fill("");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: /筛选/ }).hover();
    await page.getByRole("menuitem", { name: /筛选/ }).dispatchEvent("mouseenter");
    await page.getByRole("checkbox", { name: "筛选 Cursor" }).waitFor({ timeout: 5000 });
    await page.locator('div:has(> [aria-label="筛选 Cursor"])').first().click({ force: true });
    await expect(page.getByLabel("标题").first()).toHaveValue("修改前解释调用链");
    await expect(page.getByLabel("标题").first()).not.toHaveValue("完成后运行全部测试");
    expect(errors).toEqual([]);
  });

  test("提醒窗口：聚合、收起与忽略", async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto("/?window=reminder");
    const dialog = page.getByRole("dialog", { name: "Cursor 提醒" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("3 条提示")).toBeVisible();

    await page.getByRole("button", { name: "收起为胶囊" }).click();
    await expect(page.getByText("Cursor · 3 条提示")).toBeVisible();

    await page.getByRole("button", { name: "展开提醒" }).click();
    await expect(dialog).toBeVisible();

    await page.getByRole("button", { name: "本次忽略" }).click();
    await expect(dialog).not.toBeVisible();
    expect(errors).toEqual([]);
  });

  test("设置页：录制 Ctrl+K 通过，Esc 取消", async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto("/?window=settings");
    const display = page.getByTestId("hotkey-display");
    await expect(display).toHaveText("Ctrl + F12");

    await page.getByRole("button", { name: "重新录制" }).click();
    await page.keyboard.press("Control+k");
    await expect(page.getByText("已保存 Ctrl + K")).toBeVisible();
    await expect(display).toHaveText("Ctrl + K");

    await page.getByRole("button", { name: "重新录制" }).click();
    await page.keyboard.press("Escape");
    await expect(display).toHaveText("Ctrl + K");
    expect(errors).toEqual([]);
  });
});
