use uuid::Uuid;

/// ID 生成端口。统一使用 UUID v4。
pub trait IdGenerator: Send + Sync {
    fn new_id(&self) -> Uuid;
}
