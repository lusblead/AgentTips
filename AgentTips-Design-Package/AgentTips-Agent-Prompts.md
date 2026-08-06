# AgentTips 代码 Agent 提示词集

使用方式：先将整个设计文档包放入项目根目录，再把“总控提示词”发送给代码 Agent。不要一次发送所有阶段提示词要求其全部完成；应逐阶段执行和验收。

---

# 0. 总控提示词

你现在负责实现 AgentTips。

开始前必须完整阅读：

- `README.md`
- `AGENTS.md`
- `docs/00-product-spec.md`
- `docs/01-ux-interaction.md`
- `docs/02-system-architecture.md`
- `docs/03-domain-data-model.md`
- `docs/04-agent-detection.md`
- `docs/05-reminder-state-machine.md`
- `docs/06-ipc-event-contracts.md`
- `docs/07-ui-visual-design.md`
- `docs/08-testing-acceptance.md`
- `docs/09-implementation-roadmap.md`
- `docs/10-security-reliability.md`
- `docs/12-extensibility-module-design.md`

项目目标是 Windows 本地桌面工具，技术路线固定为 Tauri 2 + React + TypeScript + Rust + SQLite。

必须遵守：

1. 主快捷键可自定义但严格为 `Ctrl + 单个支持按键`；默认 `Ctrl + F12`。设置页必须点击录制后读取实际按键，不能输入自由字符串。快捷键触发的窗口每次只新建一张空白便签，不显示历史便签。
2. 一张便签可以绑定多个 Agent，“默认携带”属于每条便签—Agent 关系。
3. “打开 Agent”指该 Agent 成为前台并稳定通过检测，不是后台进程存在。
4. 15 分钟冷却按 Agent 独立记录，不按便签记录。
5. React 负责 UI；Rust 负责 SQLite、系统能力、检测和提醒状态机。
6. React 不直接写 SQL，不自己计算冷却。
7. 不实现浏览器 Agent、LLM API、RAG、云同步、自动粘贴或自动发送。
8. 不把任意 node.exe 识别为 Claude Code。
9. 每个阶段完成后运行该阶段全部验收，不得通过删除测试或降低规则规避失败。
10. 按 `docs/12-extensibility-module-design.md` 保持明确模块边界：domain 不依赖框架，feature 不直接 invoke/listen，新 Agent 数据驱动扩展。
11. 快捷键前端只捕获候选，Rust 权威校验、注册、持久化和失败回滚；更新失败旧组合必须继续可用。
12. 不要一次性生成全部项目；只执行我当前指定的 Phase。

在每个 Phase 开始时先输出：

- 当前仓库状态；
- 本阶段目标；
- 预计修改文件；
- 主要风险；
- 将执行的验收命令。

在每个 Phase 结束时输出：

- 修改文件清单；
- 已实现行为；
- 自动测试和构建的真实结果；
- 未完成项与已知限制；
- 下一 Phase 的建议入口。

不要声称没有实际执行的命令已经通过。遇到阻断时，先完成可完成部分并给出精确错误，而不是扩大范围或重写架构。

等待我指定 Phase。

---

# 1. Phase 0：工程基线提示词

执行 `docs/09-implementation-roadmap.md` 的 Phase 0。

要求：

1. 勘察当前仓库，不假设它是空仓库。
2. 建立或修复 Tauri 2 + React + TypeScript + Vite + pnpm 工程。
3. 配置 Tailwind CSS、shadcn/ui 基础、Lucide 和主题 token，但不制作完整业务 UI。
4. 按 `docs/12-extensibility-module-design.md` 建立 feature、domain、application、ports、adapters 职责目录，避免把逻辑堆在 `App.tsx`、`main.rs` 或 `lib.rs`。
5. 配置 format、lint、typecheck、Vitest、基础 Playwright、Cargo fmt、Clippy 和测试脚本。
6. 提交 `pnpm-lock.yaml`、`Cargo.lock`。
7. 建立 `scripts/acceptance.ps1` 和 `scripts/check-architecture.*` 的基线版本，加入 restricted imports/依赖边界检查。
8. 不实现 SQLite schema、Agent 检测、提醒逻辑和完整页面。

必须实际执行并报告：

```bash
pnpm install
pnpm format:check
pnpm check:architecture
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

若初始化工具生成了不必要示例代码，清理但保留最小可运行页面。完成后停止，不进入 Phase 1。

---

# 2. Phase 1：Mock 驱动 UI 提示词

执行 Phase 1，只使用 `MockDesktopApi` 完成 UI，不提前实现 Rust 数据库和 Windows 检测。

要求：

1. 建立强类型 `DesktopApi` 接口和内存 `MockDesktopApi`。
2. 根据窗口 label 或浏览器测试路由实现：主窗口、快捷新建窗口、提醒窗口。
3. 快捷窗口每次打开都为空白，只负责新建；不得展示历史便签。
4. 主窗口实现三栏结构、搜索、Agent 筛选、默认携带筛选、详情编辑、空态和错误态。
5. 一张便签绑定多个 Agent，每个绑定有独立默认携带开关。
6. 提醒窗口一次聚合多条便签，首屏最多 3 条，不设计自动发送。
7. 实现 light/dark、键盘交互、减少动态效果和必要的无障碍标签。
8. 实现设置页 `HotkeyRecorder` 的 Mock 版本：点击开始录制，只接受 Ctrl + 单键，Esc 取消，额外修饰键无效，展示高冲突警告、注册中、冲突和成功状态。
9. 风格遵守 `docs/07-ui-visual-design.md`，禁止营销式紫色渐变和过量动画。
10. 建立组件测试和 Playwright 流程测试、视觉截图，覆盖 AT-HK-001～003 的前端部分。
11. 不允许用静态截图代替真实交互实现。

重点验收：AT-QN-001～003、AT-HK-001～003、AT-UI-001～005。

完成后提供关键界面截图路径和测试结果，停止，不进入 Phase 2。

---

# 3. Phase 2：领域模型与 SQLite 提示词

执行 Phase 2，将 Mock 数据能力替换为可切换的真实 Tauri Adapter，但保留 Mock 供测试。

要求：

1. 按 `docs/03-domain-data-model.md` 实现 Rust 领域实体、不变量、migration 和 repository。
2. SQLite 只能由 Rust 访问；React 不得使用 SQL 插件直接查询。
3. 创建、更新 Tip 和全量绑定同步必须使用事务。
4. 实现 Tip、Agent、Binding Commands 和结构化错误。
5. 首次迁移创建内置 Agent 种子数据，但检测规则必须可配置。
6. 实现 HotkeyBinding、SupportedKeyCode、HotkeyPolicy 与 SettingsRepository；此阶段可使用 FakeHotkeyRegistrar，不接真实系统注册。
7. 所有日期格式统一，使用 Clock 抽象。
8. 建立临时 SQLite 集成测试，验证空库迁移、重复启动、CRUD、外键、事务回滚。
9. 前端通过 `TauriDesktopApi` 调用，组件不得散落 invoke 字符串。
10. 不接真实全局快捷键注册，不实现前台检测和提醒状态机。

重点验收：AT-NOTE-001、AT-NOTE-002、AT-BIND-001。

完成后运行前后端全部已有测试，停止。

---

# 4. Phase 3：桌面窗口、快捷键和托盘提示词

执行 Phase 3。

要求：

1. 建立 `main`、`quick-note`、`reminder` 三个窗口，复用同一前端 bundle。
2. 通过独立 `HotkeyRegistrar` adapter 注册默认 `Ctrl + F12`。
3. 完成设置页录制流程：点击控件后读取 `KeyboardEvent.code`，只接受 Ctrl + 单个支持键；Ctrl 单独等待，Esc 取消，Alt/Shift/Meta 组合拒绝。
4. 前端提交结构化候选；Rust `HotkeyPolicy` 再校验，不接受自由字符串。
5. 实现高冲突二次确认、系统冲突错误和成功反馈。
6. 实现安全切换：新组合注册 + 持久化成功后再切换；任一步失败旧组合继续可用；持久化失败注销新组合。
7. 快捷键只重置并显示 `quick-note`，禁止打开历史列表。
8. 快捷窗口预创建或采用等价低延迟方案，保存/取消后隐藏。
9. 主窗口关闭到托盘；托盘提供新建、打开、暂停提醒、设置、退出。
10. 实现单实例，第二次启动聚焦首实例。
11. 提醒窗口先只支持手动测试 payload，不接 Agent 检测。
12. 添加连续唤起防重入和窗口错误日志。
13. 不实现终端扫描和 15 分钟冷却。

完成 AT-HK-001～008，并在 Windows 上真实验证录制、冲突、重启恢复、旧组合回滚、托盘、单实例和 50 次唤起/隐藏。记录真实结果，停止。

---

# 5. Phase 4：规则引擎提示词

执行 Phase 4，只实现平台无关的检测模型和 fixture，不接真实 Windows API。

要求：

1. 实现 `ForegroundSnapshot`、`ProcessNode`、`AgentContext`、Resolution 和原因。
2. 使用数据驱动 AgentRule 与评分，不为每个 Agent 复制 detector。
3. 支持桌面规则和终端子进程/命令行规则。
4. 两个候选接近时返回 Unknown，不猜测。
5. 禁止用任意 node.exe 单独识别 Claude Code。
6. 实现 750 ms 稳定去抖和稳定 context signature。
7. 建立至少覆盖 `docs/04-agent-detection.md` 的全部 fixture。
8. 实现主窗口诊断区的 Mock 数据展示。
9. 内置规则应作为可修改 seed，不写死在 if/else 链。

重点验收：AT-DET-001～004。完成后停止。

---

# 6. Phase 5：Windows 检测适配器提示词

执行 Phase 5，把已测试的规则引擎接到真实 Windows 平台。

要求：

1. 读取前台窗口句柄、PID、进程名、路径、标题和类名。
2. 终端前台时读取相关父子进程树与可用命令行。
3. 读取失败返回缺失字段或 Unknown，不让后台任务崩溃。
4. 轮询约 500 ms；只有前台签名变化或终端上下文需要时刷新详细进程信息。
5. 使用已实现的去抖后才产生候选激活事件。
6. 日志不得记录完整便签正文或默认记录完整命令行。
7. 实现取消和应用退出清理，正确关闭 Windows 句柄。
8. 在诊断页显示脱敏检测结果。
9. 不直接弹提醒，只向后续 ReminderService 提供 AgentActivated candidate。

在实际 Windows 环境至少验证一个桌面 Agent和两个已安装终端 Agent；无法验证的 Agent必须列为未验证，不能声称支持完成。完成后停止。

---

# 7. Phase 6：提醒状态机提示词

执行 Phase 6，严格以 `docs/05-reminder-state-machine.md` 为准。

要求：

1. 实现 Clock/FakeClock。
2. 15 分钟固定冷却按 Agent 独立记录。
3. 默认携带查询读取 TipAgentBinding.auto_attach。
4. 全局暂停、Agent enabled、Agent reminder_enabled、无携带便签、冷却中、已显示等情况返回明确原因码。
5. 一次激活生成一个聚合提醒 payload。
6. reminder 窗口成功显示后才更新 last_prompted_at。
7. 显示失败、无便签、冷却拒绝都不得更新时间。
8. 应用重启后从 SQLite 恢复状态。
9. 自动提醒窗口不抢焦点，不自动发送内容。
10. 完成全部 AT-REM-001～008 和 UI 聚合测试。

请重点检查恰好 15:00 的边界、系统时间回退和不同 Agent 独立性。完成后停止。

---

# 8. Phase 7：集成与发布提示词

执行 Phase 7。

要求：

1. 修复所有现有测试和构建问题，不降低规则。
2. 完成 `scripts/acceptance.ps1`，失败返回非零。
3. 配置 CI 执行前端和 Rust 自动门禁；原生冒烟单独记录。
4. 完成 Tauri debug/release build 和 Windows 安装包。
5. 验证单实例、托盘、开机启动、数据库迁移和升级路径。
6. 检查 capability 最小权限，禁止任意 shell 和任意文件系统访问。
7. README 写清范围、安装、使用、隐私、检测限制和已知问题。
8. 提供自动验收报告与 Windows 原生冒烟报告。
9. 检查 UI 截图，不允许通过无条件更新基准图隐藏回归。
10. 不增加 Future Work 功能。

最终按 `docs/08-testing-acceptance.md` 的格式报告。只有全部自动门禁通过并完成原生冒烟后，才能宣称 MVP 完成。

---

# 9. 代码审查与修复提示词

阅读全部设计文档，对当前仓库进行严格审查，不先修改代码。

输出：

1. 按严重程度排序的问题清单；
2. 每个问题给出文件、代码位置、违反的文档条款、用户影响；
3. 特别检查：
   - 快捷窗口是否意外加载历史；
   - 快捷键是否严格为 Ctrl + 单键，是否必须通过录制控件；
   - 更新失败后旧快捷键是否仍有效；
   - domain/feature 是否违反依赖边界；
   - auto_attach 是否错误放在 tips 表；
   - 冷却是否错误按 Tip 记录；
   - React 是否直接 SQL 或重复计算冷却；
   - 后台运行的 Agent 是否误触发；
   - node.exe 是否被当成 Claude Code；
   - 窗口失败是否仍更新时间；
   - reminder 是否抢焦点；
   - 测试是否通过弱断言或跳过制造绿灯；
   - capability 是否过宽。
4. 给出最小修复顺序与对应测试。

完成审查后停止，等待我选择修复范围。不要在审查阶段直接大规模重构。

---

# 10. 最终自动验收提示词

不要增加新功能。严格按照 `docs/08-testing-acceptance.md` 验收当前仓库。

步骤：

1. 检查工作区和依赖锁文件；
2. 执行 `scripts/acceptance.ps1` 或逐条执行全部门禁；
3. 不跳过失败命令；
4. 检查 AT-QN、AT-NOTE、AT-BIND、AT-DET、AT-REM、AT-UI 测试是否真实存在且断言有效；
5. 检查 release 阻断项；
6. 能执行的 Windows 原生冒烟立即执行，不能执行的明确标记未验证；
7. 只修复明显的构建或测试基础设施小问题，不在验收阶段重写产品；
8. 输出 PASS/FAIL、每条命令结果、测试数量、失败日志摘要、原生冒烟状态和已知限制。

任何关键命令失败、状态机测试缺失、提醒抢焦点或终端误识别，都必须判定 FAIL，不得使用“基本完成”。
