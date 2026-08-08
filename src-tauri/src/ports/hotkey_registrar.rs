use crate::domain::hotkey::HotkeyBinding;
use crate::error::{AppError, AppResult};

/// 系统全局快捷键注册能力。Application 层只依赖此接口，不感知
/// tauri-plugin-global-shortcut 具体类型。
pub trait HotkeyRegistrarPort: Send + Sync {
    fn register(&self, binding: &HotkeyBinding) -> AppResult<()>;
    fn unregister(&self, binding: &HotkeyBinding) -> AppResult<()>;
    /// 仅表达 AgentTips 自身是否已注册该快捷键；
    /// 外部程序占用只能通过 register() 的真实结果判断。
    fn is_registered_by_this_app(&self, binding: &HotkeyBinding) -> AppResult<bool>;
}

/// 注册失败统一映射为 HOTKEY_REGISTRATION_FAILED（内部保留 source 字符串）。
pub fn registration_error(message: impl Into<String>) -> AppError {
    AppError::HotkeyRegistrationFailed(message.into())
}
