<div align="center">
  <h1>AgentTips</h1>
  <p><strong>给 AI 编程 Agent 使用者的 Windows 本地便签</strong></p>
  <p>随时记录上下文，在对应桌面应用或终端 Agent 激活时看到真正相关的提醒。</p>
  <p>
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white">
    <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white">
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
    <img alt="Rust 2021" src="https://img.shields.io/badge/Rust-2021-000000?logo=rust&logoColor=white">
    <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green">
  </p>
</div>

AgentTips 解决一个很具体的问题：使用多个 AI 编程工具时，重要约束、待办和上下文经常散落在聊天记录或临时文本里。它把这些内容保存为本地便签，并根据当前激活的 Agent 进行筛选和提醒。

数据默认只保存在本机 SQLite 数据库中。AgentTips 不接入 LLM API，也不会自动把便签内容发送给任何 Agent。

## 主要功能

- **全局快捷记录**：默认按 `Ctrl + F12` 打开紧凑的新建便签窗口；快捷键可在设置中重新录制。
- **无标题便签**：新便签直接填写正文，不需要额外维护标题。
- **自由标签**：标签由使用者直接输入，也可以复用过去写过的标签。
- **Agent 绑定**：可先在设置中选择自己使用的 Agent；一条便签可绑定一个、多个或不绑定 Agent，停用 Agent 不会删除已有绑定。
- **自动识别**：通过 Windows 前台窗口和终端进程树识别当前桌面或命令行 Agent。
- **冷却与稍后提醒**：按 Agent 独立控制提醒冷却时间；既可在提醒弹窗暂停当前 Agent，也可在设置中直接选择任意 Agent 暂停 1、2、4、8 或 24 小时并单独恢复。
- **便签管理**：支持搜索、Agent 筛选、直接编辑、彩色便签、标记已使用、撤销和恢复。
- **桌面运行体验**：支持多窗口、系统托盘、单实例运行和未保存草稿保护；左键单击托盘图标可直接唤出主界面。

## 内置 Agent

| 类型       | 当前内置识别目标             |
| ---------- | ---------------------------- |
| 桌面应用   | ChatGPT、Cursor、Trae        |
| 终端 Agent | Codex、Claude Code、OpenCode |

识别依赖应用进程名、安装路径和终端命令特征。上游应用升级后，如果这些身份信息发生变化，可能需要同步更新 AgentTips 的识别规则。

## 快速开始

### 安装发布版

前往 [GitHub Releases](https://github.com/lusblead/AgentTips/releases/latest) 下载对应系统架构的安装包：Windows x64 用户选择 `.exe`（NSIS，推荐）或 `.msi`，32 位 Windows 用户选择标有 `x86` 的 `.exe` 或 `.msi`。Release 同时提供 `SHA256SUMS.txt`，可用于核对下载文件的 SHA-256 摘要。

当前安装包尚未进行代码签名，Windows 可能显示 Microsoft Defender SmartScreen 提示。请只从本仓库的 GitHub Releases 下载，并在继续安装前核对发布者、版本与摘要。

### 源码环境要求

- Windows
- Node.js 与 pnpm
- Rust stable（MSVC 工具链）
- WebView2 Runtime

### 从源码运行

```powershell
git clone https://github.com/lusblead/AgentTips.git
Set-Location AgentTips
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm tauri dev` 会启动 Vite、Cargo 和 Tauri 开发进程，适合调试，不适合作为日常桌面快捷方式。首次配置或源码更新后，可构建 Release 程序并安装无控制台的桌面快捷方式：

```powershell
pnpm desktop:install
```

之后直接打开桌面的 `AgentTips`；快捷方式会启动 `src-tauri/target/release/agent-tips.exe`，不会经过 CMD、pnpm 或开发服务器。

首次启动后：

1. 按 `Ctrl + F12` 打开快捷便签。
2. 写入正文，并按需添加标签、绑定 Agent、开启默认携带。
3. 保存后可在主窗口继续搜索、编辑或标记为已使用。
4. 在设置中选择自己使用的 Agent，按 Agent 独立暂停或恢复提醒，并可修改全局快捷键和默认提醒冷却时间。

如果默认快捷键被其他软件占用，请从主窗口菜单进入“设置”，重新录制一个 `Ctrl + 单键` 组合。切换失败时应用会保留原快捷键。

## 构建 Windows 安装包

```powershell
pnpm install --frozen-lockfile
pnpm tauri build
```

构建产物位于：

```text
src-tauri/target/release/bundle/
```

## 数据与隐私

- 正式数据保存在 `%APPDATA%\com.agenttips.app\agenttips.sqlite3`。
- 当前实现没有云同步、账号系统、遥测或 LLM API 请求。
- SQLite 文件未做额外的应用层加密，请不要保存密码、令牌或其他高敏感信息。
- 备份数据库前建议先从系统托盘完全退出 AgentTips，避免复制到正在写入的数据库状态。

## 本地开发

只调试 React 界面时，可以使用浏览器 Mock 模式：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

浏览器模式使用内存 Mock 数据，不代表真实 SQLite、全局快捷键或 Windows Agent 检测行为。原生能力请通过 `pnpm tauri dev` 验证。

常用质量检查：

```powershell
pnpm format:check
pnpm check:architecture
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Windows 原生运行链路还可以分别执行：

```powershell
pnpm test:windows-runtime
pnpm test:global-hotkey
pnpm test:desktop-detection
pnpm test:terminal-detection
pnpm test:reminder-runtime
```

## 项目结构

```text
src/                    React 界面、Desktop API 契约与适配器
src-tauri/src/          Rust 领域、应用、端口、适配器和 Tauri Commands
src-tauri/migrations/   SQLite 迁移
e2e/                    Playwright 行为测试
scripts/                架构检查与 Windows 运行验证
```

## 当前边界

- 当前只支持 Windows 原生运行；Release 提供 x86 与 x64 安装包，暂不提供 ARM64 安装包。
- 不提供云同步、跨设备同步、浏览器扩展或自动向 Agent 发送内容。
- Agent 识别是基于本机进程身份的规则匹配，不是外部应用提供的稳定集成接口。
- 当前没有代码签名证书；GitHub Release 和源码构建的安装包都可能触发 Windows 安全提示。

## 参与贡献

欢迎通过 [Issues](https://github.com/lusblead/AgentTips/issues) 报告可复现问题或提出改进建议。提交 Pull Request 前，请至少运行与变更相关的前端测试、Rust 测试和构建检查，并避免提交本地数据库、运行日志或生成产物。提交贡献即表示同意按本项目的 MIT License 许可该贡献。

## 许可证

本项目采用 [MIT License](LICENSE)。
