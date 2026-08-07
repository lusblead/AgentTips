use serde::Serialize;

/// 前台窗口身份（与 Windows HWND/HANDLE 无关的纯领域模型）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundContext {
    pub window_id: u64,
    pub process_id: u32,
    pub executable_name: Option<String>,
    pub executable_path: Option<String>,
    pub window_class: Option<String>,
    pub window_title: Option<String>,
}

/// 前台观测结果：必须区分“明确观测到”与“暂时无法读取”。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForegroundObservation {
    Observed(ForegroundContext),
    /// GetForegroundWindow 返回 NULL。
    NoForegroundWindow,
    /// 窗口/进程在读取过程中销毁，或权限不足、查询失败。
    ProcessQueryUnavailable(Option<ForegroundContext>),
    /// AgentTips 自身窗口（Main / Quick Note / Settings）。
    SelfWindow(ForegroundContext),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForegroundContextError {
    NoForegroundWindow,
    WindowDisappeared,
    ProcessAccessDenied,
    ProcessQueryFailed(String),
}

impl ForegroundObservation {
    pub fn context(&self) -> Option<&ForegroundContext> {
        match self {
            ForegroundObservation::Observed(ctx)
            | ForegroundObservation::ProcessQueryUnavailable(Some(ctx))
            | ForegroundObservation::SelfWindow(ctx) => Some(ctx),
            ForegroundObservation::NoForegroundWindow
            | ForegroundObservation::ProcessQueryUnavailable(None) => None,
        }
    }
}
