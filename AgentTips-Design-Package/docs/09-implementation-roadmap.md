# 09. 实施路线图

## 总原则

先完成可独立预览和自动测试的 UI，再接入真实 Tauri 和 Windows 检测。每个阶段都必须可运行，不一次性生成全部代码。

## Phase 0：仓库勘察与基线

目标：确认仓库当前状态，建立可重复的工具链。

交付：

- Tauri 2 + React + TypeScript + Vite 基础工程；
- pnpm 与 Rust 锁文件；
- format、lint、typecheck、unit test、build 脚本；
- 基础目录、ports/adapters 模块骨架和 CI；
- 架构边界检查脚本或 lint restricted imports；
- 不实现业务功能。

退出条件：所有基线命令通过，AT-ARCH 的静态边界检查具备可执行入口。

## Phase 1：Mock 驱动 UI

目标：在浏览器模式下完成高质量 UI，不依赖 Rust 后端。

交付：

- `DesktopApi` 接口和 `MockDesktopApi`；
- 快捷窗口；
- 主窗口三栏布局；
- 提醒窗口；
- 深浅主题；
- UI 状态、错误态和截图；
- 设置页 HotkeyRecorder 的 Mock 交互与状态机；
- Playwright 核心流程。

退出条件：设计文档要求的 UI 场景都有测试与截图。

## Phase 2：领域与 SQLite

目标：实现可靠的数据模型。

交付：

- Rust 领域实体与校验，包括 HotkeyBinding/HotkeyPolicy；
- migrations；
- Tip、Agent、Binding repository；
- CRUD Commands 与 settings_get_hotkey/settings_update_hotkey 契约（Phase 2 使用 Fake registrar 或只完成用例层）；
- 前端 Tauri adapter；
- SQLite 集成测试。

退出条件：CRUD、事务、迁移验收通过，React 不直接 SQL。

## Phase 3：多窗口、快捷键和托盘

目标：形成真正桌面产品骨架。

交付：

- `main`、`quick-note`、`reminder` 三窗口；
- 默认 `Ctrl + F12` 全局快捷键；
- 点击录制、捕获 `Ctrl + 单键`、Rust 二次校验和系统注册；
- 托盘菜单；
- 单实例；
- 关闭到托盘；
- 窗口状态持久化；
- 快捷键冲突、高冲突确认、持久化失败补偿和重启恢复。

退出条件：AT-HK 全部通过；连续 50 次唤起/隐藏无崩溃；窗口职责正确；更新失败时旧快捷键仍可用。

## Phase 4：检测规则引擎

目标：先完成纯逻辑和 fixture，再接 Windows 快照。

交付：

- `ForegroundSnapshot`；
- 规则评分；
- 桌面与终端匹配；
- 歧义处理；
- built-in rules；
- 检测诊断 UI；
- fixture 测试。

退出条件：AT-DET 全部通过。

## Phase 5：Windows 前台与进程树

目标：接入真实 Windows 系统能力。

交付：

- 前台窗口、PID、标题、类名、路径；
- 终端相关进程树；
- 500 ms 轮询与 750 ms 去抖；
- 安全降级和日志；
- 原生冒烟说明。

退出条件：桌面 Agent 前台/后台行为正确，终端不以 Node 作为单一判断。

## Phase 6：提醒状态机

目标：实现完整自动携带逻辑。

交付：

- FakeClock；
- 15 分钟冷却；
- Agent 独立状态；
- 聚合 payload；
- 成功显示后更新时间；
- 全局暂停和 Agent 开关；
- 恢复与边界测试。

退出条件：AT-REM 全部通过。

## Phase 7：集成、性能与发布

目标：形成可安装 MVP。

交付：

- 完整 acceptance 脚本；
- GitHub Actions；
- Tauri debug/release build；
- 安装包；
- 日志和诊断导出；
- README、隐私说明、已知限制；
- Windows 原生冒烟报告。

退出条件：自动验收全绿，人工冒烟无阻断项。

## 横向架构门禁（每个 Phase 都适用）

- 新功能放入明确 feature/domain/application/adapter 模块；
- 不建立万能 `AppService`、`utils.rs` 或跨模块全局状态；
- 所有外部系统能力先定义 port，再实现 adapter；
- 新增 Agent 规则不应修改检测算法；
- 前端 feature 不直接 import 其他 feature 私有文件；
- 每个 Phase 运行 AT-ARCH 检查。

## Future Work（不得在 MVP 提前实现）

- CLI Wrapper 主动上报终端 Agent；
- Agent + 项目/工作目录绑定；
- MCP Server；
- 浏览器扩展；
- 云同步；
- macOS/Linux；
- AI 整理和提示词演化。
