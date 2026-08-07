import { expect, test } from "@playwright/test";

/** 正式 LIGHT Palette（与 src/lib/palette.ts NOTE_BG 一致）。 */
const PALETTE_RGB = [
  "rgb(255, 240, 166)", // lemon
  "rgb(255, 215, 181)", // apricot
  "rgb(255, 199, 194)", // coral
  "rgb(247, 198, 220)", // rose
  "rgb(222, 205, 251)", // lavender
  "rgb(201, 214, 255)", // periwinkle
  "rgb(191, 228, 255)", // sky
  "rgb(189, 237, 231)", // aqua
  "rgb(199, 239, 212)", // mint
  "rgb(221, 234, 181)", // sage
];

const CANVAS_RGB = "rgb(245, 247, 250)";

async function noteBackgrounds(page: import("@playwright/test").Page): Promise<string[]> {
  return page
    .locator('[data-testid="tip-card"]')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el as HTMLElement).backgroundColor));
}

test.describe("Living Notes 产品契约", () => {
  test("首页 20 个 Note 的 computed background 全部属于 Palette，且至少 6 色", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/?window=main");
    await expect(page.locator('[data-testid="tip-card"]')).toHaveCount(20);
    const backgrounds = await noteBackgrounds(page);
    const distinct = new Set(backgrounds);
    for (const bg of backgrounds) {
      expect(PALETTE_RGB).toContain(bg);
      expect(bg).not.toBe("rgb(255, 255, 255)");
      expect(bg).not.toBe(CANVAS_RGB);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    }
    expect(distinct.size).toBeGreaterThanOrEqual(6);
  });

  test("1000px viewport 首页 4 列", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/?window=main");
    await expect(page.locator('[data-testid="tip-card"]').first()).toBeVisible();
    const firstRowXs = await page.locator('[data-testid="tip-card"]').evaluateAll((els) => {
      const tops = els
        .map((el) => Math.round(el.getBoundingClientRect().top))
        .sort((a, b) => a - b);
      const firstTop = tops[0];
      return [
        ...new Set(
          els
            .filter((el) => Math.round(el.getBoundingClientRect().top) === firstTop)
            .map((el) => Math.round(el.getBoundingClientRect().x)),
        ),
      ];
    });
    expect(firstRowXs.length).toBeGreaterThanOrEqual(4);
  });

  test("inline body 与 title 无传统输入框外框", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/?window=main");
    const card = page.locator('[data-testid="tip-card"]').first();
    const title = card.getByLabel("标题");
    const body = card.getByLabel("正文");
    await title.focus();
    await expect
      .poll(() => title.evaluate((el) => getComputedStyle(el as HTMLElement).borderTopWidth))
      .toBe("0px");
    await body.focus();
    const bodyStyle = await body.evaluate((el) => {
      const s = getComputedStyle(el as HTMLElement);
      return {
        borderTop: s.borderTopWidth,
        boxShadow: s.boxShadow,
        background: s.backgroundColor,
        outline: s.outlineStyle,
      };
    });
    expect(bodyStyle.borderTop).toBe("0px");
    expect(bodyStyle.background).toBe("rgba(0, 0, 0, 0)");
    expect(bodyStyle.outline).toBe("none");
  });

  test("autosave 650ms 后 caret 不丢失，连续输入成完整文本", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/?window=main");
    const card = page.locator('[data-testid="tip-card"]').first();
    const body = card.getByLabel("正文");
    await body.focus();
    await body.type("ABC");
    await page.waitForTimeout(900);
    await body.type("DEF");
    await expect(body).toHaveValue(/ABCDEF/);
    const focused = await body.evaluate((el) => document.activeElement === el);
    expect(focused).toBe(true);
  });

  test("长正文增高不增宽，下方卡片被挤开", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/?window=main");
    const cards = page.locator('[data-testid="tip-card"]');
    const first = cards.nth(0);
    const before = await first.boundingBox();
    const widthBefore = before!.width;
    // 第一行第二列的卡片（首卡下方邻居）
    const secondTopBefore = await cards
      .nth(1)
      .evaluate((el) => Math.round((el as HTMLElement).getBoundingClientRect().top));
    const body = first.getByLabel("正文");
    await body.fill(Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 行`).join("\n"));
    await page.waitForTimeout(700);
    const after = await first.boundingBox();
    expect(Math.abs(after!.width - widthBefore)).toBeLessThanOrEqual(3);
    expect(after!.height).toBeGreaterThan(before!.height + 80);
    // 卡片增高后，其正下方的 Masonry item 被挤得更远
    const belowMoved = await page.locator('[data-testid="tip-card"]').evaluateAll((els) => {
      const cardsList = els as HTMLElement[];
      const firstBox = cardsList[0].getBoundingClientRect();
      return cardsList
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return (
            Math.abs(b.left - firstBox.left) < 2 &&
            b.top > firstBox.bottom - 4 &&
            b.top < firstBox.bottom + 400
          );
        })
        .map((el) => Math.round(el.getBoundingClientRect().top));
    }, undefined);
    expect(belowMoved.length).toBeGreaterThan(0);
    expect(belowMoved[0]).toBeGreaterThan(secondTopBefore);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("Quick Note：canvas 中性、paper 为 Palette 色", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/?window=quick-note");
    const shell = page.locator('[data-testid="quick-note-shell"]');
    const paper = page.locator('[data-testid="note-surface"]');
    await expect(paper).toBeVisible();
    expect(await shell.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor)).toBe(
      CANVAS_RGB,
    );
    const paperBg = await paper.evaluate(
      (el) => getComputedStyle(el as HTMLElement).backgroundColor,
    );
    expect(PALETTE_RGB).toContain(paperBg);
  });

  test("lemon 与 mint 两次打开 computed 背景不同", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    const gotColor = async (target: string): Promise<string> => {
      for (let i = 0; i < 60; i++) {
        await page.goto("/?window=quick-note");
        const paper = page.locator('[data-testid="note-surface"]');
        await expect(paper).toBeVisible();
        const color = await paper.getAttribute("data-color");
        if (color === target) {
          return paper.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
        }
      }
      throw new Error(`未在 60 次内获得 ${target}`);
    };
    const lemonBg = await gotColor("lemon");
    const mintBg = await gotColor("mint");
    expect(lemonBg).toBe("rgb(255, 240, 166)");
    expect(mintBg).toBe("rgb(199, 239, 212)");
    expect(lemonBg).not.toBe(mintBg);
  });

  test("Used View 有实际 Note，Restore 后回首页且颜色不变", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto("/?window=main");
    const card = page.locator('[data-testid="tip-card"]').first();
    const title = await card.getByLabel("标题").inputValue();
    const colorBefore = await card.getAttribute("data-note-color");
    await card.getByRole("button", { name: "标记已使用" }).click();
    await expect(page.getByTestId("used-toast")).toBeVisible();
    await expect(page.getByLabel("标题").filter({ hasText: title })).toHaveCount(0);

    await page.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "已使用便签" }).click();
    await expect(page.getByRole("heading", { name: "已使用" })).toBeVisible();
    const usedCard = page.locator('[data-testid="tip-card"]').filter({
      has: page.getByLabel("标题", { exact: true }).and(page.locator(`[value="${title}"]`)),
    });
    await expect(usedCard).toHaveCount(1);
    expect(await usedCard.getAttribute("data-note-color")).toBe(colorBefore);

    await usedCard.getByRole("button", { name: "恢复到首页" }).click();
    await expect(page.getByRole("heading", { name: "AgentTips" })).toBeVisible();
    const restored = page.locator('[data-testid="tip-card"]').filter({
      has: page.getByLabel("标题", { exact: true }).and(page.locator(`[value="${title}"]`)),
    });
    await expect(restored).toHaveCount(1);
    expect(await restored.getAttribute("data-note-color")).toBe(colorBefore);
  });
});
