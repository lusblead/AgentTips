# Phase 2.3 Home Experience Redesign 报告

日期：2026-08-07

## 目标

首页从"Prompt 数据管理后台"（Sidebar + List + Inspector）重构为"我的便签墙"（Tip Grid），Agent 仅作为 metadata，不实现 Phase 3 系统能力。

## 交付物

- **Toolbar**：AgentTips 标题 + 搜索图标（点击展开、Cmd/Ctrl+F 触发、Esc 关闭）+ `+` 新建 + `···`（设置/归档 disabled/关于 disabled）；无永久 Agent 导航，设置降为菜单项。
- **Tip Grid**：`repeat(auto-fill, minmax(220px, 1fr))` 响应式网格，卡高固定 190px（title + content excerpt + Agent metadata 文本 "Cursor · Claude Code · +2"），hover `translateY(-1px)` + shadow 变化 150ms。
- **Pastel Palette**：8 色低饱和 token（light 双套 + dark 深色映射）；颜色由 `stableHash(tip.id) % 8`（FNV-1a）稳定映射，重渲染/筛选/搜索/重启不变；不改 SQLite schema，不做手动选色。
- **Floating Note Editor**：点击卡打开 Dialog-like 浮层（pastel 便签底、轻微 dim、大圆角阴影）；标题/正文自然编辑、绑定 Agent 紧凑列表、overflow menu（归档 disabled/复制/删除）、dirty 显示"还原/保存修改"、clean 显示"已保存"、Esc 关闭后 Grid 与搜索/筛选状态保留。
- **Filter**：Popover 内 Agent 多选（Checkbox）+ 状态（全部/使用中/已归档）；激活后 Toolbar 显示 `Cursor ×` 等 chip，可单项或"清除全部"。
- **Search**：默认不占大面积输入框；结果仍是 Card Grid。
- **Empty Workspace**：空库时首页单一主空态（图标 + 还没有便签 + 创建第一张便签 + Ctrl+F12），删除最后一条后自动清空搜索/筛选回到干净空态。
- **Quick Note**：与便签卡同一设计语言（`pastel-butter` 新便签底）；保留正文+至少一个 Agent 才可保存等全部行为。

## 测试

75 个 Vitest（note-library 重写 17 项 + 既有全部保留；新增覆盖：默认全部卡、无永久 Sidebar/Inspector、Grid、多 pastel tone、颜色稳定、Floating Editor 打开/Esc 关闭、dirty/clean、Popover 筛选、搜索后 Grid、单一空态、设置降级、glyph 清理）+ 23 个 Playwright E2E + 35 个 Rust（零业务变更）。真实 Tauri UI 垂直链路 PASS。

## 截图

`artifacts/screenshots/phase-2.3/` 13 张（真实 Tauri CDP，1000×750；真实 SQLite 播种 12 条演示便签）：home-grid、home-grid-many、home-hover、home-filter-open、home-filtered、home-search、home-empty、note-editor、note-editor-dirty、note-editor-menu、quick-note-empty、quick-note-multiple-agents、settings。像素检查 PASS（尺寸/内容占比/边缘/强调色）。

## 验收

全部命令 PASS（`scripts/acceptance.ps1` 12 步，含 `pnpm test:tauri-ui`）；截图检查 `check-screenshots.ps1 -Directory phase-2.3` PASS。

## 已知限制

- "归档"/"关于"菜单项为 disabled 占位；"复制"用浏览器 clipboard；
- 真实 Tauri 下提醒未启用，reminder 相关截图沿用 Phase 2.2 的 Mock 截图；
- 单窗口阶段窗口路由由 URL 决定，Phase 3 多窗口后合并 WebviewWindow label；
- 颜色稳定映射为 hash（Tip id 稳定）；未来手动选色需新 schema，留待后续。
