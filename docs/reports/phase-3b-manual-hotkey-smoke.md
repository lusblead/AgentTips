# Phase 3B 人工 Windows Hotkey 冒烟报告

- 日期：2026-08-07
- 基线：`phase-3a-window-runtime-baseline`（5968b11）
- 构建：`pnpm tauri dev`（debug，`src-tauri/target/debug/agent-tips.exe`）
- 状态：**PASS — user manually verified configurable global hotkey across Chrome,
  Cursor and Windows Terminal, immediate hotkey swap, old-key deactivation,
  and persistence across restart.**

## 人工验证结果（用户实机确认）

1. Chrome 中当前 Hotkey → Quick Note 出现并聚焦：PASS
2. Cursor 中当前 Hotkey → Quick Note 出现并聚焦：PASS
3. Windows Terminal 中当前 Hotkey → Quick Note 出现并聚焦：PASS
4. Settings 修改 Hotkey 后无需重启立即生效：PASS
5. OLD Hotkey 立即失效：PASS
6. AgentTips 退出重启后 NEW Hotkey 仍然生效：PASS

## z-order 人工项（Quick Note 普通窗口层级）

Hotkey 打开 Quick Note → 点击其他应用 → Quick Note 正常退到后面 → 再按 Hotkey →
Quick Note 回到前台且草稿保留。

状态：**PENDING USER MANUAL SMOKE** —— 该行为已由
`pnpm test:global-hotkey` B/C/D 场景自动化验证（点击 Notepad 后 Quick Note
非 topmost 且保留、再次 Hotkey 回前台草稿保留、最小化后 Hotkey 恢复聚焦），
但用户尚未实机确认，不得虚构 PASS。

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
