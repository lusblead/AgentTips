# Phase 2.1 真实 UI 垂直链路与数据层发布门禁报告

日期：2026-08-07

## 目标

不增加新功能，验证 Phase 2 已有代码在真实 Tauri WebView 中能通过用户界面完成完整 CRUD，并核实数据层发布门禁。

## 交付物

- `scripts/tauri-ui-vertical-chain.mjs` + `pnpm test:tauri-ui`：通过 WebView2 CDP 操作真实 DOM（点击/输入/键盘/路由切换）完成创建→读回→重启持久化→修改→删除→数据库清理；全程断言控制台无未处理错误、Rust 无 panic。
- adapter 标识：`App.tsx` 在 `import.meta.env.DEV` 下输出 `data-desktop-adapter="tauri"|"mock"`（生产不暴露）；验收断言 `desktop adapter = tauri`。
- 窗口上下文修复：真实 Tauri 下单窗口阶段统一由 URL 查询参数决定调试路由（原 `__TAURI_WINDOW_LABEL__` 分支在 Tauri 2 不生效导致恒为 main）。
- SQLite 门禁：`busy_timeout(5000)`；foreign_keys 每连接生效（init 时 pragma）；migration DDL 与版本记录同事务（`apply_migration`），中途失败回滚且不写版本；并发 list/list+create 测试。
- 真实错误路径：UI 创建 Tip 后由测试清理（Python 直连软删除，非业务后门），UI 保存修改 → 页面显示 `NOT_FOUND`、输入保留、无未捕获 rejection、无 panic、无半条记录。
- 降级验证：设置页 `previewHotkey` 与提醒页 `getReminderPreview` 未实现时显示"尚未实现"提示、不白屏、快捷键保持默认；主管理与快捷窗口不受影响。
- 截图：`artifacts/screenshots/phase-2.1/` 8 张（真实 Tauri 环境 CDP 截图，1000x750），像素级检查通过。

## 真实 UI 垂直链路结果

全部通过：adapter=tauri → UI 创建（Cursor autoAttach=true / Claude Code autoAttach=false）→ 主页面读回验证 → 重启持久化 → UI 修改正文+替换绑定（仅 Cursor、autoAttach=false）→ UI 删除 → 数据库 alive=0 bound=0 → 真实错误路径 → 设置/提醒降级 → 主管理与快捷不受影响 → 最终控制台无错误。

## 测试数量核实

- Rust：35 个（adapters/sqlite 18、application 6、domain 6、dto 5）；`cargo test -- --list` 分类合计与 `cargo test` 汇总一致。
- Vitest：63 个（9 个文件）；`vitest --run --reporter=verbose` 列出 63 个 ✓。
- Playwright：21 个（4 个文件：layout 5、phase1 4、screenshots 11、smoke 1）。
- Tauri UI 集成验收：1 个流程（`pnpm test:tauri-ui`），覆盖 23 个步骤。

## 验收命令结果

全部 PASS：`pnpm install --frozen-lockfile`、`pnpm format:check`、`pnpm check:architecture`、`pnpm lint`、`pnpm typecheck`、`pnpm test`（63）、`pnpm test:e2e`（21）、`pnpm build`、`cargo fmt --check`、`cargo check`、`cargo clippy -D warnings`、`cargo test`（35）、`scripts/acceptance.ps1`（含 test:tauri-ui）、`pnpm test:tauri-ui`（PASS）。

## 数据库位置

`%APPDATA%\com.agenttips.app\agenttips.sqlite3`；工作区根目录无运行时数据库；验收前后数据库测试数据均清零。

## 已知限制

- GUI 操作通过 CDP 合成真实鼠标/键盘事件驱动（非人工点击），已覆盖全部要求步骤；
- 单窗口阶段窗口路由由 URL 决定，Phase 3 多窗口后统一由 `window-context` 适配器合并 label；
- WAL 未启用（单连接 + Mutex 串行化已满足当前并发需求，未引入连接池；busy_timeout 兜底外部进程写竞争）。

## 下一阶段候选

1. Phase 3：三窗口生命周期 + 默认 `Ctrl+F12` 全局快捷键录制/权威校验/失败回滚 + 托盘/单实例；
2. Phase 4-5：Agent 检测规则引擎与 Windows 前台/进程树适配器；
3. Phase 6：提醒状态机（15 分钟冷却、Clock/FakeClock、聚合 payload）。
