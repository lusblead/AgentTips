# Phase 2 真实垂直链路报告

日期：2026-08-06

## 目标

打通 Tip、Agent 与多 Agent 绑定的 React → Tauri → Rust → SQLite 真实垂直链路。不实现快捷键注册、多窗口、托盘、单实例、Agent 检测、15 分钟冷却或提醒运行时。

## 交付物

- Rust 分层：`domain`（Tip/Agent/Binding 模型与校验）、`application`（用例，仅依赖 domain + ports）、`ports`（TipRepository / AgentRepository / Clock / IdGenerator）、`adapters`（SQLite migration + repository、SystemClock、UuidGenerator）、`commands`（6 个 Tauri Command，仅 DTO 转换）、`bootstrap`（`lib.rs` composition root）。
- SQLite：`migrations/0001_init.sql`（agents/tips/tip_agents/schema_migrations、外键、联合主键、索引）；migration 幂等；内置 6 个 Agent 以 `key` 幂等初始化，不覆盖用户字段。
- 事务：创建 Tip + 全部绑定、更新 + 全量替换绑定、删除（软删除 + 清绑定）均为单事务；绑定不存在 Agent 时整体回滚。
- 前端：`TauriDesktopApi` 实现 `listAgents/listTips/getTip/createTip/updateTip/deleteTip`；`previewHotkey`/`getReminderPreview` 明确未实现；App 组合根按环境选择 adapter；结构化错误 `DesktopError`。
- 契约：`AgentBinding`（输入）+ `TipBindingDto`（输出，含 `sortOrder`）、`CreateTipInput.status` 可选、camelCase 序列化、错误码对齐。

## 真实垂直链路验证（WebView2 CDP 自动化）

在 `pnpm tauri dev` 窗口内直接调用 `window.__TAURI_INTERNALS__.invoke`：

1. `agent_list` 返回 6 个内置 Agent；
2. `tip_create`（标题/正文 + Cursor autoAttach=true + Claude Code autoAttach=false）成功，返回 `sortOrder 0/1`；
3. `tip_list`/`tip_get` 读回，绑定与 autoAttach 正确；
4. 关闭并重启应用后 `tip_get` 仍能读取（SQLite 持久化）；
5. `tip_update` 修改正文并替换绑定，`updatedAt` 更新；
6. `tip_delete` 后 `tip_list` 不再包含。

验证脚本：`scripts/vertical-chain-verify.mjs`（模式 `all` / `create-persist` / `reload` / `cleanup`）。

## 测试结果

- Rust：30 个测试全过（domain 5、application 7、migration 4、repository 12、DTO 契约 5 类）；
- 前端：62 个 Vitest 测试全过（含 TauriDesktopApi invoke mock 9 个、垂直链路注入 4 个）；
- Playwright：21 个 E2E 全过；
- 架构检查 9 项全过（feature 不触 Tauri / SQL 只存在于 migration+sqlite adapter / domain 纯净 / application 不依赖 adapters+commands / commands 不引用 rusqlite / 组合根使用 TauriDesktopApi / feature 测试不实例化 TauriDesktopApi）。

## 数据库位置

`%APPDATA%\com.agenttips.app\agenttips.sqlite3`；工作区根目录无运行时数据库。

## 已知限制

- GUI 手动点击链路未做（无自动化 GUI 工具），以 CDP 真实 invoke 链路替代并覆盖全部要求步骤；
- `previewHotkey`/`getReminderPreview` 未实现；
- 删除采用软删除（`deleted_at`）+ 事务清绑定，列表/详情查询过滤已删除行。

## 下一阶段候选

1. Phase 3：三窗口生命周期 + 默认 `Ctrl+F12` 全局快捷键录制/权威校验/失败回滚 + 托盘/单实例；
2. Phase 4-5：Agent 检测规则引擎与 Windows 前台/进程树适配器；
3. Phase 6：提醒状态机（15 分钟冷却、Clock/FakeClock、聚合 payload）。
