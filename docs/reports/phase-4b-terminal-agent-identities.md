# Phase 4B Terminal Agent Identities

日期：2026-08-07

基于本机 `scripts/probe-terminal-topology.ps1` 真实探测。脱敏：不记录完整用户路径、
完整 CommandLine、Prompt 或项目名。

| Agent       | Observed executable               | Wrapper runtime             | Sanitized package marker     | Parent/ancestor topology       | Session anchor                | Local verification |
| ----------- | --------------------------------- | --------------------------- | ---------------------------- | ------------------------------ | ----------------------------- | ------------------ |
| Codex CLI   | `codex.cmd` / `node.exe`          | node.exe                    | `@openai/codex` / `codex.js` | npm 全局 → node.exe → codex.js | Windows Terminal 单 Tab shell | VERIFIED           |
| Claude Code | `claude.exe`                      | 原生 exe（无 node wrapper） | `@anthropic-ai/claude-code`  | npm 全局 → claude.exe          | Windows Terminal 单 Tab shell | VERIFIED           |
| OpenCode    | 未安装（`where opencode` 无结果） | N/A                         | `opencode`                   | N/A                            | N/A                           | NOT INSTALLED      |

## 排除项（不是 CLI Agent）

- `%LOCALAPPDATA%\OpenAI\Codex\bin\...\codex.exe`：Codex Desktop（ChatGPT 应用内置），
  父进程为 ChatGPT.exe → 规则通过 `OpenAI\Codex\bin` 路径 marker 排除。
- `bun.exe`（`@bitkyc08/opencodex`）：非标准 OpenCode → 规则通过 `opencodex` marker 排除。

## Windows Terminal 拓扑（Probe 实证）

单 Tab：

```
WindowsTerminal.exe
├── OpenConsole.exe
└── cmd.exe / powershell.exe   ← 唯一 shell 子进程 = 可靠 session anchor
```

多 Tab：

```
WindowsTerminal.exe
├── OpenConsole.exe + cmd.exe (Tab A)
├── OpenConsole.exe + cmd.exe (Tab B)
```

每个 tab 的 shell 均为 WindowsTerminal 直接子进程，Win32 无公开只读 API
将前台 WindowsTerminal 映射到活动 tab 的 shell PID →
多 Tab 场景返回 `TERMINAL_SESSION_AMBIGUOUS`，不猜测。

## Blocker

`RELIABLE_ACTIVE_TERMINAL_SESSION_CORRELATION`：

- 可靠支持：Windows Terminal 单 Tab、Direct Console（conhost/pwsh/cmd）。
- 不可靠：Windows Terminal 多 Tab / 多 Pane 活动会话关联 → Unavailable。
- 后续可选路线：显式 Shell Integration / Terminal Bridge（Phase 另行决策）。
