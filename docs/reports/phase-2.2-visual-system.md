# Phase 2.2 Visual System & Premium Desktop Polish 报告

日期：2026-08-07

## 目标

不增加业务功能，将 AgentTips 从"干净可用的 Web/CRUD 工具"提升为具有明确桌面产品质感的效率工具：Quiet / Precise / Compact / Desktop-native / Layered / Minimal / Premium。

## 交付物

### Design System（`src/styles/globals.css`）

统一语义 Token（light/dark 双套）：`surface-canvas/primary/secondary/hover/selected`、`text-primary/secondary/muted/disabled`、`border-subtle/default/strong`、`accent/accent-hover/accent-subtle/accent-ring`、`danger/danger-subtle`、`radius-sm(7)/md(8)/lg(10)/window(12)`、`shadow-floating/popover`；字体栈 `Segoe UI Variable → Microsoft YaHei UI → system-ui`；字号 page-title 17/600、section 14/600、body 14、secondary 13、caption 12；动效统一 150ms 并保留 `prefers-reduced-motion`。

### 主管理窗口

- Sidebar：背景层级区分（不再依赖粗分隔线），Agent 使用 Lucide Monitor/Terminal 图标，count 弱化为 caption；
- 列表：轻量 list item（无独立卡片边框），spacing + subtle separator，hover `surface-hover`，selected `surface-selected` + 左侧 2px accent 指示条；
- Inspector：标题/正文直接编辑式（无传统 Input/Textarea 边框感），绑定 Agent 紧凑列表，Delete 移入 `···` overflow menu（归档/复制/删除），dirty state 才显示"还原/保存修改"，clean 显示"已保存"；
- 空库：统一 Empty Workspace（中栏唯一空态，右栏不再重复）。

### Quick Note

浮动命令工具化；保存条件改为"正文非空 **且** 至少绑定一个 Agent"（未满足时显示轻量"请至少绑定一个 Agent"）；focus 使用 subtle border + soft accent ring；绑定行一行式（名称 + 默认携带开关 + 移除）；多 Agent 限高滚动；选 Agent 后焦点回正文（避免 Ctrl+Enter 被菜单 trigger 捕获）。

### Settings

正式 Settings shell：左侧导航（快捷键可用，常规/提醒/数据/关于为 disabled 占位"即将提供"）+ 右侧内容；快捷键页保留当前快捷键/重新录制/录制状态/错误状态；未接入系统注册时显示中性"该能力将在系统功能启用后生效"。

### Reminder

未启用时 neutral info state（"不提供预览"/"自动提醒将在系统功能启用后生效"），不再红字居中；轻量分隔列表与折叠胶囊保留。

## 测试

71 个 Vitest（新增 8：0 Agent 禁存、正文+Agent enabled、clean/dirty、删除非红色常驻、glyph 检查、空态唯一、Settings 导航 2）+ 23 个 Playwright E2E + 35 个 Rust（零业务变更）。

## 截图

`artifacts/screenshots/phase-2.2/` 13 张：真实 Tauri CDP 11 张（main-window/hover/editing/empty、quick-note empty/filled/multiple-agents、settings default/recording/invalid、reminder-degraded）+ 浏览器 Mock 2 张（reminder-expanded/collapsed，固定 viewport 420×360）；`check-screenshots.ps1 -Directory phase-2.2` 像素检查 PASS（尺寸/内容占比/边缘/console）。

## 验收

全部命令 PASS（见 `scripts/acceptance.ps1`，含 `pnpm test:tauri-ui`）；真实 Tauri UI 垂直链路 PASS（创建/读回/重启持久化/修改/删除/错误路径/降级）。

## 已知限制

- "归档"菜单项为 disabled 占位（无对应能力，不伪装可用）；"复制"使用浏览器 clipboard；
- reminder-expanded/collapsed 需提醒数据，真实 Tauri 下提醒未启用，故由浏览器 Mock 生成；
- 单窗口阶段窗口路由由 URL 决定，Phase 3 多窗口后合并 WebviewWindow label。
