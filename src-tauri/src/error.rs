use serde::Serialize;

/// 应用统一错误类型。Phase 2+ 按 docs/06-ipc-event-contracts.md 扩展业务错误码。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("内部错误: {0}")]
    Internal(String),
}

/// 返回给前端的结构化错误（camelCase，与 docs/06-ipc-event-contracts.md 一致）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorDto {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
}

impl From<AppError> for AppErrorDto {
    fn from(error: AppError) -> Self {
        Self {
            code: "INTERNAL_ERROR".to_string(),
            message: error.to_string(),
            field: None,
            retryable: false,
            trace_id: None,
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_dto_uses_camel_case_contract() {
        let dto = AppErrorDto::from(AppError::Internal("boom".into()));
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["code"], "INTERNAL_ERROR");
        assert_eq!(json["message"], "内部错误: boom");
        assert_eq!(json["retryable"], false);
        // 可空字段在 None 时省略，避免前端收到未定义字段
        assert!(json.get("field").is_none());
        assert!(json.get("traceId").is_none());
    }
}
