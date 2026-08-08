# Phase 4A 人工 Desktop Detection Smoke 报告

- 日期：2026-08-07
- 状态：**PASS — user manually verified desktop agent detection**
  （Cursor / ChatGPT Desktop / Trae 正向命中；Microsoft Edge / Explorer /
  Windows Terminal NoMatch；SelfWindow 语义不产生二次 Entered）

## 正向目标（用户实机切换确认）

| 目标            | raw     | agent           | process     | matchKind         | 结果 |
| --------------- | ------- | --------------- | ----------- | ----------------- | ---- |
| Cursor          | Matched | cursor          | Cursor.exe  | ExecutableAndPath | PASS |
| ChatGPT Desktop | Matched | chatgpt-desktop | ChatGPT.exe | ExecutableAndPath | PASS |
| Trae            | Matched | trae            | Trae.exe    | ExecutableAndPath | PASS |

## 非目标（应 NoMatch）

| 目标             | 实际进程            | raw            | 结果                                         |
| ---------------- | ------------------- | -------------- | -------------------------------------------- |
| Microsoft Edge   | msedge.exe          | NoMatch        | PASS                                         |
| Windows Explorer | explorer.exe        | NoMatch        | PASS                                         |
| Windows Terminal | WindowsTerminal.exe | NoMatch        | PASS                                         |
| Chrome           | chrome.exe          | 本轮未实际观察 | **PENDING**（不得以 msedge.exe 冒充 Chrome） |

## SelfWindow 关键语义（Cursor → Quick Note → Cursor）

1. Cursor foreground：
   - raw：`Matched(cursor)`
   - effective：`cursor`
2. Hotkey 打开 Quick Note：
   - raw：`SelfWindow`
   - process：`agent-tips.exe`
   - effective：`cursor`（保持）
   - transition：`None`
3. 返回 Cursor：
   - raw：`Matched(cursor)`
   - effective：`cursor`
   - transition：`None`

**结论：PASS — AgentTips SelfWindow does not clear or re-enter the effective
external Cursor agent. Quick Note interruption did not produce a second
Entered(cursor) transition.**

权威依据：Rust 运行时 transition 日志中
`process_basename=agent-tips.exe` 的 `desktop_detection_changed` 记录数为 0。

## Known Notes

- temporary observer could display stale previous transition;
  authoritative runtime transition log was used for verification.
  （临时观察器偶尔把旧 transition 与新 SelfWindow raw state 显示在同一行，
  属采样竞态；最终判定以权威 Rust transition 日志为准。）
- 本轮浏览器进程为 `msedge.exe`（Microsoft Edge），因此 Edge=NoMatch PASS；
  Chrome 未在本轮观察到 `chrome.exe`，保持 PENDING。

## 自动化已覆盖

`pnpm test:desktop-detection`（独立测试数据库）已验证：

- Notepad 前台 → NoMatch + `processName=Notepad.exe`；
- Hotkey 打开 Quick Note → SelfWindow 且 effective 状态保持；
- 切回 Notepad → NoMatch、无 duplicate entry；
- Quick Note ↔ Notepad 快速切换 ×3 无 panic；
- Tray-only（全隐藏）watcher 仍运行；Quit 后进程结束。
