import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(E2E_DIR, "..", "artifacts", "screenshots", "phase-1.5");
const VIEWPORTS = {
  main: { width: 1180, height: 760 },
  quickNote: { width: 620, height: 420 },
  reminder: { width: 420, height: 360 },
  settings: { width: 800, height: 600 },
};

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function setup(page: Page, viewport: { width: number; height: number }, url: string) {
  await page.setViewportSize(viewport);
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(E2E_DIR, "..", "artifacts", "screenshots", "phase-2.2"), { recursive: true });
});

test.describe("Phase 1.5 视觉截图", () => {
  test("快捷窗口：空白状态", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.quickNote, "/?window=quick-note");
    await expect(page.getByRole("heading", { name: "新建提示" })).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "quick-note-empty.png") });
    expect(errors).toEqual([]);
  });

  test("快捷窗口：填写状态", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.quickNote, "/?window=quick-note");
    await page.getByLabel("正文").fill("修改任何核心模块前，先解释调用链与影响范围。");
    await page.screenshot({ path: join(OUT_DIR, "quick-note-filled.png") });
    expect(errors).toEqual([]);
  });

  test("快捷窗口：多 Agent 绑定", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.quickNote, "/?window=quick-note");
    await page.getByLabel("正文").fill("同时提醒多个 Agent 的通用约束。");
    await page.getByRole("button", { name: /添加 Agent/ }).click();
    await page.getByRole("menuitem", { name: /Cursor/ }).click();
    await page.getByRole("button", { name: /添加 Agent/ }).click();
    await page.getByRole("menuitem", { name: /Claude Code/ }).click();
    await expect(page.getByLabel("Cursor 默认携带")).toBeVisible();
    await expect(page.getByLabel("Claude Code 默认携带")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "quick-note-multiple-agents.png") });
    expect(errors).toEqual([]);
  });

  test("主窗口：有数据（便签墙）", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.main, "/?window=main");
    await expect(page.getByText("修改前解释调用链")).toBeVisible();
    await expect(page.getByTestId("tip-grid")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "main-window.png") });
    expect(errors).toEqual([]);
  });

  test("主窗口：空态", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.main, "/?window=main&empty=1");
    await expect(page.getByText("还没有便签")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "main-window-empty.png") });
    expect(errors).toEqual([]);
  });

  test("主窗口：hover 便签卡", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.main, "/?window=main");
    const card = page.getByTestId("tip-card").first();
    await card.hover();
    await page.screenshot({ path: join(OUT_DIR, "main-window-selected.png") });
    expect(errors).toEqual([]);
  });

  test("提醒窗口：展开", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.reminder, "/?window=reminder");
    await expect(page.getByRole("dialog", { name: "Cursor 提醒" })).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "reminder-expanded.png") });
    expect(errors).toEqual([]);
  });

  test("提醒窗口：胶囊", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.reminder, "/?window=reminder&demo=collapsed");
    await expect(page.getByText("Cursor · 3 条提示")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "reminder-collapsed.png") });
    expect(errors).toEqual([]);
  });

  test("设置页：默认", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.settings, "/?window=settings");
    await expect(page.getByTestId("hotkey-display")).toHaveText("Ctrl + F12");
    await page.screenshot({ path: join(OUT_DIR, "settings-default.png") });
    expect(errors).toEqual([]);
  });

  test("设置页：录制状态", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.settings, "/?window=settings");
    await page.getByRole("button", { name: "重新录制" }).click();
    await expect(page.getByText("正在录制")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "settings-hotkey-recording.png") });
    expect(errors).toEqual([]);
  });

  test("设置页：非法组合提示", async ({ page }) => {
    const errors = trackErrors(page);
    await setup(page, VIEWPORTS.settings, "/?window=settings");
    await page.getByRole("button", { name: "重新录制" }).click();
    await page.keyboard.press("Control+Alt+k");
    await expect(page.getByText("检测到 Ctrl + Alt + K")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("当前快捷键仍为 Ctrl + F12");
    await page.screenshot({ path: join(OUT_DIR, "settings-hotkey-invalid.png") });
    expect(errors).toEqual([]);
  });
});

test.describe("Phase 2.2 补充截图（浏览器 Mock）", () => {
  const PHASE22 = join(E2E_DIR, "..", "artifacts", "screenshots", "phase-2.2");

  test("提醒窗口：展开", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.setViewportSize({ width: 420, height: 360 });
    await page.goto("/?window=reminder");
    await expect(page.getByRole("dialog", { name: "Cursor 提醒" })).toBeVisible();
    await page.screenshot({ path: join(PHASE22, "reminder-expanded.png") });
    expect(errors).toEqual([]);
  });

  test("提醒窗口：胶囊", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.setViewportSize({ width: 420, height: 360 });
    await page.goto("/?window=reminder&demo=collapsed");
    await expect(page.getByText("Cursor · 3 条提示")).toBeVisible();
    await page.screenshot({ path: join(PHASE22, "reminder-collapsed.png") });
    expect(errors).toEqual([]);
  });
});
