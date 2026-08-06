use chrono::{DateTime, Utc};

/// 业务时间来源。所有时间统一 UTC。
pub trait Clock: Send + Sync {
    fn now_utc(&self) -> DateTime<Utc>;
}
