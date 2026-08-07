# Phase 3A Desktop Runtime Shell 报告

日期：2026-08-07

## 目标

把通过 URL 参数模拟的页面变成真正的 Windows 桌面多窗口应用：
Main / Quick Note / Settings 三个真实窗口 + Window Manager + System Tray +
Single Instance + 关闭/隐藏/唤醒生命周期。不进入全局快捷键注册、Agent 检测、
Reminder、15 分钟状态机等 Phase 3B 能力。

## 交付物

- Rust：`ports/window_manager.rs`（WindowManagerPort + WindowLabel）、
  `application/windows.rs`（WindowApplicationService + FakeWindowManager 单测）、
  `adapters/tauri_window_manager.rs`（懒创建+复用、Quick Note 隐藏→显示才发 reset）、
  `commands/windows.rs`（async command，规避 Windows 同步 command 建窗死锁）。
- 窗口：main 1100×760（min 900×620）、quick-note 740×520
  （min 640×420 / max 820×680 / alwaysOnTop）、settings 860×620（min 720×520）。
- Tray：打开 AgentTips / 新建提示 / 设置 / 退出（`tauri.conf.json` trayIcon +
  `TrayIconBuilder`）。
- Single Instance：`tauri-plugin-single-instance`，第二实例唤醒首实例 Main 后退出。
- Close/Hide/Quit：`on_window_event` 拦截 CloseRequested（未 quitting 则
  prevent_close + hide）；只有 Tray 退出或 `window_quit` command
  （先置 `is_quitting=true`）才 `app.exit`。
- 前端：DesktopApi 新增 `openMainWindow/openQuickNoteWindow/openSettingsWindow/
hideCurrentWindow/getWindowKind/subscribeQuickNoteReset`；
  `window-context.ts` 抽象 Browser(URL) / Tauri(label) 双 Provider；
  Quick Note 保存后 300ms hide+清空、Esc hide+清空、reset 事件清空+重请求颜色。
- 修复 capability：`default.json` 覆盖全部窗口，并放开 `core:window:allow-close/
show/hide/set-focus`（供生命周期自动化模拟 X 关闭；前端 feature 不直接使用）。
- 跨窗口数据一致性：主窗口重新获得焦点时重新拉取列表
  （真实多窗口下 Quick Note 新建后主窗口不再陈旧）。
- 运行时验收：`scripts/test-windows-runtime.mjs` + `pnpm test:windows-runtime`，
  覆盖 13 项窗口生命周期检查。
- 截图：`artifacts/screenshots/phase-3a/` 6 张真实窗口截图（含双窗口合成），
  像素级校验通过。

## 关键修复

1. Windows 下 `WebviewWindowBuilder::build()` 在同步 command 中死锁
   （Tauri 2 官方已知问题）：全部窗口 command 改为 `async fn`。
2. Quick Note reset 契约：只有隐藏→显示转换才 emit `agenttips://quick-note/reset`；
   已可见再次打开仅置前聚焦并保留草稿（`should_start_draft_session(was_visible)`）。
3. `window_quit` command 补充 `is_quitting=true`（与 Tray 退出路径一致），
   否则 quit 会被 CloseRequested 拦截。
4. capability 原先只允许 main 窗口 listen 事件，导致 quick-note 订阅 reset
   静默失败（`event.listen not allowed on window "quick-note"`）：扩展至全部窗口。

## 运行时验收（pnpm test:windows-runtime）

1. Main 启动 PASS；2. Quick Note 首次打开（首页真实按钮）PASS；
2. Quick Note 不重复创建 PASS；4. Settings 打开 5 次仅 1 窗 PASS；
3. Main close → hide PASS；6. Main restore（tray 同路径）PASS；
4. Quick Note Esc → hide PASS；8. 保存 → hide + SQLite 写入 PASS；
5. 下次打开正文为空 PASS；10. 颜色每次重新请求（3 周期变化）PASS；
   11+12. 第二实例唤醒首实例、进程唯一 PASS；13. quit → 进程全部结束 PASS。

窗口真实尺寸（CSS 视口）：main 1100×760、quick-note 740×520、settings 860×620。

## 测试数量

- Rust：48（adapters 22、application 13、domain 8、dto 5）。
- Vitest：97（11 个文件）。
- Playwright：32（5 个文件）。
- Tauri UI 集成验收：`pnpm test:tauri-ui`（多窗口版，创建→读回→inline 编辑→
  autosave→Used/Restore→重启持久化→删除→错误路径→设置降级→全绿）。
- Windows Runtime：`pnpm test:windows-runtime`（13 项）。

## 验收命令结果

全部 PASS：`pnpm install --frozen-lockfile`、`pnpm format:check`、
`pnpm check:architecture`、`pnpm lint`、`pnpm typecheck`、`pnpm test`（97）、
`pnpm test:e2e`（32）、`pnpm build`、`cargo fmt --check`、`cargo check`、
`cargo clippy -D warnings`、`cargo test`（48）、`scripts/acceptance.ps1`
（含 test:tauri-ui 与 test:windows-runtime，PASS）。

## 人工冒烟边界

见 `docs/reports/phase-3a-manual-windows-smoke.md`：A–I 中除原生 Tray 菜单
点击（C/D/I 的点击动作）需人工补做外，其余均已由 CDP 自动化验证。

## 已知限制

- 自动化通过 `plugin:window|close` 触发 CloseRequested，与原生 X 同分支，
  但原生标题栏手感与 Tray 图标渲染仍需人工确认一次。
- Reminder 窗口 Phase 3A 不创建；提醒占位降级由浏览器 e2e（?window=reminder）覆盖。
