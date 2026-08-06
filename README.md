# AgentTips

面向桌面与终端 AI Agent 的 Windows 本地便签工具：用可录制的全局快捷键快速创建便签，绑定到一个或多个 Agent，并在对应 Agent 激活时按规则自动展示相关便签。

> 产品范围、冻结边界与完整设计见 [`AgentTips-Design-Package/`](AgentTips-Design-Package/README.md)。MVP 技术路线固定为 Tauri 2 + React + TypeScript + Rust + SQLite，**不实现**浏览器 Agent、LLM API、云同步、自动发送等能力。

## 当前状态

**Phase 0（工程基线）已完成**：Tauri 2 + React 19 + TS + Vite + pnpm 工程、Tailwind v4 主题 token、shadcn 风格组件、Rust 四层骨架、架构检查与全量验收脚本。

**Phase 1（Mock 驱动 UI 原型）已完成**，**Phase 1.5（视觉与交互收束）已完成**，**Phase 2（真实垂直链路）已完成**（2026-08-06）：

- `DesktopApi` 契约 + `MockDesktopApi`（数据可预测、支持 reset 与模拟失败/延迟）；
- 快捷新建窗口：每次空白、多 Agent 绑定与独立默认携带开关、`Ctrl+Enter` 保存、防重复提交、失败保留输入；
- 主管理窗口三栏：Agent 筛选、搜索、详情编辑、删除确认、空态/无结果/加载/错误态；
- Agent 提醒窗口：聚合展示、展开/收起/胶囊、本次忽略、"查看全部"（按 Agent 过滤进入主窗口）；
- 设置页快捷键录制：`Ctrl + 单键` 规则、额外修饰键拒绝、Esc/点击外部取消、冲突警告，全部只走 Mock；
- 浏览器调试入口：`/?window=quick-note|main|reminder|settings`（提醒支持 `&demo=collapsed|empty`，主窗口支持 `&empty=1`、`&agentId=`）；
- 34 个 Vitest 组件/架构测试 + 17 个 Playwright E2E（交互、截图、布局溢出、控制台无错误）。
- Phase 1.5：统一中文文案与“提示”称呼；视觉 Token（正文 14px / 辅助 13px / 标题 17px，圆角 7-8-12px，动效 150ms）；主窗口增加新建/设置入口、默认选中第一条、Agent 数量、统一空态；快捷窗口绑定行一体化；提醒窗口轻量列表与折叠动画；设置页区分当前快捷键与录制候选、显示实际检测组合；截图更新至 `artifacts/screenshots/phase-1.5/`。
- Phase 2：打通 Tip / Agent / 多 Agent 绑定的 React → Tauri → Rust → SQLite 真实垂直链路；Rust 按 domain/application/ports/adapters/commands/bootstrap 分层；SQLite migration + 内置 Agent 幂等种子；事务化创建/修改/删除；`TauriDesktopApi` 生产适配器由 App 组合根选择；结构化错误（`DesktopError`）；62 个 Vitest 测试 + 30 个 Rust 测试 + 21 个 Playwright E2E；WebView2 CDP 自动化验证真实 invoke 链路（创建→读回→修改→删除→重启持久化）。

**尚未实现（后续 Phase）**：真实全局快捷键注册与设置持久化、多窗口生命周期、托盘、单实例、开机启动、Agent 检测、15 分钟冷却提醒、提醒运行时（`previewHotkey` / `getReminderPreview` 在 Tauri 端明确未实现）。

## 快速开始

```bash
pnpm install
pnpm tauri dev
```

浏览器调试（无需 Tauri）：

```bash
pnpm dev
# 打开 http://localhost:1420/?window=quick-note 等
```

## 验收命令

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm check:architecture
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

一键全量门禁：

```powershell
./scripts/acceptance.ps1
```

## 目录结构

```text
src/
├── desktop-api/          DesktopApi 契约、MockDesktopApi、窗口上下文适配器
├── features/             功能模块（quick-note / note-library / reminder / hotkey-settings）
├── components/
│   ├── ui/               shadcn 风格基础组件
│   └── shared/           feature 间复用组件
├── lib/                  通用工具
├── styles/               主题 token
└── test/                 Vitest 架构静态检查
e2e/                      Playwright 交互 / 截图 / 布局测试
artifacts/screenshots/phase-1.5/  Phase 1.5 UI 截图
src-tauri/
├── src/{domain,application,ports,adapters,commands}/  Phase 2 业务实现
├── migrations/           SQLite migration（0001_init.sql）
└── capabilities/         最小权限（core:default）
scripts/                  check-architecture.ps1、acceptance.ps1
                          vertical-chain-verify.mjs（WebView2 CDP 真实链路验证）
```

## 已知限制

- 浏览器模式全部数据来自 MockDesktopApi，重启即重置；Tauri 模式使用 `TauriDesktopApi` + SQLite（`%APPDATA%/com.agenttips.app/agenttips.sqlite3`）；
- `previewHotkey` / `getReminderPreview` 在 Tauri 端明确未实现，设置页在 Tauri 模式下会提示；
- 浏览器模式下"关闭"快捷窗口依赖 `window.close()`，被浏览器限制时无效（Tauri 阶段由真实窗口生命周期接管）；
- 截图与交互测试使用固定 Mock 数据与固定 viewport，无随机时间；
- Rust 侧保持 Phase 0 骨架，未新增任何业务实现。
