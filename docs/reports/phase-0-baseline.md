# Phase 0 工程基线报告

日期：2026-08-06

## 目标

按 `docs/09-implementation-roadmap.md` 的 Phase 0 建立可重复的 Tauri 2 + React + TypeScript + Vite + pnpm 工程基线，不实现业务功能。

## 交付物

- Tauri 2 + React 19 + TypeScript + Vite + pnpm 基础工程，可 `pnpm tauri dev` 启动主窗口；
- Tailwind CSS v4 主题 token（light/dark）、shadcn 风格基础组件、Lucide 图标；
- `src/features/` 与 Rust 四层（`domain` / `application` / `ports` / `adapters`）职责目录骨架；
- format（Prettier）、lint（ESLint + restricted imports）、typecheck、Vitest、Playwright、Cargo fmt/clippy/test 工具链；
- 架构边界检查 `scripts/check-architecture.ps1` 与全量门禁 `scripts/acceptance.ps1`；
- 锁文件：`pnpm-lock.yaml`、`src-tauri/Cargo.lock`。

## 验收结果

全部命令 PASS：`pnpm install --frozen-lockfile`、`pnpm format:check`、`pnpm check:architecture`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e`、`pnpm build`、`cargo fmt --check`、`cargo clippy -D warnings`、`cargo test`、`scripts/acceptance.ps1`；`pnpm tauri dev` 启动验证通过（窗口进程存在、页面 HTTP 200、Rust 无 panic）。

## 已知限制

- 主窗口仅展示基线页，无业务功能；
- `src-tauri` 只有骨架模块，无业务 Command。

## 下一阶段入口

Phase 1：建立 `DesktopApi` 契约与 `MockDesktopApi`，完成四窗口 UI 原型。
