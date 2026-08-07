use serde::Serialize;
use tauri::State;

use crate::application::detection::ForegroundWatcher;
use crate::domain::detection::{DetectionResult, MatchKind, Transition};

/// 安全 DTO：不暴露完整 executable path / window title（隐私）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDetectionStatusDto {
    pub status: &'static str,
    pub agent_id: Option<String>,
    pub process_name: Option<String>,
    pub match_kind: Option<String>,
    pub effective_external_agent: Option<String>,
    pub observed_at: Option<String>,
}

#[tauri::command]
pub fn desktop_detection_get_current(
    watcher: State<'_, std::sync::Arc<ForegroundWatcher>>,
) -> DesktopDetectionStatusDto {
    let state = watcher.state();
    let (status, agent_id, match_kind) = match &state.current_detection {
        Some(DetectionResult::Matched {
            agent_id,
            match_kind,
        }) => (
            "Matched",
            Some(agent_id.clone()),
            Some(match_kind_name(match_kind).to_string()),
        ),
        Some(DetectionResult::NoMatch) => ("NoMatch", None, None),
        Some(DetectionResult::SelfWindow) => ("SelfWindow", None, None),
        Some(DetectionResult::Unavailable { .. }) => ("Unavailable", None, None),
        None => ("Unknown", None, None),
    };
    DesktopDetectionStatusDto {
        status,
        agent_id,
        // processName 为最近前台进程 basename（隐私安全）
        process_name: state.last_process_basename,
        match_kind,
        effective_external_agent: state.effective_external_agent,
        observed_at: state.last_observed_at.map(|t| t.to_rfc3339()),
    }
}

fn match_kind_name(kind: &MatchKind) -> &'static str {
    match kind {
        MatchKind::ExactExecutable => "ExactExecutable",
        MatchKind::ExecutableAndPath => "ExecutableAndPath",
        MatchKind::ExecutableAndClass => "ExecutableAndClass",
        MatchKind::VerifiedApplicationIdentity => "VerifiedApplicationIdentity",
    }
}

/// transition 的辅助序列化（保留字段以备后续 Phase 使用）。
#[allow(dead_code)]
fn transition_name(t: &Transition) -> &'static str {
    match t {
        Transition::Entered(_) => "Entered",
        Transition::Left(_) => "Left",
        Transition::Changed { .. } => "Changed",
        Transition::None => "None",
    }
}
