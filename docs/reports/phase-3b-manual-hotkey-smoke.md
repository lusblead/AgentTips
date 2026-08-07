# Phase 3B 人工 Windows Hotkey 冒烟报告

- 日期：2026-08-07
- 基线：`phase-3a-window-runtime-baseline`（5968b11）
- 构建：`pnpm tauri dev`（debug，`src-tauri/target/debug/agent-tips.exe`）
- 状态：**PENDING USER MANUAL SMOKE** —— 自动运行时验收（`pnpm test:global-hotkey`）
  已 PASS，但以下 6 项需要用户在真实常用应用中人工确认，尚未执行，不得视为 PASS。

## 需要人工验证的 6 项

1. 在 Chrome 中按当前全局快捷键 → Quick Note 出现并聚焦。
2. 在 Cursor 中按当前全局快捷键 → Quick Note 出现并聚焦。
3. 在 Windows Terminal 中按当前全局快捷键 → Quick Note 出现并聚焦。
4. 在 Settings 中修改快捷键 → 不重启立即生效。
5. 旧快捷键立即失效。
6. 退出并重新启动 → 新快捷键仍然生效。

## 自动化已覆盖（供参考）

`pnpm test:global-hotkey`（独立测试数据库）已验证：

- A. 启动默认 Ctrl + F12 并注册成功；
- B–F. 隐藏全部窗口后 Notepad 前台真实发送 Ctrl + F12 → Quick Note 出现；
  重复触发仍 1 个窗口且草稿保留；关闭后隐藏；
- G. Settings UI 修改为 Ctrl + F11（真实 DOM + 键盘事件）；
- H. Ctrl + F11 生效、I. Ctrl + F12 失效；
- J. 重启后 Ctrl + F11 仍生效（SQLite 持久化 + 启动注册）；
- 冲突 fixture（独立进程占用 Ctrl + F10）→ `HOTKEY_REGISTRATION_FAILED`，
  数据库与 active 保持 F11，旧快捷键继续工作。

## 已知边界

- 自动化使用 Notepad 作为外部焦点应用；Chrome / Cursor / Windows Terminal
  属于上述人工验证范围。
- 测试窗口统一移动到电脑原生屏幕并隐藏，避免打扰用户正在使用的显示器。
