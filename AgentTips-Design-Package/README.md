# AgentTips 设计文档包

**版本：** v1.1  
**日期：** 2026-08-06  
**目标平台：** Windows 10/11 x64  
**技术路线：** Tauri 2 + React + TypeScript + Rust + SQLite

## 1. 文档用途

本目录用于指导 Claude Code、Codex、OpenCode、Cursor Agent 等代码 Agent 实现 AgentTips。Agent 必须先阅读本文件、根目录 `AGENTS.md` 以及 `docs/` 下全部文档，再开始修改代码。

AgentTips 是一个面向桌面和终端 AI Agent 的本地便签工具：用户通过可录制的全局快捷键快速创建一张新便签，将其绑定到一个或多个 Agent，并决定该便签是否在对应 Agent 被激活时自动携带。主快捷键严格采用 `Ctrl + 单个按键`，用户在设置中点击录制控件后直接按下组合键完成配置。每种 Agent 在 15 分钟冷却窗口内只触发一次自动提醒。

## 2. 已冻结的产品边界

MVP 支持以下类别：

- 桌面 Agent：ChatGPT Desktop、Cursor、Trae，以及用户自定义桌面 Agent。
- 终端 Agent：Claude Code、OpenCode、Codex CLI，以及用户自定义终端 Agent。
- Windows 桌面应用、系统托盘、可录制的 `Ctrl + 单键` 全局快捷键、本地 SQLite。

MVP 不包含：

- 浏览器网页 Agent 识别；
- 云同步、账户、团队协作；
- LLM API、自动生成提示词、RAG、Embedding；
- 自动把便签发送给 Agent；
- macOS、Linux；
- MCP Server 与 CLI Wrapper。

## 3. 文档索引

| 文档                                     | 作用                                 |
| ---------------------------------------- | ------------------------------------ |
| `AGENTS.md`                              | 所有代码 Agent 必须遵守的工程规则    |
| `docs/00-product-spec.md`                | 产品目标、术语、范围与核心流程       |
| `docs/01-ux-interaction.md`              | 快捷窗口、主界面、提醒窗口的交互规格 |
| `docs/02-system-architecture.md`         | 前后端边界、模块、线程与窗口架构     |
| `docs/03-domain-data-model.md`           | 领域模型、SQLite 表结构和不变量      |
| `docs/04-agent-detection.md`             | 桌面与终端 Agent 检测规则            |
| `docs/05-reminder-state-machine.md`      | 15 分钟冷却和自动携带状态机          |
| `docs/06-ipc-event-contracts.md`         | Tauri Command、事件与错误契约        |
| `docs/07-ui-visual-design.md`            | UI 视觉系统、布局、状态和动效        |
| `docs/08-testing-acceptance.md`          | 自动验收矩阵、测试策略和发布门禁     |
| `docs/09-implementation-roadmap.md`      | 分阶段实施顺序与阶段退出条件         |
| `docs/10-security-reliability.md`        | 权限、隐私、日志、恢复和性能要求     |
| `docs/11-references.md`                  | 主要官方技术资料                     |
| `docs/12-extensibility-module-design.md` | 模块边界、依赖方向、扩展点和架构验收 |
| `prompts/AgentTips-Agent-Prompts.md`     | 主提示词和分阶段执行提示词           |

## 4. 冲突处理优先级

当文档之间存在冲突时，按以下优先级执行：

1. `docs/00-product-spec.md` 中标记为“冻结”的范围和行为；
2. `docs/05-reminder-state-machine.md` 中的状态机；
3. `docs/03-domain-data-model.md` 中的领域不变量；
4. `docs/08-testing-acceptance.md` 中的验收要求；
5. `docs/02-system-architecture.md` 与 `docs/12-extensibility-module-design.md` 的模块边界；
6. 其他文档；
7. Agent 自己的偏好。

禁止 Agent 为了“更完整”而主动扩大范围。任何没有写入 MVP 的能力，都应记录到 Future Work，而不是直接实现。
