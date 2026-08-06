# Phase 1 UI 产品原型报告

日期：2026-08-06

## 目标

React 前端产品原型 + MockDesktopApi + 四个窗口的视觉交互，不实现 SQLite / Tauri Command / 真实快捷键 / Agent 检测。

## 交付物

- `DesktopApi` 契约与 `MockDesktopApi`（数据可预测、支持 reset、模拟失败与保存延迟）；
- 快捷新建窗口（`/?window=quick-note`）：空白输入、多 Agent 绑定与独立默认携带、Ctrl+Enter 保存、防重复、失败保留输入；
- 主管理窗口（`/?window=main`）：三栏布局、Agent 筛选、搜索、详情编辑、删除确认、空态/无结果/加载/错误态；
- Agent 提醒窗口（`/?window=reminder`）：聚合展示、展开/收起/胶囊、本次忽略、查看全部；
- 设置页快捷键录制（`/?window=settings`）：Ctrl+单键规则、额外修饰键拒绝、Esc/点击外部取消、冲突警告；
- 浏览器调试入口统一由 `desktop-api/window-context.ts` 适配器解析，feature 不读 URL。

## 视觉与交互收束（Phase 1.5）

- 统一中文文案与"提示"称呼，移除全部开发阶段说明；
- 视觉 Token：正文 14px / 辅助 13px / 标题 17px，圆角 7-8-12px，动效 150ms；
- 主窗口：新建/设置入口、默认选中第一条、Agent 数量统计、统一首用空态；
- 快捷窗口：Agent 绑定行一体化（名称 + 默认携带 + 移除），多绑定限高滚动；
- 提醒窗口：轻量分隔列表、折叠胶囊、150ms fade-in；
- 设置页：当前快捷键与录制候选分离、显示实际检测组合、简短规则。

## 测试结果

- Vitest：43 个组件/架构测试全过；
- Playwright E2E：21 个（交互、截图、布局溢出、控制台无错误）全过；
- 截图：`artifacts/screenshots/phase-1.5/` 11 张，像素级检查通过（尺寸、内容占比、边缘裁切、强调色）。

## 已知限制

- 全部数据来自 MockDesktopApi，重启即重置；
- `previewHotkey`、`getReminderPreview` 仅 Mock，未接真实实现；
- Rust 侧无业务代码。

## 下一阶段入口

Phase 2：打通 Tip / Agent / 多 Agent 绑定的 React → Tauri → Rust → SQLite 真实垂直链路。
