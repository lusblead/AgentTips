use crate::error::AppResult;

/// 窗口标签（与 tauri.conf.json 中定义的窗口一致）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WindowLabel {
    Main,
    QuickNote,
    Settings,
    Reminder,
}

impl WindowLabel {
    pub fn as_str(&self) -> &'static str {
        match self {
            WindowLabel::Main => "main",
            WindowLabel::QuickNote => "quick-note",
            WindowLabel::Settings => "settings",
            WindowLabel::Reminder => "reminder",
        }
    }

    pub fn from_label(value: &str) -> crate::error::AppResult<Self> {
        match value {
            "main" => Ok(WindowLabel::Main),
            "quick-note" => Ok(WindowLabel::QuickNote),
            "settings" => Ok(WindowLabel::Settings),
            "reminder" => Ok(WindowLabel::Reminder),
            other => Err(crate::error::AppError::Validation(format!(
                "未知窗口: {other}"
            ))),
        }
    }
}

/// 窗口生命周期端口。feature/use case 只依赖此接口，不感知 Tauri WebviewWindow。
pub trait WindowManagerPort: Send + Sync {
    /// 显示（已存在则复用 + 聚焦；不存在才创建）。
    fn show(&self, label: WindowLabel) -> AppResult<()>;
    /// 隐藏指定窗口。
    fn hide(&self, label: WindowLabel) -> AppResult<()>;
    /// 聚焦并置前。
    fn focus(&self, label: WindowLabel) -> AppResult<()>;
    /// 显示但不激活（不抢当前外部应用键盘焦点）。Reminder 使用。
    fn show_without_activation(&self, label: WindowLabel) -> AppResult<()>;
    /// 窗口当前是否可见。
    fn is_visible(&self, label: WindowLabel) -> AppResult<bool>;
    /// 主窗口尺寸（真实 Quick Note 尺寸验收用）。
    fn inner_size(&self, label: WindowLabel) -> AppResult<(u32, u32)>;
    /// 退出整个应用（Tray 退出 / quit command）。
    fn quit(&self) -> AppResult<()>;
}
