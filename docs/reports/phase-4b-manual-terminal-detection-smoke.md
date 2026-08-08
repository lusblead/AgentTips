# Phase 4B 人工 Terminal Detection Smoke 报告

- 日期：2026-08-08
- 状态：**PARTIAL PASS WITH EXPLICIT ENVIRONMENTAL PENDING ITEM**

## 最终状态

- Engineering：PASS / COMPLETE
- Automated Windows Runtime：PASS
- Manual Smoke：PARTIAL PASS WITH EXPLICIT ENVIRONMENTAL PENDING ITEM
- Core correctness blocker：NONE
- Known structural limitation：RELIABLE_ACTIVE_TERMINAL_SESSION_CORRELATION
  （Windows Terminal multi-tab / pane）
  - 已通过 `Unavailable(TERMINAL_SESSION_AMBIGUOUS)` 安全降级，
    不产生错误 Agent 识别。

## 逐项人工结果

### 1. Windows Terminal 单 Tab 普通 shell

- 预期：NoMatch
- 实际：NoMatch（`terminalStatus=terminal_no_agent`）
- 结果：**PASS**

### 2. Codex CLI 启动并检测

- 状态：**PENDING — EXTERNAL ENVIRONMENT BLOCKER**
- 原因：本机 Codex CLI 0.133.0 在进入正常交互运行态之前，
  因用户现有外部 config.toml 中 `[agents]` 段格式与当前版本不兼容而退出。
  没有修改 Codex 配置。这不是 AgentTips Detection Failure。
- 现有证据：
  - Codex CLI identity probe = VERIFIED
  - node.exe + codex.js / @openai/codex marker = VERIFIED
  - Terminal wrapper rule tests = PASS
  - Windows terminal detection fixture = PASS
  - unrelated Codex Desktop process exclusion = PASS
- 真实 Codex runtime manual smoke 保留为 deferred verification。

### 3. Codex exit → NoMatch

- 状态：**PENDING**
- 原因：依赖场景 2 能成功进入 Codex 运行态。

### 4. Claude Code

- 实际：Matched(claude-code)
- matchKind：TerminalDirectExecutable
- 结果：**PASS**

### 5. Claude Code exit

- 实际：Left(claude-code) → NoMatch
- 结果：**PASS**

### 6. Windows Terminal 多 Tab（Claude + 普通 shell）

- 实际：两个 Tab 均返回 `Unavailable(TERMINAL_SESSION_AMBIGUOUS)`
- 普通 shell 无 Claude 误报。
- 结果：**PASS**
- 说明：Phase 4B 的正确产品语义就是：无法可靠关联活动 Tab 时返回
  Unavailable，而不是猜测当前 Agent。

### 7. Agent → Quick Note → Agent

- 实际：Matched(codex) → SelfWindow → Matched(codex)
- SelfWindow 期间 effective agent 保持 codex
- 不产生重复 Entered(agent)
- 结果：**PASS**
- 本轮由真实 detection runtime / fixture 等价路径验证。

### 8. OpenCode

- 状态：NOT INSTALLED（不得标记 PASS）

### 9. Multi-pane

- 状态：NOT SUPPORTED
- 原因：RELIABLE_ACTIVE_TERMINAL_SESSION_CORRELATION blocker。

### 10. WSL

- 状态：OUT OF SCOPE / PENDING FUTURE TERMINAL BRIDGE

## Deferred Manual Verification

- 项目：CODEX_CLI_REAL_RUNTIME_SMOKE
- 状态：PENDING
- Blocker：EXTERNAL_CODEX_CONFIG_INCOMPATIBLE
- 未来只有在用户正常恢复 Codex CLI 可运行后，再执行：
  - ordinary shell → NoMatch
  - codex → Matched(codex)
  - exit → NoMatch
- 不得为了此验证修改 Codex Runtime 或用户配置。

## 清理状态

- smoke AgentTips process stopped
- observer stopped
- test Windows Terminal instances closed
- ports 9239 / 1420 released
- no remaining agent-tips / OpenConsole smoke processes
- formal user DB unchanged
- temporary diagnostic artifacts moved under `%TEMP%`
  因为本地策略阻止直接 Remove-Item
- TEMP artifact 本身不是仓库内容，不需要为了删除它绕过系统策略。
- 不得尝试修改系统安全策略。

## 自动化已覆盖

`pnpm test:terminal-detection`（独立测试数据库）：单 Tab 普通 shell NoMatch、
单 Tab 内 node wrapper fixture Matched、退出 NoMatch、多 Tab Ambiguous、
Quick Note SelfWindow 保持 effective。
