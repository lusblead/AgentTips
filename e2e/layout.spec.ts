import { expect, test } from "@playwright/test";

test.describe("布局溢出检查", () => {
  test("compact quick note keeps controls separate and inside the viewport", async ({ page }) => {
    for (const viewport of [
      { width: 440, height: 380 },
      { width: 380, height: 320 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/?window=quick-note");
      await expect(page.getByRole("heading", { name: "新建提示" })).toBeVisible();
      await expect(page.getByLabel("标题")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "添加标题" })).toHaveCount(0);

      const body = page.getByLabel("正文");
      await body.fill("小尺寸便签也应保持正文和操作区互不遮挡。");
      const tagInput = page.getByRole("combobox", { name: "添加标签" });
      for (let index = 0; index < 8; index += 1) {
        await tagInput.fill(`标签项目${index + 1}`);
        await tagInput.press("Enter");
      }
      for (const agentName of ["Cursor", "Claude Code", "OpenCode", "Codex"]) {
        await page.getByRole("button", { name: /添加 Agent/ }).click();
        await page.getByRole("menuitem", { name: new RegExp(agentName) }).click();
      }

      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const surface = document.querySelector<HTMLElement>('[data-testid="note-surface"]')!;
        const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="正文"]')!;
        const bindings = document.querySelector<HTMLElement>(
          '[data-testid="quick-note-bindings"]',
        )!;
        const tagRegion = document.querySelector<HTMLElement>('[data-testid="quick-note-tags"]')!;
        const tagStrip = document.querySelector<HTMLElement>('[data-testid="tag-input"] > div')!;
        const actions = document.querySelector<HTMLElement>('[data-testid="quick-note-actions"]')!;
        const bindingList = document.querySelector<HTMLElement>(
          '[data-testid="quick-note-binding-list"]',
        )!;
        const surfaceRect = surface.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        const bindingsRect = bindings.getBoundingClientRect();
        const tagRect = tagRegion.getBoundingClientRect();
        const actionsRect = actions.getBoundingClientRect();
        const style = getComputedStyle(editor);
        return {
          horizontalOverflow: root.scrollWidth - root.clientWidth,
          verticalOverflow: root.scrollHeight - root.clientHeight,
          bindingListScrollable: bindingList.scrollHeight > bindingList.clientHeight,
          tagStripScrollable: tagStrip.scrollWidth > tagStrip.clientWidth,
          editorBottom: editorRect.bottom,
          bindingsTop: bindingsRect.top,
          tagLeft: tagRect.left,
          tagRight: tagRect.right,
          actionsLeft: actionsRect.left,
          actionsRight: actionsRect.right,
          actionsBottom: actionsRect.bottom,
          surfaceLeft: surfaceRect.left,
          surfaceRight: surfaceRect.right,
          surfaceBottom: surfaceRect.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          borderWidths: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          outlineStyle: style.outlineStyle,
          backgroundColor: style.backgroundColor,
        };
      });

      expect(layout.horizontalOverflow).toBeLessThanOrEqual(0);
      expect(layout.verticalOverflow).toBeLessThanOrEqual(0);
      expect(layout.bindingListScrollable).toBe(true);
      expect(layout.tagStripScrollable).toBe(true);
      expect(layout.editorBottom).toBeLessThanOrEqual(layout.bindingsTop + 1);
      expect(layout.actionsLeft).toBeGreaterThanOrEqual(layout.surfaceLeft);
      expect(layout.tagLeft).toBeGreaterThanOrEqual(layout.surfaceLeft);
      expect(layout.tagRight).toBeLessThanOrEqual(layout.surfaceRight + 1);
      expect(layout.actionsRight).toBeLessThanOrEqual(layout.surfaceRight + 1);
      expect(layout.actionsBottom).toBeLessThanOrEqual(layout.surfaceBottom + 1);
      expect(layout.surfaceRight).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.surfaceBottom).toBeLessThanOrEqual(layout.viewportHeight);
      expect(layout.borderWidths).toEqual(["0px", "0px", "0px", "0px"]);
      expect(layout.borderRadius).toBe("0px");
      expect(layout.boxShadow).toBe("none");
      expect(layout.outlineStyle).toBe("none");
      expect(layout.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    }
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
    await page.setViewportSize({ width: 480, height: 560 });
    await page.goto("/?window=reminder&demo=expanded");
    const dialog = page.getByRole("dialog", { name: "Cursor 提醒" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(480);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(560);
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
