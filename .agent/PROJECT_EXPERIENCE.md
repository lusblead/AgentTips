# AgentTips - AI 项目经验簿

> 只记录未来 Agent 修改本项目时必须知道、且已被当前代码或测试验证的事实。
> 本文件不是产品文档、任务日志或 Prompt 集；面向使用者的公开说明只维护根目录 `README.md`。

- 项目 ID：`agenttips`
- 项目类型：`desktop-app`、`frontend-web`
- 主要平台：Windows
- 技术栈：Tauri 2、Rust、React 19、TypeScript、SQLite、pnpm
- 文档状态：active
- 最近整理：2026-08-08

## 0. 快速索引

| ID            | 主题                       | 触发信号                               | 作用域                                     | 状态   | 最后验证   |
| ------------- | -------------------------- | -------------------------------------- | ------------------------------------------ | ------ | ---------- |
| `PX-WF-001`   | 公开仓库内容边界           | 新增文档、Prompt、报告、截图或生成物   | repository                                 | active | 2026-08-08 |
| `PX-ARCH-001` | 前后端依赖边界             | 修改 feature、Desktop API 或 Rust 模块 | `src/**`、`src-tauri/src/**`               | active | 2026-08-08 |
| `PX-DATA-001` | SQLite 与事务不变量        | 修改 Tip、Tag、Agent 绑定或 migration  | `src-tauri/migrations/**`、SQLite adapters | active | 2026-08-08 |
| `PX-WF-002`   | 快捷便签产品契约           | 修改 Quick Note、标签或关闭行为        | quick-note、window manager                 | active | 2026-08-08 |
| `PX-OPS-001`  | Windows 窗口与快捷键运行时 | 修改窗口、托盘、单实例或热键           | Tauri runtime                              | active | 2026-08-08 |
| `PX-OPS-002`  | Agent 检测与提醒           | 修改桌面/终端检测或冷却逻辑            | detection、terminal、reminder              | active | 2026-08-08 |
| `PX-TEST-001` | 验证与用户数据隔离         | 运行测试、验收或发布                   | tests、e2e、scripts                        | active | 2026-08-08 |

## 1. 项目不变量与高优先级约束

### PX-WF-001：公开仓库只保留实现、验证与用户 README

- 状态：active
- 证据等级：direct
- 作用域：整个仓库
- 触发条件：新增或提交 Markdown、Prompt、设计包、阶段报告、截图、演示素材或生成产物
- 标签：`repository-hygiene`、`publishing`
- 最后验证：2026-08-08

#### 当前项目的正确做法

1. 根目录 `README.md` 是唯一面向使用者的公开项目说明。
2. `.agent/PROJECT_EXPERIENCE.md` 是用户明确授权的 Agent 内部项目上下文。
3. 保留影响实现或可靠验证的源码、迁移、配置、锁文件、测试和运行验证脚本。
4. 不重新加入 `AgentTips-Design-Package/`、`docs/`、截图资产、Prompt 集、阶段报告或纯截图生成/检查工具。
5. `src-tauri/icons/` 是安装包运行资产，不属于应删除的截图。

#### 最短安全路径

- 提交前：运行 `git status --short` 和 `git diff --cached --name-only`，显式确认文件边界。
- 内容检查：除根 README、`.agent` 和应用图标外，检查是否意外加入 `.md` 或图片资产。
- 发布后：再次检查远程分支和工作区，不能使用 `git add -A` 吞入无关目录。

#### 避免与失败方法

- 不要把内部阶段记录改写成公开 README；README 应围绕价值、安装、使用、数据与隐私、排障和当前边界。
- 不要为了展示 UI 而提交生成截图；视觉回归应优先使用行为和布局断言。

## 2. 架构与模块边界

### PX-ARCH-001：React 通过 DesktopApi 访问原生能力，Rust 保持端口分层

- 状态：active
- 证据等级：direct
- 作用域：`src/**`、`src-tauri/src/**`、`scripts/check-architecture.ps1`
- 触发条件：新增 feature、Tauri command、SQLite/Windows 能力或跨模块依赖
- 标签：`architecture`、`tauri`、`ports-adapters`
- 最后验证：2026-08-08

#### 当前项目的正确做法

1. React feature 只调用 `src/desktop-api/contract.ts` 定义的 `DesktopApi`，不能直接调用 Tauri `invoke` 或读取 SQLite。
2. `TauriDesktopApi` 是生产适配器；浏览器开发和 Playwright 使用 `MockDesktopApi`。
3. Rust 依赖方向是 `domain -> application/ports <- adapters/commands`；domain 不依赖 Tauri、SQLite 或 Windows API。
4. 组合根位于 `src/App.tsx` 与 `src-tauri/src/lib.rs`，不要把业务规则堆进这两个入口。
5. 业务校验由 Rust 领域/应用层权威执行；前端校验用于及时反馈，不能成为唯一约束。

#### 最短安全路径

- 新原生能力：先扩展最小 `DesktopApi` / Rust port，再实现 adapter 与 command，最后接入 feature。
- 快速验证：`pnpm check:architecture`、`pnpm typecheck`。
- 完整验证：前端测试、Rust 测试、Playwright 和相关 Windows runtime test。

#### 可复用资产与证据

- 前端契约：`src/desktop-api/contract.ts`
- Tauri 适配器：`src/desktop-api/tauri-adapter.ts`
- Rust 组合根：`src-tauri/src/lib.rs`
- 架构门禁：`scripts/check-architecture.ps1`、`src/test/architecture.test.ts`

## 3. 数据、事务与一致性

### PX-DATA-001：Tip、Tag 与 Agent 绑定必须原子保存

- 状态：active
- 证据等级：direct
- 作用域：`src-tauri/migrations/**`、`src-tauri/src/adapters/sqlite.rs`、tips domain/application
- 触发条件：修改便签创建/更新、标签复用、Agent 绑定、颜色、已使用状态或数据库迁移
- 标签：`sqlite`、`transaction`、`migration`、`tags`
- 最后验证：2026-08-08

#### 当前项目的正确做法

1. SQLite migration 按版本顺序执行，单个版本的 DDL 与 `schema_migrations` 记录在同一事务中。
2. 创建或完整更新 Tip 时，Tip 主记录、`tip_agents` 和 `tip_tags` 必须在同一事务提交；任一失败都不得留下部分数据。
3. 新建快捷便签默认无标题，数据库 `tips.title` 保持 `NULL`，不能从正文第一行派生标题。
4. 标签由用户自由输入；领域层负责 trim、空白折叠、大小写无关去重和长度/数量校验。
5. `tags.normalized_name` 唯一；历史标签按最近更新时间返回，供前端复用。
6. 正式数据库位于 `%APPDATA%\com.agenttips.app\agenttips.sqlite3`；时间字段使用 UTC RFC 3339。
7. Release 构建忽略 `AGENTTIPS_TEST_DATA_DIR`；该变量只允许 debug/test 构建隔离测试数据库。

#### 最短安全路径

- migration 只新增版本文件并登记到 `MIGRATIONS`，不要修改已发布版本的语义。
- 数据变更至少覆盖 migration、事务回滚、重开持久化和旧数据兼容测试。
- 快速验证：`cargo test --manifest-path src-tauri/Cargo.toml`。

#### 避免与失败方法

- 不要在 React 中执行 SQL或复制标签规范化规则作为权威实现。
- 不要把 Tag 或 Binding 写入拆成独立提交，否则失败时会产生不完整便签。
- 不要让测试访问正式 `%APPDATA%` 数据库。

## 4. 快捷便签与窗口契约

### PX-WF-002：Quick Note 保持紧凑、无标题且防丢稿

- 状态：active
- 证据等级：direct
- 作用域：`src/features/quick-note/**`、`src/components/shared/TagInput.tsx`、`src-tauri/src/adapters/tauri_window_manager.rs`
- 触发条件：修改快捷便签布局、标签输入、保存、重开或关闭路径
- 标签：`quick-note`、`ux-contract`、`draft-safety`
- 最后验证：2026-08-08

#### 当前项目的正确做法

1. Quick Note 默认 `440 x 380`，最小 `380 x 320`，最大 `620 x 520`；不要恢复成覆盖大面积桌面的窗口。
2. 新建界面只有正文，不显示标题输入；正文使用无边框的便签表面。
3. 内容非空即可保存，Agent 绑定可选；未按 Enter 提交的标签输入也必须参与最终保存。
4. 标签输入支持自由键入以及复用历史标签；不要改成固定枚举或只能选择的下拉框。
5. 正文、标签草稿或 Agent 绑定存在时，Esc、界面关闭按钮和系统标题栏关闭都必须进入同一放弃确认。
6. 保存成功后短暂显示成功状态，再隐藏窗口并清空 draft；保存失败必须保留输入。
7. 窗口已经可见时再次触发快捷键只聚焦，不清空正在编辑的 draft。

#### 快速验证

- `pnpm test -- src/features/quick-note/quick-note.test.tsx`
- `pnpm test:e2e -- e2e/layout.spec.ts e2e/phase1.spec.ts`
- `pnpm test:windows-runtime`

## 5. Windows 运行时

### PX-OPS-001：窗口、全局快捷键、托盘和退出语义统一由 Rust 协调

- 状态：active
- 证据等级：direct
- 作用域：window manager、hotkey runtime、Tauri composition root
- 触发条件：修改窗口生命周期、快捷键切换、系统托盘、单实例或退出行为
- 标签：`windows`、`hotkey`、`window-lifecycle`
- 最后验证：2026-08-08

#### 当前项目的正确做法

1. 默认全局快捷键为 `Ctrl + F12`；合法组合严格为 `Ctrl + 一个受支持的非修饰键`。
2. 更新快捷键的顺序必须保证失败时旧快捷键仍可用；录制期间需要抑制当前快捷键触发。
3. `main`、`settings`、`reminder` 的普通关闭语义是隐藏；Quick Note 先请求草稿确认；只有显式退出才真正关闭应用。
4. 同一 label 的窗口懒创建并复用，避免重复窗口；第二实例只唤醒第一实例主窗口。
5. 系统托盘提供打开主窗口、新建便签、设置和退出入口。

#### 快速验证

- `pnpm test:windows-runtime`
- `pnpm test:global-hotkey`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### PX-OPS-002：Agent 检测驱动提醒，冷却只在成功展示后消耗

- 状态：active
- 证据等级：direct
- 作用域：detection、terminal、reminder application/adapters
- 触发条件：新增 Agent、修改进程识别、提醒资格、冷却或显示状态
- 标签：`agent-detection`、`reminder`、`cooldown`
- 最后验证：2026-08-08

#### 当前项目的正确做法

1. 桌面识别目标：ChatGPT、Cursor、Trae；终端识别目标：Codex、Claude Code、OpenCode。
2. 桌面规则基于前台进程名、路径和窗口身份；终端规则基于前台终端的进程树、可执行文件和命令 marker。
3. 新增 Agent 应新增规则与 fixture，不复制整套 detector。
4. 提醒只查询该 Agent 当前 active 且 `auto_attach=true` 的便签。
5. 默认冷却 15 分钟，可配置 1～120 分钟，并按 Agent 独立记录。
6. 没有合格便签、窗口未成功展示或展示失败时不能消耗冷却；成功展示后先写进程内状态，再尽力持久化。
7. 系统时间回拨时保持冷却，避免提醒风暴。

#### 快速验证

- `pnpm test:desktop-detection`
- `pnpm test:terminal-detection`
- `pnpm test:reminder-runtime`
- `cargo test --manifest-path src-tauri/Cargo.toml`

## 6. 测试、发布与故障恢复

### PX-TEST-001：区分浏览器测试、Rust 测试与真实 Windows 验收

- 状态：active
- 证据等级：direct
- 作用域：`src/**/*.test.*`、`e2e/**`、`scripts/**`、`src-tauri/src/**`
- 触发条件：声称功能完成、修复回归、发布或修改原生能力
- 标签：`testing`、`release`、`data-safety`
- 最后验证：2026-08-08

#### 当前项目的正确做法

1. Vitest/浏览器 Playwright 主要验证 React、Mock adapter、布局和交互，不证明真实 Tauri/SQLite/Windows 行为。
2. Rust 测试验证领域规则、迁移、repository 和事务。
3. Windows runtime scripts 验证真实窗口、快捷键、桌面/终端检测和提醒链路；每次运行使用独立测试数据目录。
4. `scripts/check-user-db-untouched.mjs` 在完整验收前后校验正式用户数据库未被修改。
5. `scripts/acceptance.ps1` 会强制结束 `agent-tips`、Windows Terminal、OpenConsole、Notepad 以及占用 1420 端口的进程；只有明确接受该副作用时才能运行。

#### 推荐验证顺序

```text
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
相关 pnpm test:* Windows runtime 命令
```

#### 避免与失败方法

- 不要把测试源码存在或浏览器 Mock 通过表述为真实 Windows 运行验收通过。
- 不要通过删除断言、降低架构规则或加入忽略项制造通过。
- 不要在未确认外部应用可被关闭时运行完整 `acceptance.ps1`。

## 7. 构建与当前边界

- 本项目当前只实现 Windows 原生运行；`windows-sys`、前台窗口和进程树读取是核心依赖。
- 开发入口：`pnpm tauri dev`；仅调试 UI 可使用 `pnpm dev`，但其数据来自 Mock。
- 安装包构建：`pnpm tauri build`，输出到 `src-tauri/target/release/bundle/`。
- 当前不实现云同步、账号、遥测、浏览器扩展、LLM API 或自动向 Agent 发送内容。
- SQLite 未增加应用层加密；用户可见文案和 README 必须明确本地存储边界，不得宣称高敏感数据安全存储。
