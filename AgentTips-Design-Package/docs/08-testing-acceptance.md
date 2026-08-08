# 08. 自动测试与验收标准

## 1. 目标

自动验收必须验证业务逻辑，而不是只验证“能够编译”。核心验收不依赖测试机器真正安装 Cursor、Claude Code 或 ChatGPT。

## 2. 测试分层

| 层级             | 工具                        | 主要范围                     |
| ---------------- | --------------------------- | ---------------------------- |
| TypeScript 单元  | Vitest                      | schema、adapter、工具函数    |
| React 组件       | Testing Library             | 快捷窗口、列表、编辑器、提醒 |
| Web E2E          | Playwright + MockDesktopApi | 完整 UI 用户流程与截图       |
| Rust 单元        | `cargo test`                | 状态机、规则评分、去抖       |
| Rust 集成        | SQLite 临时库               | migration、repository、事务  |
| 构建检查         | Vite + Cargo + Tauri        | 类型、lint、debug bundle     |
| Windows 原生冒烟 | PowerShell + 人工           | 快捷键、托盘、前台检测、安装 |

## 3. 必须提供的命令

项目完成后，根目录必须支持或等价支持：

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
pnpm tauri build --debug
```

并提供：

```powershell
./scripts/acceptance.ps1
```

该脚本按顺序执行全部自动门禁，任何步骤失败返回非零退出码。

## 4. 自动验收用例

### AT-QN-001 快捷窗口只新建

**Given** MockDesktopApi 中已有 5 张便签  
**When** 打开快捷窗口  
**Then** 正文为空，不展示历史列表，不自动加载最近便签。

### AT-QN-002 保存多 Agent 绑定

输入一张便签，绑定 Cursor、Claude Code，Cursor 默认携带开启，Claude Code 关闭。保存后数据库或 mock 中应存在一张 Tip 和两条绑定，携带状态分别正确。

### AT-QN-003 空内容关闭

空白快捷窗口关闭后，不创建 Tip。

### AT-QN-004 无 Agent 保存

正文非空、绑定列表为空时保存按钮可用；保存后数据库存在一张 Active Tip，`tip_agents` 没有对应记录，主窗口能够读取该便签。

### AT-QN-005 未保存内容关闭保护

非空草稿通过 `Esc`、界面关闭按钮或系统标题栏关闭时均显示确认。选择“继续编辑”后内容和焦点保留；选择“放弃内容”后才清空并隐藏。保存进行中不允许关闭打断。

### AT-QN-006 保存错误完整可读

长错误在默认与最小窗口内通过有界滚动区域完整展示，可选择复制；正文、Agent 绑定和窗口可见状态不变。

### AT-QN-007 无标题与自由标签

输入正文和新标签后保存，Tip 的标题保持为空，标签完成规范化并随 Tip 持久化；点击保存时，标签框中尚未按回车的文字也必须保存。

### AT-QN-008 历史标签复用与降级

输入标签时可选择以前写过的匹配标签；历史标签查询失败时仍可自由输入新标签并保存。未保存标签输入或已选标签关闭时必须经过放弃确认。

### AT-HK-001 录制合法组合

设置页点击录制控件后按下 `Ctrl + K`，前端产生 `{ modifier: 'Ctrl', keyCode: 'KeyK' }` 候选并显示 `Ctrl + K`；不得把录制控件当文本框写入字符。

### AT-HK-002 严格修饰键规则

以下组合均拒绝且不覆盖旧值：只有 `K`、只有 `Ctrl` 后取消、`Ctrl + Alt + K`、`Ctrl + Shift + K`、`Meta + K`、`Ctrl + Esc`。

### AT-HK-003 Esc 取消

当前为 `Ctrl + F12`，开始录制后按 Esc，退出录制并保持 `Ctrl + F12`。

### AT-HK-004 冲突保留旧快捷键

FakeHotkeyRegistrar 返回 conflict，新组合不持久化，旧组合继续触发快捷窗口。

### AT-HK-005 持久化失败补偿

新组合系统注册成功但 SettingsRepository 保存失败时，必须注销新组合，旧组合仍有效。

### AT-HK-006 重启恢复

成功保存 `Ctrl + K` 后重新创建应用服务，启动时读取并注册 `Ctrl + K`。

### AT-HK-007 高冲突确认

录制 `Ctrl + C` 时先返回警告，不注册；用户明确二次确认后才尝试系统注册。

### AT-HK-008 触发职责

已注册快捷键触发时，只重置并显示 `quick-note`；不打开主窗口、不加载历史、不执行数据库查询循环。

### AT-ARCH-001 Rust 依赖方向

自动架构检查确保 `domain/` 不导入 Tauri、SQLite 或 Windows 平台 crate；application 只依赖 domain 与 ports。

### AT-ARCH-002 Frontend 依赖方向

ESLint restricted imports 或等价脚本确保 `@tauri-apps/api` 只出现在 `src/desktop-api` 或明确 adapter 目录，feature 组件不得直接 invoke/listen。

### AT-ARCH-003 数据驱动 Agent 扩展

通过新增 Agent seed + AgentRule fixture 可以识别一个测试 Agent，不修改 detection 引擎核心代码。

### AT-ARCH-004 模块公开入口

每个核心模块只能通过 facade/use case/port 跨模块调用；自动脚本检查禁止 feature 直接导入另一个 feature 的私有目录。

### AT-NOTE-001 CRUD

创建、读取、修改、归档、恢复、删除流程均正确，列表稳定排序。

### AT-NOTE-002 事务回滚

创建第二条绑定时模拟数据库失败，Tip 和第一条绑定都不得残留。

### AT-BIND-001 默认携带属于关系

同一 Tip 绑定 Cursor 与 ChatGPT，可以分别保存不同的 `auto_attach`；更新一个绑定不影响另一个。

### AT-DET-001 桌面前台识别

fixture 中 Cursor 为前台进程时识别 Cursor；Cursor 仅在后台、浏览器为前台时返回 Unknown 或非 Cursor。

### AT-DET-002 终端 Claude Code

fixture 进程树：Windows Terminal → PowerShell → Claude Code，且命令行规则命中，应识别 Claude Code。

### AT-DET-003 Node 误识别防护

fixture 进程树：Windows Terminal → PowerShell → node dev-server，不得识别为 Claude Code。

### AT-DET-004 歧义保守处理

两个 Agent 候选分数接近且无强规则时返回 Unknown，不随机选择。

### AT-REM-001 首次激活

Agent 有携带便签且没有 `last_prompted_at`，决策为 Allowed。

### AT-REM-002 14:59 冷却

FakeClock 前进 14 分 59 秒，决策为 `CooldownActive`。

### AT-REM-003 恰好 15:00

FakeClock 前进恰好 15 分钟，决策为 Allowed。

### AT-REM-004 Agent 独立冷却

Cursor 22:00 提醒后，Claude Code 22:05 仍允许；Cursor 22:10 拒绝。

### AT-REM-005 无携带便签

没有 `auto_attach = true` 的便签时，拒绝原因是 `NoAttachedTips`，且不更新 `last_prompted_at`。

### AT-REM-006 窗口失败

模拟提醒窗口显示失败，不更新 `last_prompted_at`；下一次激活仍可重试。

### AT-REM-007 重启恢复

写入数据库后重新创建服务实例，冷却仍有效。

### AT-REM-008 Agent 关闭提醒

`reminder_enabled = false` 时拒绝，原因明确。

### AT-UI-001 快捷窗口键盘流程

Playwright：正文不绑定 Agent 也可 Ctrl+Enter 保存；可自由输入新标签并点击历史标签复用；多 Agent 绑定仍可独立切换携带状态；未保存正文或标签关闭需要明确确认，保存成功显示反馈并重置。

### AT-UI-002 主窗口筛选

按 Cursor 筛选只显示与 Cursor 绑定的便签；“默认携带”筛选只显示至少存在一个 auto_attach 绑定的便签。

### AT-UI-003 提醒聚合

4 条携带便签产生一个提醒窗口；首屏显示 3 条和剩余计数，不产生 4 个窗口。

### AT-UI-004 不自动发送

所有 UI 流程只能复制内容，不能触发网络请求或模拟键盘发送到 Agent。

### AT-UI-005 深浅主题

主窗口、快捷窗口、提醒窗口在 light/dark 下无不可读文本，截图基准通过。

## 5. 性能与稳定性门禁

自动测试可验证：

- 检测循环在前台签名不变时不会重复读取完整进程树；
- 列表 1,000 条便签时搜索和滚动可用；
- 连续创建 100 次提醒决策无状态泄漏；
- 数据库迁移从空库和上一个 schema fixture 均成功；Tip、标签、TipTag 与 Agent 绑定任一步失败时整笔创建回滚。

Windows 原生冒烟目标：

- 后台空闲 CPU 通常低于 2%；
- 常驻内存目标低于 180 MB；
- 快捷窗口唤起感知延迟目标低于 300 ms；
- 连续显示/隐藏快捷窗口 50 次无崩溃；
- 应用重复启动只保留一个实例；
- 主窗口关闭后托盘仍可打开；
- 退出后无残留 AgentTips 进程。

性能数字是发布目标，不允许通过降低功能正确性实现。

## 6. 原生人工冒烟清单

由于 CI 无法保证安装真实 Agent，发布前在 Windows 机器执行：

1. 使用默认 `Ctrl + F12` 唤起快捷窗口；输入正文但不绑定 Agent 后能够保存；
2. 在设置页点击录制控件，按下一个合法 `Ctrl + 单键` 并确认重启后仍生效；
3. 尝试 `Ctrl + Alt + K` 等非法组合，必须拒绝且原快捷键不变；
4. 快捷键冲突时显示错误且旧快捷键仍可用；
5. Cursor 前台触发，后台不触发；
6. 实际 Claude Code / OpenCode / Codex 至少验证已安装的两种；
7. 提醒窗口不抢正在输入的焦点；
8. 15 分钟冷却可通过测试构建的可控时钟快速验证；
9. 托盘、开机启动、单实例；
10. 在非空快捷便签中分别测试 `Esc`、界面关闭按钮和系统标题栏关闭，均不得绕过放弃确认；
11. 安装、升级、卸载不损坏用户数据库。

## 7. 发布阻断条件

以下任一项存在则不得宣称 MVP 完成：

- 自动验收脚本非零；
- 状态机边界测试缺失；
- 终端 detector 把任意 Node 进程识别成 Claude Code；
- React 直接写 SQL；
- 主快捷键允许 Ctrl 以外额外修饰键，或允许自由字符串绕过录制与 Rust 校验；
- 快捷键更新失败后旧组合失效；
- domain 层依赖 Tauri、SQLite 或 Windows 平台代码；
- feature 组件直接调用 Tauri invoke/listen；
- 快捷窗口展示历史列表；
- 同一 Agent 15 分钟内重复提醒；
- 提醒窗口抢焦点；
- 自动发送或调用外部模型；
- 未提交锁文件或 migration；
- 通过跳过测试、删除断言或更新截图基准规避失败。

## 8. 验收报告格式

Agent 最终输出：

```text
自动验收：PASS / FAIL

Commands:
- pnpm format:check: PASS
- pnpm check:architecture: PASS
- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm test: PASS (x tests)
- pnpm test:e2e: PASS (x tests)
- pnpm build: PASS
- cargo fmt: PASS
- cargo clippy: PASS
- cargo test: PASS (x tests)
- tauri debug build: PASS

Manual native smoke:
- completed / not completed

Known limitations:
- ...
```
