use std::collections::HashMap;

use crate::domain::detection::{DetectionResult, MatchKind};
use crate::domain::foreground::ForegroundContext;
use crate::domain::terminal::{
    ProcessIdentity, TerminalAgentRule, TerminalHostKind, TerminalMatchKind, TerminalObservation,
    TerminalSessionAnchor, CODE_MULTIPLE_TERMINAL_AGENT_CANDIDATES,
    CODE_PIPELINE_TERMINAL_SESSION_AMBIGUOUS,
};
use crate::error::AppResult;
use crate::ports::terminal::{ProcessTreeProviderPort, TerminalContextProviderPort};

/// Terminal Host 分类：基于 executable identity + verified window class。
pub struct TerminalHostClassifier {
    windows_terminal_basenames: Vec<String>,
    console_host_basenames: Vec<String>,
    windows_terminal_class: String,
    console_host_class: String,
}

impl TerminalHostClassifier {
    pub fn new() -> Self {
        Self {
            windows_terminal_basenames: vec!["windowsterminal.exe".into()],
            console_host_basenames: vec![
                "conhost.exe".into(),
                "openconsole.exe".into(),
                "pwsh.exe".into(),
                "powershell.exe".into(),
                "cmd.exe".into(),
                "windows_qtconsole.exe".into(),
            ],
            windows_terminal_class: "cascadia_hosting_window_class".into(),
            console_host_class: "consolewindowclass".into(),
        }
    }

    pub fn classify(&self, context: &ForegroundContext) -> TerminalHostKind {
        let Some(exe) = context.executable_name.as_deref() else {
            return TerminalHostKind::NotTerminal;
        };
        let exe_lower = exe.to_lowercase();
        let class_lower = context.window_class.as_deref().unwrap_or("").to_lowercase();

        if self
            .windows_terminal_basenames
            .iter()
            .any(|b| b == &exe_lower)
            || class_lower == self.windows_terminal_class
        {
            return TerminalHostKind::WindowsTerminal;
        }
        if self.console_host_basenames.iter().any(|b| b == &exe_lower)
            || class_lower == self.console_host_class
        {
            return TerminalHostKind::ConsoleHost;
        }
        TerminalHostKind::NotTerminal
    }
}

impl Default for TerminalHostClassifier {
    fn default() -> Self {
        Self::new()
    }
}

/// 终端 CLI Agent 检测器：数据驱动规则。
pub struct TerminalAgentDetector {
    pub rules: Vec<TerminalAgentRule>,
}

impl TerminalAgentDetector {
    pub fn new(rules: Vec<TerminalAgentRule>) -> Self {
        Self { rules }
    }

    /// 从候选进程集合解析出唯一 agent。
    /// 多个不同 agent → MULTIPLE_TERMINAL_AGENT_CANDIDATES (Unavailable)。
    pub fn detect(&self, candidates: &[ProcessIdentity]) -> DetectionResult {
        let mut matched: HashMap<String, TerminalMatchKind> = HashMap::new();
        for process in candidates {
            if let Some((agent, kind)) = self.match_process(process) {
                matched.insert(agent, kind);
            }
        }
        if matched.len() == 1 {
            let (agent, kind) = matched.into_iter().next().unwrap();
            let match_kind = match kind {
                TerminalMatchKind::TerminalDirectExecutable => MatchKind::TerminalDirectExecutable,
                TerminalMatchKind::TerminalWrapperCommand => MatchKind::TerminalWrapperCommand,
            };
            return DetectionResult::Matched {
                agent_id: agent,
                match_kind,
            };
        }
        if matched.len() > 1 {
            return DetectionResult::Unavailable {
                reason: CODE_MULTIPLE_TERMINAL_AGENT_CANDIDATES.into(),
            };
        }
        DetectionResult::NoMatch
    }

    fn match_process(&self, process: &ProcessIdentity) -> Option<(String, TerminalMatchKind)> {
        let exe = process.executable_name.to_lowercase();
        let path = process
            .executable_path_marker
            .as_deref()
            .unwrap_or("")
            .to_lowercase();
        let marker = process
            .command_marker
            .as_deref()
            .unwrap_or("")
            .to_lowercase();

        for rule in &self.rules {
            // 排除项优先（如 Codex Desktop 的 %LOCALAPPDATA%\OpenAI\Codex\bin）
            if rule
                .excluded_path_markers
                .iter()
                .any(|m| path.contains(&m.to_lowercase()))
            {
                continue;
            }
            // 直接可执行
            if rule
                .direct_executables
                .iter()
                .any(|d| d.to_lowercase() == exe)
            {
                return Some((
                    rule.agent_id.into(),
                    TerminalMatchKind::TerminalDirectExecutable,
                ));
            }
            // wrapper 运行时 + 命令行 marker
            if rule
                .wrapper_executables
                .iter()
                .any(|w| w.to_lowercase() == exe)
                && rule
                    .wrapper_command_markers
                    .iter()
                    .any(|m| marker.contains(&m.to_lowercase()))
            {
                return Some((
                    rule.agent_id.into(),
                    TerminalMatchKind::TerminalWrapperCommand,
                ));
            }
        }
        None
    }
}

/// 终端上下文提供者：基于 foreground + 进程树解析当前 session。
pub struct WindowsTerminalContextProvider {
    process_tree: Box<dyn ProcessTreeProviderPort>,
    classifier: TerminalHostClassifier,
}

impl WindowsTerminalContextProvider {
    pub fn new(
        process_tree: Box<dyn ProcessTreeProviderPort>,
        classifier: TerminalHostClassifier,
    ) -> Self {
        Self {
            process_tree,
            classifier,
        }
    }
}

impl TerminalContextProviderPort for WindowsTerminalContextProvider {
    fn classify(&self, context: &ForegroundContext) -> TerminalHostKind {
        self.classifier.classify(context)
    }

    fn observe(&self, context: &ForegroundContext) -> AppResult<TerminalObservation> {
        let host = self.classifier.classify(context);
        match host {
            TerminalHostKind::WindowsTerminal => {
                // Windows Terminal 单 Tab：唯一的 shell 子进程即为当前 session。
                let children = self.process_tree.descendants_of(context.process_id)?;
                let shells: Vec<&ProcessIdentity> =
                    children.iter().filter(|p| is_shell(p)).collect();
                match shells.len() {
                    0 => Ok(TerminalObservation::NoTerminalAgent),
                    1 => {
                        let anchor = TerminalSessionAnchor::VerifiedTerminalSession {
                            shell_pid: shells[0].pid,
                        };
                        // 只取该 shell 的 descendants（真实进程树）
                        let candidates = self.process_tree.descendants_of(shells[0].pid)?;
                        let enriched = self.enrich_wrappers(candidates)?;
                        Ok(TerminalObservation::Resolved {
                            anchor,
                            candidates: enriched,
                        })
                    }
                    _ => Ok(TerminalObservation::Ambiguous {
                        reason: CODE_PIPELINE_TERMINAL_SESSION_AMBIGUOUS.into(),
                    }),
                }
            }
            TerminalHostKind::ConsoleHost => {
                // Direct Console：前台进程即当前 shell。
                let anchor = TerminalSessionAnchor::DirectConsoleProcess {
                    pid: context.process_id,
                };
                let candidates = self.process_tree.descendants_of(context.process_id)?;
                let enriched = self.enrich_wrappers(candidates)?;
                Ok(TerminalObservation::Resolved {
                    anchor,
                    candidates: enriched,
                })
            }
            _ => Ok(TerminalObservation::NoTerminalAgent),
        }
    }
}

impl WindowsTerminalContextProvider {
    /// 对 wrapper 运行时（node/bun）按需补充 command marker（仅候选进程）。
    fn enrich_wrappers(&self, candidates: Vec<ProcessIdentity>) -> AppResult<Vec<ProcessIdentity>> {
        let mut enriched = Vec::with_capacity(candidates.len());
        for mut process in candidates {
            let exe = process.executable_name.to_lowercase();
            if matches!(exe.as_str(), "node.exe" | "bun.exe") && process.command_marker.is_none() {
                process.command_marker = self.process_tree.command_marker_of(process.pid)?;
            }
            enriched.push(process);
        }
        Ok(enriched)
    }
}

fn is_shell(p: &ProcessIdentity) -> bool {
    let exe = p.executable_name.to_lowercase();
    matches!(
        exe.as_str(),
        "cmd.exe"
            | "powershell.exe"
            | "pwsh.exe"
            | "wsl.exe"
            | "bash.exe"
            | "sh.exe"
            | "zsh.exe"
            | "fish.exe"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::terminal::ProcessIdentity;
    use std::sync::Mutex;

    fn proc(
        pid: u32,
        parent: u32,
        exe: &str,
        path: Option<&str>,
        marker: Option<&str>,
    ) -> ProcessIdentity {
        ProcessIdentity {
            pid,
            parent_pid: parent,
            executable_name: exe.into(),
            executable_path_marker: path.map(|s| s.into()),
            command_marker: marker.map(|s| s.into()),
            created_at: None,
        }
    }

    #[derive(Default)]
    struct FakeTree {
        procs: Mutex<Vec<ProcessIdentity>>,
    }

    impl FakeTree {
        fn with(self, p: ProcessIdentity) -> Self {
            self.procs.lock().unwrap().push(p);
            self
        }
    }

    impl ProcessTreeProviderPort for FakeTree {
        fn snapshot(&self) -> AppResult<Vec<ProcessIdentity>> {
            Ok(self.procs.lock().unwrap().clone())
        }
        fn descendants_of(&self, root: u32) -> AppResult<Vec<ProcessIdentity>> {
            let all = self.procs.lock().unwrap().clone();
            let mut result = vec![];
            let mut frontier = vec![root];
            while let Some(pid) = frontier.pop() {
                for p in all.iter() {
                    if p.parent_pid == pid {
                        result.push(p.clone());
                        frontier.push(p.pid);
                    }
                }
            }
            Ok(result)
        }
        fn ancestor_chain(&self, pid: u32) -> AppResult<Vec<ProcessIdentity>> {
            let all = self.procs.lock().unwrap().clone();
            let mut result = vec![];
            let mut current = pid;
            for _ in 0..64 {
                let parent = all.iter().find(|p| p.pid == current).map(|p| p.parent_pid);
                match parent {
                    Some(pp) if pp != current => {
                        if let Some(p) = all.iter().find(|p| p.pid == pp) {
                            result.push(p.clone());
                            current = pp;
                        } else {
                            break;
                        }
                    }
                    _ => break,
                }
            }
            Ok(result)
        }
        fn command_marker_of(&self, pid: u32) -> AppResult<Option<String>> {
            Ok(self
                .procs
                .lock()
                .unwrap()
                .iter()
                .find(|p| p.pid == pid)
                .and_then(|p| p.command_marker.clone()))
        }
    }

    fn classifier() -> TerminalHostClassifier {
        TerminalHostClassifier::new()
    }

    fn rules() -> Vec<TerminalAgentRule> {
        vec![
            TerminalAgentRule {
                agent_id: "codex",
                direct_executables: &["codex.exe"],
                wrapper_executables: &["node.exe", "bun.exe"],
                wrapper_command_markers: &["@openai/codex", "codex.js"],
                excluded_path_markers: &["openai\\codex\\bin"],
            },
            TerminalAgentRule {
                agent_id: "claude-code",
                direct_executables: &["claude.exe"],
                wrapper_executables: &["node.exe", "bun.exe"],
                wrapper_command_markers: &["@anthropic-ai/claude-code"],
                excluded_path_markers: &[],
            },
            TerminalAgentRule {
                agent_id: "opencode",
                direct_executables: &["opencode.exe"],
                wrapper_executables: &["node.exe", "bun.exe"],
                wrapper_command_markers: &["opencode"],
                excluded_path_markers: &["bitkyc08\\opencodex"],
            },
        ]
    }

    #[test]
    fn classifier_windows_terminal_by_class() {
        let ctx = ForegroundContext {
            window_id: 1,
            process_id: 10,
            executable_name: Some("WindowsTerminal.exe".into()),
            executable_path: None,
            window_class: Some("CASCADIA_HOSTING_WINDOW_CLASS".into()),
            window_title: None,
        };
        assert_eq!(
            classifier().classify(&ctx),
            TerminalHostKind::WindowsTerminal
        );
    }

    #[test]
    fn classifier_console_host_by_class() {
        let ctx = ForegroundContext {
            window_id: 1,
            process_id: 10,
            executable_name: Some("conhost.exe".into()),
            executable_path: None,
            window_class: Some("ConsoleWindowClass".into()),
            window_title: None,
        };
        assert_eq!(classifier().classify(&ctx), TerminalHostKind::ConsoleHost);
    }

    #[test]
    fn classifier_not_terminal() {
        let ctx = ForegroundContext {
            window_id: 1,
            process_id: 10,
            executable_name: Some("chrome.exe".into()),
            executable_path: None,
            window_class: Some("Chrome_WidgetWin_1".into()),
            window_title: None,
        };
        assert_eq!(classifier().classify(&ctx), TerminalHostKind::NotTerminal);
    }

    #[test]
    fn detector_codex_direct() {
        let detector = TerminalAgentDetector::new(rules());
        let candidates = vec![proc(
            1,
            0,
            "codex.exe",
            // 真实 Codex Desktop 路径（展开后无 % 占位符）
            Some(r"C:\Users\test\AppData\Local\OpenAI\Codex\bin\abc\codex.exe"),
            Some("codex"),
        )];
        // 排除 Desktop 路径 → NoMatch
        assert_eq!(detector.detect(&candidates), DetectionResult::NoMatch);
    }

    #[test]
    fn detector_codex_node_wrapper() {
        let detector = TerminalAgentDetector::new(rules());
        let candidates = vec![proc(
            2,
            1,
            "node.exe",
            Some(r"%PROGRAMFILES%\nodejs\node.exe"),
            Some("node C:\\...\\node_modules\\@openai\\codex\\bin\\codex.js"),
        )];
        match detector.detect(&candidates) {
            DetectionResult::Matched {
                agent_id,
                match_kind,
            } => {
                assert_eq!(agent_id, "codex");
                assert_eq!(match_kind, MatchKind::TerminalWrapperCommand);
            }
            other => panic!("expected codex, got {other:?}"),
        }
    }

    #[test]
    fn detector_claude_direct() {
        let detector = TerminalAgentDetector::new(rules());
        let candidates = vec![proc(
            3,
            1,
            "claude.exe",
            Some(
                r"%USERPROFILE%\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe",
            ),
            Some("claude"),
        )];
        match detector.detect(&candidates) {
            DetectionResult::Matched { agent_id, .. } => assert_eq!(agent_id, "claude-code"),
            other => panic!("expected claude, got {other:?}"),
        }
    }

    #[test]
    fn detector_plain_node_nomatch() {
        let detector = TerminalAgentDetector::new(rules());
        let candidates = vec![proc(4, 1, "node.exe", None, Some("node server.js"))];
        assert_eq!(detector.detect(&candidates), DetectionResult::NoMatch);
    }

    #[test]
    fn detector_opencodex_bun_excluded() {
        let detector = TerminalAgentDetector::new(rules());
        let candidates = vec![proc(
            5,
            1,
            "bun.exe",
            Some(
                r"%USERPROFILE%\AppData\Roaming\npm\node_modules\@bitkyc08\opencodex\node_modules\bun\bin\bun.exe",
            ),
            Some("opencode"),
        )];
        // opencodex 工具 → 排除，NoMatch
        assert_eq!(detector.detect(&candidates), DetectionResult::NoMatch);
    }

    #[test]
    fn detector_multiple_agents_unavailable() {
        let detector = TerminalAgentDetector::new(rules());
        let candidates = vec![
            proc(6, 1, "claude.exe", None, Some("claude")),
            proc(
                7,
                1,
                "node.exe",
                None,
                Some("node .../@openai/codex/codex.js"),
            ),
        ];
        assert!(matches!(
            detector.detect(&candidates),
            DetectionResult::Unavailable { reason } if reason == CODE_MULTIPLE_TERMINAL_AGENT_CANDIDATES
        ));
    }

    #[test]
    fn detector_same_agent_workers_dedup() {
        let detector = TerminalAgentDetector::new(rules());
        let candidates = vec![
            proc(8, 1, "claude.exe", None, Some("claude")),
            proc(
                9,
                8,
                "node.exe",
                None,
                Some("node .../@anthropic-ai/claude-code/..."),
            ),
        ];
        match detector.detect(&candidates) {
            DetectionResult::Matched { agent_id, .. } => assert_eq!(agent_id, "claude-code"),
            other => panic!("expected claude, got {other:?}"),
        }
    }

    #[test]
    fn context_single_shell_resolves() {
        let tree = FakeTree::default()
            .with(proc(100, 50, "WindowsTerminal.exe", None, None))
            .with(proc(101, 100, "cmd.exe", None, None))
            .with(proc(
                102,
                101,
                "node.exe",
                None,
                Some("node .../@openai/codex/codex.js"),
            ));
        let provider = WindowsTerminalContextProvider::new(Box::new(tree), classifier());
        let ctx = ForegroundContext {
            window_id: 1,
            process_id: 100,
            executable_name: Some("WindowsTerminal.exe".into()),
            executable_path: None,
            window_class: Some("CASCADIA_HOSTING_WINDOW_CLASS".into()),
            window_title: None,
        };
        match provider.observe(&ctx).unwrap() {
            TerminalObservation::Resolved { anchor, candidates } => {
                assert!(matches!(
                    anchor,
                    TerminalSessionAnchor::VerifiedTerminalSession { .. }
                ));
                assert!(candidates.iter().any(|p| p.executable_name == "node.exe"));
            }
            other => panic!("expected resolved, got {other:?}"),
        }
    }

    #[test]
    fn context_multi_shell_ambiguous() {
        let tree = FakeTree::default()
            .with(proc(100, 50, "WindowsTerminal.exe", None, None))
            .with(proc(101, 100, "cmd.exe", None, None))
            .with(proc(102, 100, "cmd.exe", None, None));
        let provider = WindowsTerminalContextProvider::new(Box::new(tree), classifier());
        let ctx = ForegroundContext {
            window_id: 1,
            process_id: 100,
            executable_name: Some("WindowsTerminal.exe".into()),
            executable_path: None,
            window_class: Some("CASCADIA_HOSTING_WINDOW_CLASS".into()),
            window_title: None,
        };
        assert!(matches!(
            provider.observe(&ctx).unwrap(),
            TerminalObservation::Ambiguous { .. }
        ));
    }

    #[test]
    fn context_console_host_resolves() {
        let tree = FakeTree::default()
            .with(proc(200, 1, "conhost.exe", None, None))
            .with(proc(201, 200, "cmd.exe", None, None))
            .with(proc(202, 201, "claude.exe", None, Some("claude")));
        let provider = WindowsTerminalContextProvider::new(Box::new(tree), classifier());
        let ctx = ForegroundContext {
            window_id: 1,
            process_id: 200,
            executable_name: Some("conhost.exe".into()),
            executable_path: None,
            window_class: Some("ConsoleWindowClass".into()),
            window_title: None,
        };
        match provider.observe(&ctx).unwrap() {
            TerminalObservation::Resolved { anchor, .. } => {
                assert!(matches!(
                    anchor,
                    TerminalSessionAnchor::DirectConsoleProcess { .. }
                ));
            }
            other => panic!("expected resolved, got {other:?}"),
        }
    }
}
