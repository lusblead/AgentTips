use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::application::terminal::TerminalAgentDetector;
use crate::domain::detection::{
    executable_matches_rule, normalize_path, reduce_transition, DesktopAgentRule, DetectionResult,
    MatchKind, Transition,
};
use crate::domain::foreground::{ForegroundContext, ForegroundObservation};
use crate::domain::terminal::{TerminalHostKind, TerminalObservation};
use crate::error::{AppError, AppResult};
use crate::ports::clock::Clock;
use crate::ports::foreground::ForegroundContextProviderPort;
use crate::ports::terminal::TerminalContextProviderPort;

/// 前台轮询间隔（低成本：仅 HWND 检查）。
pub const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// 相同 HWND 的周期性重采集间隔（避免长期不重采样）。
pub const RESYNC_INTERVAL: Duration = Duration::from_secs(8);

/// 数据驱动桌面 Agent 检测器。规则只增数据，不增判断分支。
pub struct DesktopAgentDetector {
    rules: Vec<DesktopAgentRule>,
    self_basename: String,
}

impl DesktopAgentDetector {
    pub fn new(rules: Vec<DesktopAgentRule>, self_basename: impl Into<String>) -> Self {
        Self {
            rules,
            self_basename: self_basename.into(),
        }
    }

    /// 检测：SelfWindow 优先；executable + path/class 决定匹配；标题不参与匹配。
    pub fn detect(&self, observation: &ForegroundObservation) -> DetectionResult {
        let Some(context) = observation.context() else {
            return DetectionResult::Unavailable {
                reason: "NO_FOREGROUND_CONTEXT".into(),
            };
        };
        if let Some(exe) = &context.executable_name {
            if normalize_exe(exe) == normalize_exe(&self.self_basename) {
                return DetectionResult::SelfWindow;
            }
        }
        match observation {
            ForegroundObservation::Observed(_) => self.match_rules(context),
            ForegroundObservation::ProcessQueryUnavailable(_) => DetectionResult::Unavailable {
                reason: "PROCESS_QUERY_FAILED".into(),
            },
            ForegroundObservation::NoForegroundWindow => DetectionResult::Unavailable {
                reason: "NO_FOREGROUND_WINDOW".into(),
            },
            ForegroundObservation::SelfWindow(_) => DetectionResult::SelfWindow,
        }
    }

    fn match_rules(&self, context: &ForegroundContext) -> DetectionResult {
        let Some(exe) = &context.executable_name else {
            return DetectionResult::Unavailable {
                reason: "NO_EXECUTABLE_NAME".into(),
            };
        };
        for rule in &self.rules {
            if !executable_matches_rule(exe, rule) {
                continue;
            }
            if let Some(path) = &context.executable_path {
                let normalized = normalize_path(path);
                if rule
                    .path_hints
                    .iter()
                    .any(|hint| normalized.contains(&normalize_path(hint)))
                {
                    return DetectionResult::Matched {
                        agent_id: rule.agent_id.to_string(),
                        match_kind: MatchKind::ExecutableAndPath,
                    };
                }
            }
            if let Some(class) = &context.window_class {
                let lower = class.to_lowercase();
                if rule
                    .window_class_hints
                    .iter()
                    .any(|hint| lower.contains(&hint.to_lowercase()))
                {
                    return DetectionResult::Matched {
                        agent_id: rule.agent_id.to_string(),
                        match_kind: MatchKind::ExecutableAndClass,
                    };
                }
            }
            return DetectionResult::Matched {
                agent_id: rule.agent_id.to_string(),
                match_kind: MatchKind::ExactExecutable,
            };
        }
        DetectionResult::NoMatch
    }
}

fn normalize_exe(exe: &str) -> String {
    exe.trim().to_lowercase()
}

/// 内存态（Phase 4A 不写 SQLite history）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDetectionRuntimeState {
    pub current_detection: Option<DetectionResult>,
    pub effective_external_agent: Option<String>,
    pub last_transition: Option<Transition>,
    pub last_observed_at: Option<DateTime<Utc>>,
    /// 最近观测的前台进程 basename（隐私安全：不含完整路径/标题）。
    pub last_process_basename: Option<String>,
    /// 检测来源：Desktop 或 Terminal。
    pub source: Option<String>,
    /// Terminal 状态（terminal_resolved / terminal_no_agent / TERMINAL_SESSION_AMBIGUOUS 等）。
    pub terminal_status: Option<String>,
}

/// 前台 watcher：低成本 polling，HWND 不变则跳过，变化才全量采集。
pub struct ForegroundWatcher {
    provider: Arc<dyn ForegroundContextProviderPort>,
    detector: Arc<DesktopAgentDetector>,
    terminal_context: Arc<dyn TerminalContextProviderPort>,
    terminal_detector: Arc<TerminalAgentDetector>,
    clock: Arc<dyn Clock>,
    state: Arc<Mutex<DesktopDetectionRuntimeState>>,
    last_hwnd: Arc<Mutex<u64>>,
    last_hwnd_seen_at: Arc<Mutex<Option<DateTime<Utc>>>>,
    last_terminal_status: Arc<Mutex<Option<String>>>,
    running: Arc<AtomicBool>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl ForegroundWatcher {
    pub fn new(
        provider: Arc<dyn ForegroundContextProviderPort>,
        detector: Arc<DesktopAgentDetector>,
        terminal_context: Arc<dyn TerminalContextProviderPort>,
        terminal_detector: Arc<TerminalAgentDetector>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            provider,
            detector,
            terminal_context,
            terminal_detector,
            clock,
            state: Arc::new(Mutex::new(DesktopDetectionRuntimeState {
                current_detection: None,
                effective_external_agent: None,
                last_transition: None,
                last_observed_at: None,
                last_process_basename: None,
                source: None,
                terminal_status: None,
            })),
            last_hwnd: Arc::new(Mutex::new(0)),
            last_hwnd_seen_at: Arc::new(Mutex::new(None)),
            last_terminal_status: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
        }
    }

    pub fn state(&self) -> DesktopDetectionRuntimeState {
        self.state.lock().unwrap().clone()
    }

    /// 单次 tick（测试直接调用）：HWND 未变化且未到 resync 则跳过。
    pub fn tick(&self) -> AppResult<()> {
        self.tick_inner()
    }

    pub fn start(&self) -> AppResult<()> {
        if self.running.swap(true, Ordering::Relaxed) {
            return Ok(());
        }
        let handle = self.spawn_worker()?;
        *self.handle.lock().unwrap() = Some(handle);
        Ok(())
    }

    pub fn stop(&self) -> AppResult<()> {
        self.running.store(false, Ordering::Relaxed);
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
        Ok(())
    }

    fn tick_inner(&self) -> AppResult<()> {
        let observation = self.provider.current_foreground_observation()?;
        let hwnd = observation.context().map(|c| c.window_id).unwrap_or(0);
        let now = self.clock.now_utc();

        {
            let mut last = self.last_hwnd.lock().unwrap();
            let mut seen = self.last_hwnd_seen_at.lock().unwrap();
            let is_terminal = matches!(
                self.terminal_host_kind(observation.context()),
                TerminalHostKind::WindowsTerminal | TerminalHostKind::ConsoleHost
            );
            // Terminal 前台时约 1s 刷新（进程树内容可能变化）；否则 HWND 变化才刷新
            let refresh_needed = if is_terminal {
                let since = seen
                    .map(|s| now.signed_duration_since(s))
                    .unwrap_or(chrono::Duration::seconds(5));
                since >= chrono::Duration::milliseconds(1000)
            } else {
                *last != hwnd
            };
            if refresh_needed {
                *last = hwnd;
                *seen = Some(now);
            } else {
                return Ok(());
            }
        }

        let result = self.detector.detect(&observation);
        let final_result = self.resolve_terminal_if_needed(&result, observation.context())?;
        let mut state = self.state.lock().unwrap();
        state.last_process_basename = observation
            .context()
            .and_then(|c| c.executable_name.clone());
        let (new_effective, transition) =
            reduce_transition(state.effective_external_agent.clone(), &final_result);
        state.current_detection = Some(final_result.clone());
        state.effective_external_agent = new_effective.clone();
        if transition != Transition::None {
            state.last_transition = Some(transition.clone());
        }
        state.last_observed_at = Some(now);
        state.source = Some(match final_result {
            DetectionResult::Matched { .. } => "Terminal".into(),
            _ => "Desktop".into(),
        });
        state.terminal_status = self.last_terminal_status.lock().unwrap().clone();

        if transition != Transition::None {
            let basename = observation
                .context()
                .and_then(|c| c.executable_name.as_deref())
                .unwrap_or("<none>");
            let kind = match &final_result {
                DetectionResult::Matched { match_kind, .. } => format!("{:?}", match_kind),
                _ => String::new(),
            };
            eprintln!(
                "[agenttips] agent_detection_changed transition={:?} process_basename={} match_kind={}",
                transition, basename, kind,
            );
        }
        Ok(())
    }

    fn terminal_host_kind(&self, context: Option<&ForegroundContext>) -> TerminalHostKind {
        context
            .map(|ctx| self.terminal_context.classify(ctx))
            .unwrap_or(TerminalHostKind::NotTerminal)
    }

    fn resolve_terminal_if_needed(
        &self,
        desktop_result: &DetectionResult,
        context: Option<&ForegroundContext>,
    ) -> AppResult<DetectionResult> {
        *self.last_terminal_status.lock().unwrap() = None;
        match desktop_result {
            DetectionResult::NoMatch => {
                let Some(ctx) = context else {
                    return Ok(DetectionResult::NoMatch);
                };
                match self.terminal_context.observe(ctx)? {
                    TerminalObservation::Resolved { candidates, .. } => {
                        let detected = self.terminal_detector.detect(&candidates);
                        if detected == DetectionResult::NoMatch {
                            *self.last_terminal_status.lock().unwrap() =
                                Some("terminal_no_agent".to_string());
                            return Ok(DetectionResult::NoMatch);
                        }
                        *self.last_terminal_status.lock().unwrap() =
                            Some("terminal_resolved".to_string());
                        Ok(detected)
                    }
                    TerminalObservation::NoTerminalAgent => Ok(DetectionResult::NoMatch),
                    TerminalObservation::Ambiguous { reason } => {
                        *self.last_terminal_status.lock().unwrap() = Some(reason.clone());
                        Ok(DetectionResult::Unavailable { reason })
                    }
                    TerminalObservation::Unavailable { reason } => {
                        *self.last_terminal_status.lock().unwrap() = Some(reason.clone());
                        Ok(DetectionResult::Unavailable { reason })
                    }
                }
            }
            _ => Ok(desktop_result.clone()),
        }
    }

    fn spawn_worker(&self) -> AppResult<JoinHandle<()>> {
        let provider = self.provider.clone();
        let detector = self.detector.clone();
        let terminal_context = self.terminal_context.clone();
        let terminal_detector = self.terminal_detector.clone();
        let clock = self.clock.clone();
        let state = self.state.clone();
        let last_hwnd = self.last_hwnd.clone();
        let last_seen = self.last_hwnd_seen_at.clone();
        let last_terminal_status = self.last_terminal_status.clone();
        let running = self.running.clone();

        std::thread::Builder::new()
            .name("agenttips-foreground-watcher".into())
            .spawn(move || {
                while running.load(Ordering::Relaxed) {
                    let observation = match provider.current_foreground_observation() {
                        Ok(obs) => obs,
                        Err(err) => {
                            eprintln!("[agenttips] foreground watcher error: {err}");
                            std::thread::sleep(POLL_INTERVAL);
                            continue;
                        }
                    };
                    let hwnd = observation.context().map(|c| c.window_id).unwrap_or(0);
                    let now = clock.now_utc();
                    {
                        let mut last = last_hwnd.lock().unwrap();
                        let mut seen = last_seen.lock().unwrap();
                        let is_terminal = observation
                            .context()
                            .map(|ctx| {
                                matches!(
                                    terminal_context.classify(ctx),
                                    TerminalHostKind::WindowsTerminal
                                        | TerminalHostKind::ConsoleHost
                                )
                            })
                            .unwrap_or(false);
                        let refresh_needed = if is_terminal {
                            let since = seen
                                .map(|s| now.signed_duration_since(s))
                                .unwrap_or(chrono::Duration::seconds(5));
                            since >= chrono::Duration::milliseconds(1000)
                        } else {
                            *last != hwnd
                        };
                        if refresh_needed {
                            *last = hwnd;
                            *seen = Some(now);
                        } else {
                            std::thread::sleep(POLL_INTERVAL);
                            continue;
                        }
                    }

                    let result = detector.detect(&observation);
                    let mut final_result = result;
                    let mut terminal_status = None;
                    if matches!(final_result, DetectionResult::NoMatch) {
                        if let Some(ctx) = observation.context() {
                            match terminal_context.observe(ctx) {
                                Ok(TerminalObservation::Resolved { candidates, .. }) => {
                                    let detected = terminal_detector.detect(&candidates);
                                    if detected == DetectionResult::NoMatch {
                                        terminal_status = Some("terminal_no_agent".to_string());
                                    } else {
                                        terminal_status =
                                            Some("terminal_resolved".to_string());
                                        final_result = detected;
                                    }
                                }
                                Ok(TerminalObservation::NoTerminalAgent) => {}
                                Ok(TerminalObservation::Ambiguous { reason }) => {
                                    terminal_status = Some(reason.clone());
                                    final_result = DetectionResult::Unavailable { reason };
                                }
                                Ok(TerminalObservation::Unavailable { reason }) => {
                                    terminal_status = Some(reason.clone());
                                    final_result = DetectionResult::Unavailable { reason };
                                }
                                Err(_) => {}
                            }
                        }
                    }
                    *last_terminal_status.lock().unwrap() = terminal_status.clone();

                    let mut state = state.lock().unwrap();
                    state.last_process_basename = observation
                        .context()
                        .and_then(|c| c.executable_name.clone());
                    let (new_effective, transition) =
                        reduce_transition(state.effective_external_agent.clone(), &final_result);
                    state.current_detection = Some(final_result.clone());
                    state.effective_external_agent = new_effective.clone();
                    state.source = Some(
                        match final_result {
                            DetectionResult::Matched { .. } => "Terminal".into(),
                            _ => "Desktop".into(),
                        },
                    );
                    state.terminal_status = terminal_status.clone();
                    if transition != Transition::None {
                        state.last_transition = Some(transition.clone());
                    }
                    state.last_observed_at = Some(now);
                    if transition != Transition::None {
                        let basename = observation
                            .context()
                            .and_then(|c| c.executable_name.as_deref())
                            .unwrap_or("<none>");
                        let kind = match &final_result {
                            DetectionResult::Matched { match_kind, .. } => {
                                format!("{:?}", match_kind)
                            }
                            _ => String::new(),
                        };
                        eprintln!(
                            "[agenttips] agent_detection_changed transition={:?} process_basename={} match_kind={}",
                            transition, basename, kind,
                        );
                    }
                    std::thread::sleep(POLL_INTERVAL);
                }
            })
            .map_err(|e| AppError::Internal(format!("watcher spawn failed: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::terminal::TerminalAgentDetector;
    use crate::domain::detection::MatchKind;
    use crate::domain::foreground::ForegroundContext;
    use crate::domain::terminal::{TerminalHostKind, TerminalObservation};
    use crate::ports::terminal::TerminalContextProviderPort;
    use std::sync::Mutex as StdMutex;

    struct FakeTerminalContext {
        host: TerminalHostKind,
        observation: TerminalObservation,
    }

    impl TerminalContextProviderPort for FakeTerminalContext {
        fn classify(&self, _context: &ForegroundContext) -> TerminalHostKind {
            self.host
        }
        fn observe(&self, _context: &ForegroundContext) -> AppResult<TerminalObservation> {
            Ok(self.observation.clone())
        }
    }

    fn noop_terminal_detector() -> TerminalAgentDetector {
        TerminalAgentDetector::new(vec![])
    }

    fn cursor_rule() -> DesktopAgentRule {
        DesktopAgentRule {
            agent_id: "cursor",
            executable_basenames: &["Cursor.exe"],
            path_hints: &["programs\\cursor"],
            window_class_hints: &[],
            title_hints: &[],
        }
    }

    fn ctx(
        exe: &str,
        path: Option<&str>,
        class: Option<&str>,
        title: Option<&str>,
    ) -> ForegroundContext {
        ctx_with_id(1, exe, path, class, title)
    }

    fn ctx_with_id(
        id: u64,
        exe: &str,
        path: Option<&str>,
        class: Option<&str>,
        title: Option<&str>,
    ) -> ForegroundContext {
        ForegroundContext {
            window_id: id,
            process_id: 42,
            executable_name: Some(exe.to_string()),
            executable_path: path.map(|p| p.to_string()),
            window_class: class.map(|c| c.to_string()),
            window_title: title.map(|t| t.to_string()),
        }
    }

    fn detector() -> DesktopAgentDetector {
        DesktopAgentDetector::new(vec![cursor_rule()], "agent-tips.exe")
    }

    #[test]
    fn exact_cursor_executable_matches() {
        let obs = ForegroundObservation::Observed(ctx(
            "Cursor.exe",
            Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
            Some("Chrome_WidgetWin_1"),
            Some("Cursor Agents"),
        ));
        match detector().detect(&obs) {
            DetectionResult::Matched {
                agent_id,
                match_kind,
            } => {
                assert_eq!(agent_id, "cursor");
                assert_eq!(match_kind, MatchKind::ExecutableAndPath);
            }
            other => panic!("expected matched, got {other:?}"),
        }
    }

    #[test]
    fn executable_case_insensitive_matches() {
        let obs = ForegroundObservation::Observed(ctx(
            "CURSOR.EXE",
            Some(r"c:\users\x\appdata\local\programs\cursor\cursor.exe"),
            None,
            None,
        ));
        assert!(matches!(
            detector().detect(&obs),
            DetectionResult::Matched { agent_id, .. } if agent_id == "cursor"
        ));
    }

    #[test]
    fn chatgpt_title_in_chrome_is_nomatch() {
        let obs = ForegroundObservation::Observed(ctx(
            "chrome.exe",
            Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            Some("Chrome_WidgetWin_1"),
            Some("ChatGPT - Google Search"),
        ));
        assert_eq!(detector().detect(&obs), DetectionResult::NoMatch);
    }

    #[test]
    fn vscode_cursor_title_is_nomatch() {
        let obs = ForegroundObservation::Observed(ctx(
            "Code.exe",
            Some(r"C:\Users\X\AppData\Local\Programs\Microsoft VS Code\Code.exe"),
            Some("Chrome_WidgetWin_1"),
            Some("cursor-agent-study - Visual Studio Code"),
        ));
        assert_eq!(detector().detect(&obs), DetectionResult::NoMatch);
    }

    #[test]
    fn notepad_trae_title_is_nomatch() {
        let obs = ForegroundObservation::Observed(ctx(
            "Notepad.exe",
            Some(r"C:\Windows\System32\Notepad.exe"),
            Some("Notepad"),
            Some("Trae - Notepad"),
        ));
        assert_eq!(detector().detect(&obs), DetectionResult::NoMatch);
    }

    #[test]
    fn empty_title_still_matches_exact_executable() {
        let obs = ForegroundObservation::Observed(ctx(
            "Cursor.exe",
            Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
            None,
            None,
        ));
        assert!(matches!(
            detector().detect(&obs),
            DetectionResult::Matched { agent_id, .. } if agent_id == "cursor"
        ));
    }

    #[test]
    fn self_window_detected() {
        let obs = ForegroundObservation::Observed(ctx(
            "agent-tips.exe",
            Some(r"C:\Workspace\agent-tips.exe"),
            Some("Tauri Window"),
            Some("新建提示"),
        ));
        assert_eq!(detector().detect(&obs), DetectionResult::SelfWindow);
    }

    #[test]
    fn missing_process_identity_is_unavailable() {
        let obs = ForegroundObservation::ProcessQueryUnavailable(Some(ctx("", None, None, None)));
        assert!(matches!(
            detector().detect(&obs),
            DetectionResult::Unavailable { .. }
        ));
    }

    #[test]
    fn exact_exe_without_path_still_matches() {
        let obs = ForegroundObservation::Observed(ctx("Cursor.exe", None, None, None));
        assert!(matches!(
            detector().detect(&obs),
            DetectionResult::Matched { agent_id, .. } if agent_id == "cursor"
        ));
    }

    #[derive(Default)]
    struct FakeClock {
        now: StdMutex<DateTime<Utc>>,
    }

    impl Clock for FakeClock {
        fn now_utc(&self) -> DateTime<Utc> {
            *self.now.lock().unwrap()
        }
    }

    struct FakeProvider {
        sequence: StdMutex<Vec<ForegroundObservation>>,
    }

    impl FakeProvider {
        fn new(sequence: Vec<ForegroundObservation>) -> Self {
            Self {
                sequence: StdMutex::new(sequence),
            }
        }
    }

    impl ForegroundContextProviderPort for FakeProvider {
        fn current_foreground_observation(&self) -> AppResult<ForegroundObservation> {
            let mut seq = self.sequence.lock().unwrap();
            if seq.is_empty() {
                return Ok(ForegroundObservation::NoForegroundWindow);
            }
            Ok(seq.remove(0))
        }
    }

    fn watcher_with(provider: Arc<FakeProvider>, clock: Arc<FakeClock>) -> ForegroundWatcher {
        let detector = Arc::new(DesktopAgentDetector::new(
            vec![cursor_rule()],
            "agent-tips.exe",
        ));
        let terminal_context = Arc::new(FakeTerminalContext {
            host: TerminalHostKind::NotTerminal,
            observation: TerminalObservation::NoTerminalAgent,
        });
        ForegroundWatcher::new(
            provider,
            detector,
            terminal_context,
            Arc::new(noop_terminal_detector()),
            clock,
        )
    }

    #[test]
    fn watcher_same_agent_no_duplicate_entry() {
        let clock = Arc::new(FakeClock::default());
        *clock.now.lock().unwrap() = Utc::now();
        let cursor = ForegroundObservation::Observed(ctx(
            "Cursor.exe",
            Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
            None,
            None,
        ));
        let provider = Arc::new(FakeProvider::new(vec![cursor.clone(), cursor]));
        let watcher = watcher_with(provider.clone(), clock.clone());
        watcher.tick().unwrap();
        watcher.tick().unwrap();
        assert_eq!(
            watcher.state().effective_external_agent.as_deref(),
            Some("cursor")
        );
        // 同 agent 重复观测不产生 Entered（只有第一次进入）
        assert_eq!(
            watcher.state().last_transition,
            Some(Transition::Entered("cursor".into()))
        );
    }

    #[test]
    fn watcher_self_window_interruption_keeps_state() {
        let clock = Arc::new(FakeClock::default());
        *clock.now.lock().unwrap() = Utc::now();
        let sequence = vec![
            ForegroundObservation::Observed(ctx(
                "Cursor.exe",
                Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
                None,
                None,
            )),
            ForegroundObservation::SelfWindow(ctx(
                "agent-tips.exe",
                Some(r"C:\Workspace\agent-tips.exe"),
                Some("Tauri Window"),
                Some("新建提示"),
            )),
            ForegroundObservation::Observed(ctx(
                "Cursor.exe",
                Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
                None,
                None,
            )),
        ];
        let provider = Arc::new(FakeProvider::new(sequence));
        let watcher = watcher_with(provider.clone(), clock.clone());
        watcher.tick().unwrap();
        watcher.tick().unwrap();
        watcher.tick().unwrap();
        // SelfWindow 中断后回到 Cursor 不产生新 Entered
        assert_eq!(
            watcher.state().effective_external_agent.as_deref(),
            Some("cursor")
        );
        assert_eq!(
            watcher.state().last_transition,
            Some(Transition::Entered("cursor".into()))
        );
    }

    #[test]
    fn watcher_unavailable_interruption_keeps_state() {
        let clock = Arc::new(FakeClock::default());
        *clock.now.lock().unwrap() = Utc::now();
        let sequence = vec![
            ForegroundObservation::Observed(ctx(
                "Cursor.exe",
                Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
                None,
                None,
            )),
            ForegroundObservation::NoForegroundWindow,
            ForegroundObservation::Observed(ctx(
                "Cursor.exe",
                Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
                None,
                None,
            )),
        ];
        let provider = Arc::new(FakeProvider::new(sequence));
        let watcher = watcher_with(provider.clone(), clock.clone());
        watcher.tick().unwrap();
        watcher.tick().unwrap();
        watcher.tick().unwrap();
        assert_eq!(
            watcher.state().effective_external_agent.as_deref(),
            Some("cursor")
        );
    }

    #[test]
    fn watcher_nomatch_clears_and_reenters() {
        let clock = Arc::new(FakeClock::default());
        *clock.now.lock().unwrap() = Utc::now();
        let sequence = vec![
            ForegroundObservation::Observed(ctx(
                "Cursor.exe",
                Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
                None,
                None,
            )),
            ForegroundObservation::Observed(ctx_with_id(
                2,
                "chrome.exe",
                Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
                Some("Chrome_WidgetWin_1"),
                None,
            )),
            ForegroundObservation::Observed(ctx_with_id(
                3,
                "Cursor.exe",
                Some(r"C:\Users\X\AppData\Local\Programs\cursor\Cursor.exe"),
                None,
                None,
            )),
        ];
        let provider = Arc::new(FakeProvider::new(sequence));
        let watcher = watcher_with(provider.clone(), clock.clone());
        watcher.tick().unwrap();
        watcher.tick().unwrap();
        assert_eq!(watcher.state().effective_external_agent, None);
        assert_eq!(
            watcher.state().last_transition,
            Some(Transition::Left("cursor".into()))
        );
        watcher.tick().unwrap();
        assert_eq!(
            watcher.state().effective_external_agent.as_deref(),
            Some("cursor")
        );
        assert_eq!(
            watcher.state().last_transition,
            Some(Transition::Entered("cursor".into()))
        );
    }

    #[test]
    fn watcher_start_stop_clean() {
        let clock = Arc::new(FakeClock::default());
        *clock.now.lock().unwrap() = Utc::now();
        let provider = Arc::new(FakeProvider::new(vec![]));
        let watcher = watcher_with(provider.clone(), clock.clone());
        watcher.start().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        watcher.stop().unwrap();
        assert!(!watcher.running.load(Ordering::Relaxed));
    }

    #[test]
    fn watcher_start_twice_is_noop() {
        let clock = Arc::new(FakeClock::default());
        *clock.now.lock().unwrap() = Utc::now();
        let provider = Arc::new(FakeProvider::new(vec![]));
        let watcher = watcher_with(provider.clone(), clock.clone());
        watcher.start().unwrap();
        watcher.start().unwrap();
        watcher.stop().unwrap();
        assert!(!watcher.running.load(Ordering::Relaxed));
    }
}
