# AgentTips Agent 工程规则

本文件适用于整个仓库。任何代码 Agent 在修改代码前必须阅读全部设计文档。

## 1. 基本工作方式

1. 先检查仓库实际状态，不假定文件、依赖或功能已经存在。
2. 一次只执行当前提示词指定的阶段，不提前实现后续阶段。
3. 修改前列出：目标、受影响模块、风险和验收命令。
4. 修改后必须运行当前阶段要求的自动验收。
5. 不得通过删除测试、降低规则、添加忽略项来制造“通过”。
6. 遇到文档与代码冲突时，以设计文档为目标，先报告差异再修复。
7. 不创建未被需求要求的服务端、账号、云存储、AI API 或浏览器扩展。

## 2. 技术边界

### React / TypeScript 负责

- 主窗口、快捷新建窗口、提醒窗口；
- 表单、列表、搜索、筛选、主题和动效；
- 调用强类型 Tauri Commands；
- 监听 Rust 发出的领域事件；
- 展示错误，不决定业务规则。

### Rust 负责

- SQLite、迁移、事务和领域不变量；
- 全局快捷键录制后的权威校验、注册、回滚，托盘、单实例和多窗口生命周期；
- Windows 前台窗口和进程树读取；
- Agent 识别、去抖、冷却与提醒资格判断；
- 自动携带便签查询；
- 日志、恢复和发布配置。

### 禁止

- React 直接执行 SQL；
- React 自己计算 15 分钟冷却；
- Rust 中拼装 UI 文案和视觉布局；
- 同一条业务规则在 TypeScript 和 Rust 各实现一遍；
- 为每种 Agent 复制一套独立检测代码；
- 将所有逻辑堆进 `App.tsx`、`lib.rs` 或单个 service 文件；
- 允许 `Ctrl + Alt + 键`、自由字符串或仅前端校验绕过 `Ctrl + 单键` 约束；
- feature 组件直接调用 `invoke/listen`，或 domain 导入 Tauri/SQLite/Windows。

## 3. 模块与扩展规则

- 必须阅读并遵守 `docs/12-extensibility-module-design.md`。
- Rust 采用 domain → application/ports ← adapters 的依赖方向。
- React 采用 feature → DesktopApi facade → adapter 的依赖方向。
- 新增 Agent 优先增加 AgentRule 与 fixture，不复制 detector。
- 新增外部能力先定义最小 port，再实现 adapter。
- 快捷键模块必须拆分为 `HotkeyRecorder`（前端捕获）、`HotkeyPolicy`（领域校验）、`UpdateHotkey`（用例）和 `HotkeyRegistrar`（平台端口）。
- 每个 feature/domain module 有唯一公开入口，禁止跨模块深层导入私有文件。
- `scripts/acceptance.ps1` 必须包含架构边界检查。

## 4. 快捷键规则

- 默认值为 `Ctrl + F12`。
- 用户只能点击录制控件后按下组合，不能编辑自由文本。
- 合法格式严格为 `Ctrl + 一个支持的非修饰键`；Alt、Shift、Meta 均不得同时存在。
- Esc 取消，失败保持旧值；高冲突组合需要二次确认。
- 前端只生成结构化候选，Rust 必须权威校验、系统注册和持久化。
- 注册、持久化或注销切换失败时必须补偿，不能让用户失去旧快捷键。
- 不记录录制按键历史。

## 5. 依赖规则

- 使用当前稳定版本并提交锁文件，不在文档中随意硬编码未来版本号。
- 新增依赖前说明用途；已有能力能完成时不增加依赖。
- UI 优先使用已有 shadcn/ui 组件和项目级组合组件。
- 原生 Windows 能力使用 Rust `windows` crate 或经过验证的稳定 crate。
- SQLite 由 Rust 数据层访问；MVP 不允许前端使用 Tauri SQL 插件直接查询。

## 6. 数据和时间规则

- 数据库时间统一保存为 UTC RFC 3339 字符串或 UTC 毫秒时间戳；代码中只能选择一种并保持一致。
- 业务时间通过 `Clock` 抽象获取，测试不得依赖真实等待 15 分钟。
- 删除便签采用软删除或明确的事务级硬删除；实现方案必须与数据库文档一致。
- `last_prompted_at` 只在提醒窗口被成功创建并接收有效内容后更新。

## 7. 测试规则

必须保持以下层次：

- TypeScript 单元测试：组件逻辑、表单 schema、前端 adapter；
- React 组件测试：快捷新建、列表、详情和提醒状态；
- 浏览器模式 E2E：使用 Mock Desktop API，不依赖 Tauri 运行时；
- Rust 单元测试：规则引擎、状态机、数据校验；
- Rust 集成测试：SQLite repository、迁移、事务；
- Windows 手动冒烟：真实快捷键、托盘、前台检测与安装包。

若原生功能无法在 CI 中完全自动化，必须通过抽象接口和 fixture 自动验证核心逻辑，并在发布门禁中保留人工冒烟项。

## 8. 完成定义

一个阶段只有同时满足以下条件才算完成：

- 功能按当前阶段文档实现；
- 自动测试通过；
- 构建通过；
- 没有新增高优先级 TODO；
- README 或相关文档已更新；
- 输出修改文件清单、测试结果、已知限制和下一阶段入口。
