# Phase 4A 人工 Desktop Detection Smoke 报告

- 日期：2026-08-07
- 状态：**PENDING USER MANUAL SMOKE** —— 工程实现与自动化运行时测试已完成，
  以下逐项结果未经用户实机确认，不得视为 PASS。

## 目标应用

| 目标            | 本机安装状态 | 自动化（真实前台 probe）                                                                                                | 人工结果 |
| --------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| Cursor          | 已安装       | EXE=`Cursor.exe`、PATH=`%LOCALAPPDATA%\Programs\cursor\Cursor.exe`、CLASS=`Chrome_WidgetWin_1`（实测）                  | PENDING  |
| ChatGPT Desktop | 已安装       | EXE=`ChatGPT.exe`、PATH=`%ProgramFiles%\WindowsApps\OpenAI.Codex_*\app\ChatGPT.exe`、CLASS=`Chrome_WidgetWin_1`（实测） | PENDING  |
| Trae            | 已安装       | EXE=`Trae.exe`、PATH=`%LOCALAPPDATA%\Programs\Trae(In)\Trae.exe`、CLASS=`Chrome_WidgetWin_1`（实测）                    | PENDING  |

## 非目标（应 NoMatch）

| 目标             | 预期    | 自动化                                               | 人工结果 |
| ---------------- | ------- | ---------------------------------------------------- | -------- |
| Chrome           | NoMatch | Notepad 等价场景自动化 PASS（NoMatch + processName） | PENDING  |
| Explorer         | NoMatch | 未自动验证                                           | PENDING  |
| Windows Terminal | NoMatch | 未自动验证（Phase 4B 之前）                          | PENDING  |

## 需要人工验证的步骤

1. 前台切到 Cursor → `desktop_detection_get_current` 返回 Matched(Cursor)。
2. 前台切到 ChatGPT Desktop → Matched(ChatGPT Desktop)。
3. 前台切到 Trae → Matched(Trae)。
4. 前台切到 Chrome → NoMatch。
5. 前台切到 Explorer → NoMatch。
6. 前台切到 Windows Terminal → NoMatch。

人工验证方式：任意应用前台时通过 Tauri 诊断命令或测试脚本查询
`desktop_detection_get_current`，确认状态与上表一致。

## 自动化已覆盖

`pnpm test:desktop-detection`（独立测试数据库）已验证：

- Notepad 前台 → NoMatch + `processName=Notepad.exe`；
- Hotkey 打开 Quick Note → SelfWindow 且 effective 状态保持；
- 切回 Notepad → NoMatch、无 duplicate entry；
- Quick Note ↔ Notepad 快速切换 ×3 无 panic；
- Tray-only（全隐藏）watcher 仍运行；Quit 后进程结束。
