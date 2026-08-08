# Phase 2.4 Living Notes 报告

日期：2026-08-07

## 目标

彩色便签、首页直接编辑、自适应高度、已使用收纳。严格遵循"桌面上放着许多彩色便签纸"隐喻；颜色可修改（用户补充要求）。

## 交付物

### Note Palette

正式 10 色（light 固定 hex + dark 固定映射）：lemon/apricot/coral/rose/lavender/periwinkle/sky/aqua/mint/sage；Note 文本 #243044/#5F6C80，border rgba(36,48,68,.06)，shadow 0 6px 18px/hover 0 10px 28px，radius 14px；任何 Tip 不使用白/透明/surface-primary 作为 Note Surface。含 `src/lib/palette.test.ts`。

### Color 分配算法

创建时由 `note_color_suggest`（Rust NoteColorService）随机分配：排除最近 2 张 Tip 的颜色后从 Palette 随机；Quick Note 打开即获得 `draftColorKey`（每次重新请求），保存时提交；调用方未提供时 Rust `createTip` 兜底同规则。**颜色可在 Detailed Editor 修改**（`tip_update_color`），修改后持久化。

### SQLite Migration

`0002_living_notes.sql`：`ALTER TABLE tips ADD COLUMN color_key TEXT NOT NULL DEFAULT 'lemon'`、`ADD COLUMN used_at TEXT`；升级时 Rust 端确定性 backfill（FNV-1a hash id % 10），迁移完成后不再重算。

### Quick Note

中性 canvas（`surface-canvas`）+ 彩色 Note Surface（draftColorKey）+ transparent textarea；保留全部业务行为（正文+至少一个 Agent 才可保存等）。

### Home Inline Editing

NoteCard 标题/正文 WYSIWYG 直编；650ms debounce autosave + blur flush；成功静默、失败在卡底显示"保存失败 · 重试"且输入保留；`tip_update_text` 只改 title/content/updated_at，不触碰 bindings/color/usedAt/status。

### Variable Height & Masonry

AutoGrowTextarea（height:auto + scrollHeight）；CSS Grid `repeat(auto-fill,minmax(236px,248px))` + `grid-auto-rows:8px` + ResizeObserver 设置 `grid-row-end: span N`；卡片 min-height 168px 向下生长、宽度固定、无内部滚动条。

### Used Lifecycle

Mark Used（CircleCheck）→ 160ms 动画移除 + Toast"已移至「已使用」"+ 5s Undo；独立 Used View（··· → 已使用便签）显示同色卡、Restore（RotateCcw）回首页且颜色不变；`tip_mark_used`/`tip_restore_used` 维护 `used_at`；首页默认 `used_at IS NULL`。

## 测试

- Rust 43（新增 backfill 多色、used 过滤/mark/restore 往返、update_text 不触其他字段、update_color、颜色建议排除最近 2 色等）；
- Vitest 86（Palette、inline autosave、autosave 失败保留、颜色可改、Used/Restore/Undo、Quick Note 中性 canvas+彩色纸+suggest 每次请求、0 Agent 禁存等）；
- Playwright 24（含 masonry 自适应高度、无横向溢出、used-notes-empty）。
- 真实 Tauri UI 全链路 PASS：创建彩色 Tip → 首页直编正文 → autosave → 输入 15 行卡变高 → Mark Used → Used View 同色 → Restore → 重启后颜色与正文保留 → 删除 → 错误路径。

## 截图

`artifacts/screenshots/phase-2.4/`（12 张，真实 Tauri CDP 1000×750，20 条演示 Tip）：home-color-wall / home-color-wall-many / home-variable-height / home-inline-editing / home-note-hover / home-long-note / used-notes / used-notes-empty（浏览器 Mock 补）/ quick-note-lemon / quick-note-mint / quick-note-multiple-agents / note-detail。像素检查 PASS。

## 已知限制

- 颜色修改在 Detailed Editor 内完成（首页卡不直接改色）；
- used-notes-empty 在浏览器 Mock 生成（真实 Tauri 下恢复后自动回首页，Used View 不驻留）；
- 仍为单窗口阶段，多窗口/快捷键/提醒等 Phase 3+ 能力未实现。
