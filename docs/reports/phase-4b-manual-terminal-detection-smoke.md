# Phase 4B 人工 Terminal Detection Smoke 报告

- 日期：2026-08-07
- 状态：**PENDING USER MANUAL SMOKE** —— 工程实现与自动化运行时测试已完成，
  以下逐项结果未经用户实机确认，不得视为 PASS。

| 场景                        | 预期                 | 自动化                                          | 人工结果      |
| --------------------------- | -------------------- | ----------------------------------------------- | ------------- |
| Windows Terminal 普通 shell | NoMatch              | PASS（单 Tab fixture）                          | PENDING       |
| Codex 单 session            | Matched(codex)       | 待用户/测试验证                                 | PENDING       |
| Claude 单 session           | Matched(claude-code) | 待用户/测试验证                                 | PENDING       |
| OpenCode 单 session         | Matched(opencode)    | NOT INSTALLED（本机无 opencode）                | NOT INSTALLED |
| Codex 退出                  | NoMatch              | PASS（fixture exit）                            | PENDING       |
| Codex vs plain 多 Tab       | 活动 tab 精确识别    | Ambiguous → Unavailable（正确拒绝猜）           | PENDING       |
| Codex vs Claude 多 Tab      | 活动 tab 精确识别    | Ambiguous → Unavailable                         | PENDING       |
| 多 Pane                     | 精确识别             | NOT SUPPORTED（同 session correlation blocker） | NOT SUPPORTED |
| Direct PowerShell           | NoMatch / Matched    | PASS（ConsoleHost 路径）                        | PENDING       |
| cmd                         | NoMatch / Matched    | PASS（ConsoleHost 路径）                        | PENDING       |
| WSL                         | 检测                 | OUT OF SCOPE / PENDING FUTURE TERMINAL BRIDGE   | PENDING       |

## 关键限制（不得误读为 PASS）

- **Windows Terminal 多 Tab / 多 Pane 活动会话关联**：
  Probe 证实 Win32 无公开只读 API 区分活动 tab → 返回
  `TERMINAL_SESSION_AMBIGUOUS`（Unavailable），不猜测。正确性优先。
- 单 Tab 与 Direct Console 场景可靠；多 Tab 人工验证前不得声明支持。

## 自动化已覆盖

`pnpm test:terminal-detection`（独立测试数据库）：单 Tab 普通 shell NoMatch、
单 Tab 内 node wrapper fixture Matched、退出 NoMatch、多 Tab Ambiguous、
Quick Note SelfWindow 保持 effective。
