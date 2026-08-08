use serde::Serialize;

/// 应用统一错误；错误码在前后端契约中保持稳定。
#[derive(Debug, Clone, thiserror::Error)]
pub enum AppError {
    #[error("输入无效: {0}")]
    Validation(String),
    #[error("资源不存在: {0}")]
    NotFound(String),
    #[error("冲突: {0}")]
    Conflict(String),
    #[error("数据库错误: {0}")]
    Database(String),
    #[error("迁移错误: {0}")]
    Migration(String),
    #[error("窗口错误: {0}")]
    Window(String),
    #[error("快捷键无效: {0}")]
    HotkeyInvalid(String),
    #[error("快捷键按键不受支持: {0}")]
    HotkeyUnsupportedKey(String),
    #[error("快捷键注册失败: {0}")]
    HotkeyRegistrationFailed(String),
    #[error("快捷键保存失败: {0}")]
    HotkeyPersistFailed(String),
    #[error("快捷键切换失败: {0}")]
    HotkeySwapFailed(String),
    #[error("快捷键状态不一致: {0}")]
    HotkeyInconsistentState(String),
    #[error("快捷键未激活: {0}")]
    HotkeyNotActive(String),
    #[error("内部错误: {0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Validation(_) => "VALIDATION_ERROR",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Conflict(_) => "CONFLICT",
            AppError::Database(_) => "DATABASE_ERROR",
            AppError::Migration(_) => "MIGRATION_ERROR",
            AppError::Window(_) => "WINDOW_ERROR",
            AppError::HotkeyInvalid(_) => "HOTKEY_INVALID",
            AppError::HotkeyUnsupportedKey(_) => "HOTKEY_UNSUPPORTED_KEY",
            AppError::HotkeyRegistrationFailed(_) => "HOTKEY_REGISTRATION_FAILED",
            AppError::HotkeyPersistFailed(_) => "HOTKEY_PERSIST_FAILED",
            AppError::HotkeySwapFailed(_) => "HOTKEY_SWAP_FAILED",
            AppError::HotkeyInconsistentState(_) => "HOTKEY_INCONSISTENT_STATE",
            AppError::HotkeyNotActive(_) => "HOTKEY_NOT_ACTIVE",
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self,
            AppError::Database(_)
                | AppError::Conflict(_)
                | AppError::Window(_)
                | AppError::HotkeyRegistrationFailed(_)
                | AppError::HotkeyPersistFailed(_)
                | AppError::HotkeySwapFailed(_)
        )
    }
}

/// 返回给前端的结构化错误（camelCase）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorDto {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub retryable: bool,
}

impl From<AppError> for AppErrorDto {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.to_string(),
            field: None,
            retryable: error.retryable(),
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        AppError::Database(error.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
