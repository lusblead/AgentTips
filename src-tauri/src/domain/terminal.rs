use serde::Serialize;

/// 终端宿主分类（基于 executable identity + verified window class，禁止标题识别）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalHostKind {
    WindowsTerminal,
    ConsoleHost,
    UnknownTerminal,
    NotTerminal,
}

/// 进程身份（纯 Domain，无 Windows 类型）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub parent_pid: u32,
    pub executable_name: String,
    /// 已脱敏路径 marker（如 "%PROGRAMFILES%\..." 或包路径片段）。
    pub executable_path_marker: Option<String>,
    /// 已提取的身份 marker（如 "@openai/codex"、"claude"），非完整命令行。
    pub command_marker: Option<String>,
    /// 进程创建时间（UTC），用于 PID reuse 防护。
    pub created_at: Option<String>,
}

/// 终端会话锚点：我们为什么认为这些进程属于当前终端上下文。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalSessionAnchor {
    /// Windows Terminal 单 Tab：唯一 shell 子进程。
    VerifiedTerminalSession { shell_pid: u32 },
    /// 直接 Console Host：前台即 shell。
    DirectConsoleProcess { pid: u32 },
}

/// 终端观测结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalObservation {
    /// 已解析当前 session 且其中无受支持 Agent。
    NoTerminalAgent,
    /// 当前 session 中存在受支持 Agent（由 TerminalAgentDetector 再解析具体 agent）。
    Resolved {
        anchor: TerminalSessionAnchor,
        candidates: Vec<ProcessIdentity>,
    },
    /// 结构性无法判断（多 Tab / 多 Pane / 无法关联）。
    Ambiguous { reason: String },
    /// 瞬时失败（快照失败 / 权限 / 进程消失）。
    Unavailable { reason: String },
}

/// 终端 CLI Agent 规则（数据驱动）。
#[derive(Debug, Clone)]
pub struct TerminalAgentRule {
    pub agent_id: &'static str,
    /// 直接可执行 basename（大小写不敏感，精确匹配非 substring）。
    pub direct_executables: &'static [&'static str],
    /// wrapper 运行时 basename（如 node.exe / bun.exe）。
    pub wrapper_executables: &'static [&'static str],
    /// wrapper 运行时所需命令行 marker（如 "@openai/codex"）。
    pub wrapper_command_markers: &'static [&'static str],
    /// 必须排除的路径 marker（如 Codex Desktop 的 %LOCALAPPDATA%\\OpenAI\\Codex\\bin）。
    pub excluded_path_markers: &'static [&'static str],
}

/// 终端匹配证据（替代置信度数字）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalMatchKind {
    TerminalDirectExecutable,
    TerminalWrapperCommand,
}

pub const CODE_PIPELINE_TERMINAL_SESSION_AMBIGUOUS: &str = "TERMINAL_SESSION_AMBIGUOUS";
pub const CODE_MULTIPLE_TERMINAL_AGENT_CANDIDATES: &str = "MULTIPLE_TERMINAL_AGENT_CANDIDATES";
pub const CODE_TERMINAL_PROCESS_SNAPSHOT_FAILED: &str = "TERMINAL_PROCESS_SNAPSHOT_FAILED";
pub const CODE_TERMINAL_PROCESS_DISAPPEARED: &str = "TERMINAL_PROCESS_DISAPPEARED";
pub const CODE_TERMINAL_PROCESS_ACCESS_DENIED: &str = "TERMINAL_PROCESS_ACCESS_DENIED";
pub const CODE_TERMINAL_IDENTITY_UNAVAILABLE: &str = "TERMINAL_IDENTITY_UNAVAILABLE";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_observation_variants_are_distinct() {
        let a = TerminalObservation::Ambiguous {
            reason: CODE_PIPELINE_TERMINAL_SESSION_AMBIGUOUS.into(),
        };
        let u = TerminalObservation::Unavailable {
            reason: CODE_TERMINAL_PROCESS_SNAPSHOT_FAILED.into(),
        };
        let n = TerminalObservation::NoTerminalAgent;
        assert_ne!(a, u);
        assert_ne!(a, n);
        assert_ne!(u, n);
    }

    #[test]
    fn process_identity_roundtrip() {
        let p = ProcessIdentity {
            pid: 42,
            parent_pid: 1,
            executable_name: "node.exe".into(),
            executable_path_marker: Some("%PROGRAMFILES%\\nodejs\\node.exe".into()),
            command_marker: Some("@openai/codex".into()),
            created_at: Some("2026-08-07T00:00:00Z".into()),
        };
        assert_eq!(p.executable_name, "node.exe");
        assert_eq!(p.command_marker.as_deref(), Some("@openai/codex"));
    }
}
