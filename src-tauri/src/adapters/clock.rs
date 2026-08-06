use chrono::{DateTime, Utc};

use crate::ports::clock::Clock;

/// 系统时钟适配器。
#[derive(Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_utc(&self) -> DateTime<Utc> {
        Utc::now()
    }
}
