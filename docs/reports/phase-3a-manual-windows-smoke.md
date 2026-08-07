# Phase 3A 人工 Windows 冒烟报告

- 日期：2026-08-07
- 基线：`phase-2.4r-product-baseline`（HEAD 前身），本阶段验收前 commit `1e4d891`
- 构建：`pnpm tauri dev`（debug，`src-tauri/target/debug/agent-tips.exe`）
- 说明：A–I 中的“自动化验证”指 `pnpm test:windows-runtime` 通过 WebView2 CDP
  驱动真实窗口完成的等效操作；“需人工”指必须由人点击系统 Tray 菜单的步骤，
  CDP 无法驱动原生 Tray 图标。所有需要人工的条目均未在本次会话中由人工完成，
  需要发布前补一次实机点击。

| 项  | 操作                                                       | 预期                               | 结果                                                                                    |
| --- | ---------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| A   | 启动 AgentTips                                             | Main 窗口出现（1100×760）          | 自动化验证 PASS（主窗口创建并显示）                                                     |
| B   | 关闭 Main                                                  | 程序不退出，Main 隐藏              | 自动化验证 PASS（CloseRequested → prevent_close + hide；进程仍存活）                    |
| C   | Tray → 打开 AgentTips                                      | Main 恢复显示                      | 部分：`window_open_main` 应用服务路径自动化 PASS；**Tray 菜单点击需人工**               |
| D   | Tray → 新建提示                                            | 出现独立小窗（740×520）            | 部分：`window_open_quick_note` + 首页“新建提示”按钮自动化 PASS；**Tray 菜单点击需人工** |
| E   | Quick Note 输入 “window lifecycle test”，绑定 Cursor，保存 | 自动隐藏，Tip 写入 SQLite          | 自动化验证 PASS                                                                         |
| F   | 再次 Tray → 新建提示                                       | 正文为空、新颜色                   | 自动化验证 PASS（3 个隐藏→显示周期均为空且颜色变化）                                    |
| G   | 打开 Settings 5 次                                         | 始终 1 个 Settings 窗口（860×620） | 自动化验证 PASS                                                                         |
| H   | 再次运行 agent-tips.exe                                    | 无第二实例，已有 Main 被唤醒       | 自动化验证 PASS（进程唯一，Main 可见）                                                  |
| I   | Tray → 退出                                                | 所有窗口、Tray、进程消失           | 部分：`window_quit`（is_quitting → app.exit）自动化 PASS；**Tray 菜单点击需人工**       |

## 需要人工补做的步骤

1. 双击运行打包后的 `AgentTips.exe`（或 `pnpm tauri dev`），确认主窗口出现。
2. 点击 Main 的 X，确认程序驻留任务栏 Tray、进程不退出。
3. 左键/右键 Tray 图标，依次点击“打开 AgentTips”“新建提示”“设置”，
   确认三个窗口分别恢复/创建且不重复。
4. 在 Quick Note 输入 “window lifecycle test”，绑定 Cursor 保存，确认窗口自动消失。
5. 再次 Tray → 新建提示，确认正文为空。
6. 打开 Settings 5 次，确认始终只有一个窗口。
7. 再次启动 `agent-tips.exe`，确认第二实例退出、Main 被唤醒。
8. Tray → 退出，确认进程彻底结束。

## 已知边界

- 自动化用 `plugin:window|close` 触发 CloseRequested，与点击原生 X 走同一
  `on_window_event` 分支；原生标题栏 X 的手感仍需人工确认一次。
- Tray 图标/菜单存在性由 `tauri.conf.json` + `TrayIconBuilder` 静态保证，
  尚未在自动化中截图验证，需人工目视确认图标正常渲染。
