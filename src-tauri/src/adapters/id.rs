use uuid::Uuid;

use crate::ports::id::IdGenerator;

/// UUID v4 生成适配器。
#[derive(Default)]
pub struct UuidGenerator;

impl IdGenerator for UuidGenerator {
    fn new_id(&self) -> Uuid {
        Uuid::new_v4()
    }
}
