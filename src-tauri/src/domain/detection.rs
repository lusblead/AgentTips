use serde::Serialize;

/// 数据驱动的桌面 Agent 检测规则。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopAgentRule {
    pub agent_id: &'static str,
    /// 稳定 executable basename（大小写不敏感匹配）。
    pub executable_basenames: &'static [&'static str],
    /// 可选路径特征（已归一化小写、反斜杠分隔；子串匹配，如 "programs\\cursor"）。
    pub path_hints: &'static [&'static str],
    /// 可选窗口类特征（加强条件）。
    pub window_class_hints: &'static [&'static str],
    /// 可选标题特征（仅辅助，绝不作为唯一依据）。
    pub title_hints: &'static [&'static str],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MatchKind {
    ExactExecutable,
    ExecutableAndPath,
    ExecutableAndClass,
    VerifiedApplicationIdentity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectionResult {
    Matched {
        agent_id: String,
        match_kind: MatchKind,
    },
    NoMatch,
    SelfWindow,
    Unavailable {
        reason: String,
    },
}

/// Agent 切换事件（Phase 4A 只更新内存状态，不触发 Reminder）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Transition {
    Entered(String),
    Left(String),
    Changed { from: String, to: String },
    None,
}

/// 纯 transition reducer：前一个 effective state + 当前 DetectionResult。
pub fn reduce_transition(
    previous: Option<String>,
    result: &DetectionResult,
) -> (Option<String>, Transition) {
    match result {
        DetectionResult::Matched { agent_id, .. } => match previous {
            None => (
                Some(agent_id.clone()),
                Transition::Entered(agent_id.clone()),
            ),
            Some(prev) if &prev == agent_id => (Some(prev), Transition::None),
            Some(prev) => (
                Some(agent_id.clone()),
                Transition::Changed {
                    from: prev,
                    to: agent_id.clone(),
                },
            ),
        },
        // SelfWindow / Unavailable 不修改 effective state（避免 Quick Note 打断产生伪 transition）
        DetectionResult::SelfWindow | DetectionResult::Unavailable { .. } => {
            (previous, Transition::None)
        }
        DetectionResult::NoMatch => match previous {
            Some(prev) => (None, Transition::Left(prev)),
            None => (None, Transition::None),
        },
    }
}

/// executable basename 归一化：小写、无大小写敏感。
pub fn normalize_basename(name: &str) -> String {
    name.trim().to_lowercase()
}

/// 路径归一化：统一反斜杠分隔并小写（不依赖脆弱字符串大小写判断）。
pub fn normalize_path(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

/// 判断 executable basename 是否匹配规则。
pub fn executable_matches_rule(basename: &str, rule: &DesktopAgentRule) -> bool {
    let normalized = normalize_basename(basename);
    rule.executable_basenames
        .iter()
        .any(|candidate| normalize_basename(candidate) == normalized)
}

/// 判断窗口标题是否命中（仅辅助）。
pub fn title_matches_rule(title: Option<&str>, rule: &DesktopAgentRule) -> bool {
    let Some(title) = title else {
        return false;
    };
    let lower = title.to_lowercase();
    rule.title_hints
        .iter()
        .any(|hint| lower.contains(&hint.to_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CURSOR_RULE: DesktopAgentRule = DesktopAgentRule {
        agent_id: "cursor",
        executable_basenames: &["Cursor.exe"],
        path_hints: &["programs\\cursor"],
        window_class_hints: &[],
        title_hints: &[],
    };

    #[test]
    fn reduce_none_to_cursor_enters() {
        let result = DetectionResult::Matched {
            agent_id: "cursor".into(),
            match_kind: MatchKind::ExactExecutable,
        };
        let (state, transition) = reduce_transition(None, &result);
        assert_eq!(state.as_deref(), Some("cursor"));
        assert_eq!(transition, Transition::Entered("cursor".into()));
    }

    #[test]
    fn reduce_same_agent_no_transition() {
        let result = DetectionResult::Matched {
            agent_id: "cursor".into(),
            match_kind: MatchKind::ExactExecutable,
        };
        let (state, transition) = reduce_transition(Some("cursor".into()), &result);
        assert_eq!(state.as_deref(), Some("cursor"));
        assert_eq!(transition, Transition::None);
    }

    #[test]
    fn reduce_self_window_keeps_state() {
        let result = DetectionResult::SelfWindow;
        let (state, transition) = reduce_transition(Some("cursor".into()), &result);
        assert_eq!(state.as_deref(), Some("cursor"));
        assert_eq!(transition, Transition::None);
    }

    #[test]
    fn reduce_unavailable_keeps_state() {
        let result = DetectionResult::Unavailable {
            reason: "PROCESS_QUERY_FAILED".into(),
        };
        let (state, transition) = reduce_transition(Some("cursor".into()), &result);
        assert_eq!(state.as_deref(), Some("cursor"));
        assert_eq!(transition, Transition::None);
    }

    #[test]
    fn reduce_nomatch_leaves_agent() {
        let result = DetectionResult::NoMatch;
        let (state, transition) = reduce_transition(Some("cursor".into()), &result);
        assert_eq!(state, None);
        assert_eq!(transition, Transition::Left("cursor".into()));
    }

    #[test]
    fn reduce_nomatch_to_nomatch_no_transition() {
        let (state, transition) = reduce_transition(None, &DetectionResult::NoMatch);
        assert_eq!(state, None);
        assert_eq!(transition, Transition::None);
    }

    #[test]
    fn reduce_agent_change_emits_changed() {
        let result = DetectionResult::Matched {
            agent_id: "chatgpt-desktop".into(),
            match_kind: MatchKind::ExactExecutable,
        };
        let (state, transition) = reduce_transition(Some("cursor".into()), &result);
        assert_eq!(state.as_deref(), Some("chatgpt-desktop"));
        assert_eq!(
            transition,
            Transition::Changed {
                from: "cursor".into(),
                to: "chatgpt-desktop".into(),
            }
        );
    }

    #[test]
    fn reduce_chatgpt_to_trae_changed() {
        let result = DetectionResult::Matched {
            agent_id: "trae".into(),
            match_kind: MatchKind::ExactExecutable,
        };
        let (state, transition) = reduce_transition(Some("chatgpt-desktop".into()), &result);
        assert_eq!(state.as_deref(), Some("trae"));
        assert_eq!(
            transition,
            Transition::Changed {
                from: "chatgpt-desktop".into(),
                to: "trae".into(),
            }
        );
    }

    #[test]
    fn normalize_is_case_insensitive() {
        assert_eq!(normalize_basename("CURSOR.EXE"), "cursor.exe");
        assert_eq!(
            normalize_path(r"C:\Users\X\Programs\Cursor"),
            r"c:\users\x\programs\cursor"
        );
        assert!(executable_matches_rule("cursor.exe", &CURSOR_RULE));
        assert!(executable_matches_rule("CURSOR.EXE", &CURSOR_RULE));
    }

    #[test]
    fn title_hint_only_does_not_match() {
        // 仅标题命中、exe 不匹配 → 不是该 Agent（标题不能作为唯一依据）
        let result = DetectionResult::NoMatch;
        let (state, _) = reduce_transition(None, &result);
        assert_eq!(state, None);
        assert!(!executable_matches_rule("chrome.exe", &CURSOR_RULE));
    }
}
