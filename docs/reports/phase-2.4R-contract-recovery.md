# Phase 2.4R Living Notes Product Contract Recovery 报告

日期：2026-08-07

## 1. 颜色不显示的真实根因

`src/lib/palette.ts` 的 `noteColorClass(color)` 返回 `bg-note-${color}` 动态拼接类名。Tailwind v4 JIT 扫描源码时只能看到模板字符串字面量 `bg-note-`，无法推断完整类名（`bg-note-lemon` 等），构建产物 `dist/assets/*.css` 中不存在任何 `bg-note-*` 类；`@theme inline` 中的 `--color-note-*` token 也未生成对应工具类。因此 class 挂到 DOM 上无效果，Note Surface 回落到透明/灰白（接近 `#F5F7FA`）。同类问题也影响 `text-note-text-*` 文本色类。

## 2. 修复方式

- `palette.ts` 重写：显式静态 `NOTE_BG`（10 色 hex）+ `noteStyle(color)` 返回 CSSProperties（backgroundColor + color），组件通过 `style` 属性渲染；删除动态 Tailwind 类；`text-note-text-*` 类全部移除，靠父级 style 继承。
- Note DOM 增加 `data-note-id`、`data-note-color`。
- 首页 Grid 改 `repeat(auto-fill,minmax(220px,1fr))`（content padding 16px、gap 14px）→ 1000px 首行 4 列。
- inline title/body：focus 时 `outline:none`、`ring:0`、`box-shadow:none`、`border:none`、textarea `background:transparent`；整卡 focus-within 仅轻微 shadow。
- Quick Note：外层 `#F5F7FA` + `.quick-note-paper`（max-width 720px、min-height 440px、margin 24 auto、radius 16px、shadow 0 12px 34px）+ textarea 透明；lemon/mint 通过整页重开循环至 `data-color` 命中。
- 删除 Detailed Editor 颜色选择器（保留底层 `tip_update_color` 能力）；Editor `max-height:min(680px,calc(100vh-64px))`，正文区独立滚动，Agent 区与 Footer 固定不被覆盖。

## 3. computed style Palette 验收（E2E）

`e2e/living-notes.spec.ts` 8 项全部通过：

- 20 个 Note computed `backgroundColor` 全部属于 10 色 Palette，无 `rgb(255,255,255)`、无 `rgb(245,247,250)`、无透明；distinct ≥6（实际 10 色种子全覆盖）；
- 1000px viewport 首行 distinct x ≥4；
- inline title/body 无输入框外框（borderTop 0、background transparent、outline none）；
- autosave：输入 ABC → 900ms → DEF → `ABCDEF`，caret 未丢失；
- 长正文增高 >80px、宽度差 ≤3px、无横向 overflow、下方 Masonry item 被挤开；
- Quick Note canvas `rgb(245,247,250)`、paper 为 Palette 色；
- lemon（循环重开命中）与 mint computed 背景分别为 `rgb(255,240,166)` 与 `rgb(199,239,212)` 且不同；
- Used View 有实际 Note、Restore 回首页后 `data-note-color` 不变。

## 4. Screenshot pixel diff 验收（scripts/check-note-colors.ps1）

- `home-color-wall-many.png`：6 种 Palette 大面积色（periwinkle/sage/aqua/mint/lavender/apricot）PASS；
- `quick-note-lemon.png`：Lemon 像素 142722（>10000）PASS；
- `quick-note-mint.png`：Mint 像素 142722（>10000）PASS；
- lemon vs mint 真实像素 diff 145722 > 0（两图内容不同）PASS。

`scripts/check-screenshots.ps1 -Directory phase-2.4R`：12 张尺寸/内容占比/边缘全部 PASS。

## 5-11. 各项验收

- 4 列：E2E ≥4 distinct x；home-four-columns.png 与 wall 同布局（14 张未使用卡）。
- inline title/body：E2E 断言无外框；home-inline-title/body 截图。
- autosave caret：E2E ABC→DEF 焦点保持。
- variable height：E2E 增高不增宽 + 下方卡片下移；home-long-note.png（15 行）。
- Quick Note paper：canvas 中性 + paper 实色；quick-note-lemon/mint/multiple-agents。
- Used 非空 View：真实 Tauri seed 6 张不同色 used Tip，USED_COUNT=6，used-notes.png；used-notes-empty.png（浏览器 Mock 空态）。
- Detailed Editor 收缩：删除颜色选择器、max-height 与滚动修复；note-detail.png。

## 12-13. 自动测试与工程命令

- Vitest 87、Playwright 32（+8 living-notes 契约）、Rust 43；
- `scripts/acceptance.ps1` 12 步全 PASS（含 `pnpm test:tauri-ui` 真实 WebView 全链路：创建彩色 Tip → 首页直编 → autosave → 15 行卡变高 → Mark Used → Used View 同色 → Restore → 重启后颜色与正文保留 → 删除 → 错误路径）；
- `pnpm check:architecture`、format、lint、typecheck、build、cargo fmt/check/clippy/test 全部 PASS。

## 14. Screenshot

`artifacts/screenshots/phase-2.4R/`（12 张）：home-color-wall-many、home-four-columns、home-inline-title、home-inline-body、home-long-note、home-note-hover、quick-note-lemon、quick-note-mint、quick-note-multiple-agents、used-notes、used-notes-empty、note-detail。

## 15-16. Git diff 与 commit

修复集中在 React 视觉层（palette.ts、TipCard、Quick Note、NoteEditorDialog、note-library）、E2E 契约测试、像素验收脚本与截图。Rust/SQLite 无业务变更（43 Rust 测试不变）。commit `fix: align living notes UI with product contract`，tag `phase-2.4r-product-baseline`。

## 已知限制

- `view_image` 在本会话不可用，人工视觉检查以像素统计（面积占比、Palette RGB 计数、图片 diff、边缘检查）替代，已覆盖"颜色真实出现"的核心验收；
- 颜色修改不再暴露于 UI（第一版自动分配，底层能力保留）；
- 仍为单窗口阶段，下一阶段必须进入 Phase 3。
