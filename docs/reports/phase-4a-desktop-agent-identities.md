# Phase 4A Desktop Agent Identities

日期：2026-08-07

本机通过 `scripts/probe-foreground-context.ps1` 对真实前台窗口采集身份。
路径已脱敏：使用 `%LOCALAPPDATA%` / `%ProgramFiles%` 等占位，不记录完整用户路径。

| Agent           | Observed executable        | Path identity                                                                              | Window class         | Title 参与规则 | Identity anchor                                            | Rule status                |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------ | -------------------- | -------------- | ---------------------------------------------------------- | -------------------------- |
| Cursor          | `Cursor.exe`               | `%LOCALAPPDATA%\Programs\cursor\Cursor.exe`                                                | `Chrome_WidgetWin_1` | 否             | exact executable + path hint `programs\cursor`             | VERIFIED（真实前台 probe） |
| ChatGPT Desktop | `ChatGPT.exe`              | `%ProgramFiles%\WindowsApps\OpenAI.Codex_*\app\ChatGPT.exe`（版本号不参与匹配）            | `Chrome_WidgetWin_1` | 否             | exact executable + path marker `windowsapps\openai.codex_` | VERIFIED（真实前台 probe） |
| Trae            | `Trae.exe` / `Trae CN.exe` | `%LOCALAPPDATA%\Programs\Trae(In)\Trae.exe`、`%LOCALAPPDATA%\Programs\Trae CN\Trae CN.exe` | `Chrome_WidgetWin_1` | 否             | exact executable + path hint `programs\trae`               | VERIFIED（真实前台 probe） |

## 防标题误判

- 检测匹配只依赖 executable basename + 可选 path/class hints；window title 不参与匹配。
- 已覆盖单测：Chrome 标题含 “ChatGPT” → NoMatch；VS Code 标题含 “cursor-agent-study” → NoMatch；Notepad 标题含 “Trae” → NoMatch。

## 规则来源

三条规则均为本机真实前台采集（`EXE/PATH/CLASS` 三字段实测），
无 “根据记忆猜测” 的 identity anchor。ChatGPT Desktop 的
`WindowsApps\OpenAI.Codex_` 为包级 marker（不含版本号，避免版本升级后失配）。
