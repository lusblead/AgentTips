use std::sync::Arc;

use rand::seq::SliceRandom;
use uuid::Uuid;

use crate::domain::color::{NoteColorKey, ALL_NOTE_COLORS};
use crate::domain::tips::{
    normalized_title, CreateTipCommand, Tip, TipBinding, TipQuery, UpdateTipCommand,
    UpdateTipTextCommand,
};
use crate::error::{AppError, AppResult};
use crate::ports::clock::Clock;
use crate::ports::id::IdGenerator;
use crate::ports::tips::TipRepository;

/// Tip 用例（创建/查询/列表/修改/删除；事务边界由 repository 原子方法保证）。
pub struct TipService {
    repo: Arc<dyn TipRepository>,
    clock: Arc<dyn Clock>,
    ids: Arc<dyn IdGenerator>,
}

impl TipService {
    pub fn new(
        repo: Arc<dyn TipRepository>,
        clock: Arc<dyn Clock>,
        ids: Arc<dyn IdGenerator>,
    ) -> Self {
        Self { repo, clock, ids }
    }

    pub fn create(&self, command: CreateTipCommand) -> AppResult<Tip> {
        command.validate()?;
        let now = self.clock.now_utc();
        let id = self.ids.new_id();
        // 调用方未提供颜色时，按同一颜色分配规则兜底（排除最近 2 种颜色）。
        let color_key = match command.color_key {
            Some(key) => key,
            None => self.suggest_color()?,
        };
        let bindings: Vec<TipBinding> = command
            .bindings
            .iter()
            .enumerate()
            .map(|(index, binding)| TipBinding {
                agent_id: binding.agent_id,
                auto_attach: binding.auto_attach,
                sort_order: index as i64,
            })
            .collect();
        let tip = Tip {
            id,
            title: normalized_title(command.title.as_deref(), &command.content),
            content: command.content.trim().to_string(),
            status: command.status,
            created_at: now,
            updated_at: now,
            deleted_at: None,
            color_key,
            used_at: None,
            bindings: bindings.clone(),
        };
        self.repo.create_with_bindings(&tip, &bindings)
    }

    /// 颜色建议：排除最近创建的 2 张 Tip 的颜色后随机选择。
    pub fn suggest_color(&self) -> AppResult<NoteColorKey> {
        let recent = self.repo.recent_color_keys(2)?;
        let excluded: std::collections::HashSet<NoteColorKey> = recent.into_iter().collect();
        let pool: Vec<NoteColorKey> = ALL_NOTE_COLORS
            .iter()
            .copied()
            .filter(|key| !excluded.contains(key))
            .collect();
        let candidates = if pool.is_empty() {
            ALL_NOTE_COLORS.to_vec()
        } else {
            pool
        };
        let mut rng = rand::thread_rng();
        Ok(*candidates.choose(&mut rng).unwrap_or(&NoteColorKey::Lemon))
    }

    /// Text-only 更新：只允许修改 title/content/updated_at。
    pub fn update_text(&self, command: UpdateTipTextCommand) -> AppResult<Tip> {
        command.validate()?;
        let updated_at = self.clock.now_utc();
        self.repo.update_text(
            command.id,
            command.title.trim(),
            command.content.trim(),
            updated_at,
        )
    }

    pub fn mark_used(&self, id: Uuid) -> AppResult<Tip> {
        self.repo.mark_used(id, self.clock.now_utc())
    }

    pub fn restore_used(&self, id: Uuid) -> AppResult<Tip> {
        self.repo.restore_used(id)
    }

    pub fn update_color(&self, id: Uuid, color_key: NoteColorKey) -> AppResult<Tip> {
        self.repo.update_color(id, color_key)
    }

    pub fn get(&self, id: Uuid) -> AppResult<Option<Tip>> {
        self.repo.get(id)
    }

    pub fn list(&self, query: TipQuery) -> AppResult<Vec<Tip>> {
        self.repo.list(&query)
    }

    pub fn update(&self, command: UpdateTipCommand) -> AppResult<Tip> {
        command.validate()?;
        let mut tip = self
            .repo
            .get(command.id)?
            .ok_or_else(|| AppError::NotFound(format!("Tip {} 不存在", command.id)))?;

        if let Some(title) = command.title {
            tip.title = normalized_title(title.as_deref(), &tip.content);
        }
        if let Some(content) = &command.content {
            tip.content = content.trim().to_string();
        }
        if let Some(status) = command.status {
            tip.status = status;
        }
        let bindings: Vec<TipBinding> = match command.bindings {
            Some(inputs) => inputs
                .iter()
                .enumerate()
                .map(|(index, binding)| TipBinding {
                    agent_id: binding.agent_id,
                    auto_attach: binding.auto_attach,
                    sort_order: index as i64,
                })
                .collect(),
            None => tip.bindings.clone(),
        };
        tip.bindings = bindings.clone();
        tip.updated_at = self.clock.now_utc();
        self.repo.update_with_bindings(&tip, &bindings)
    }

    pub fn delete(&self, id: Uuid) -> AppResult<()> {
        self.repo.delete(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::agents::AgentKind;
    use crate::domain::color::NoteColorKey;
    use crate::domain::tips::{CreateBindingInput, TipStatus};
    use chrono::{TimeZone, Utc};
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeTipRepository {
        calls: Mutex<Vec<String>>,
        fail_with: Mutex<Option<AppError>>,
        stored: Mutex<Vec<Tip>>,
    }

    impl FakeTipRepository {
        fn stored(&self) -> Vec<Tip> {
            self.stored.lock().unwrap().clone()
        }
    }

    impl TipRepository for FakeTipRepository {
        fn create_with_bindings(&self, tip: &Tip, _bindings: &[TipBinding]) -> AppResult<Tip> {
            self.calls
                .lock()
                .unwrap()
                .push("create_with_bindings".into());
            if let Some(error) = self.fail_with.lock().unwrap().clone() {
                return Err(error);
            }
            self.stored.lock().unwrap().push(tip.clone());
            Ok(tip.clone())
        }

        fn update_with_bindings(&self, tip: &Tip, _bindings: &[TipBinding]) -> AppResult<Tip> {
            self.calls
                .lock()
                .unwrap()
                .push("update_with_bindings".into());
            if let Some(error) = self.fail_with.lock().unwrap().clone() {
                return Err(error);
            }
            let mut stored = self.stored.lock().unwrap();
            let Some(existing) = stored.iter_mut().find(|t| t.id == tip.id) else {
                return Err(AppError::NotFound(format!("Tip {} 不存在", tip.id)));
            };
            *existing = tip.clone();
            Ok(tip.clone())
        }

        fn get(&self, id: Uuid) -> AppResult<Option<Tip>> {
            self.calls.lock().unwrap().push("get".into());
            Ok(self.stored().into_iter().find(|t| t.id == id))
        }

        fn list(&self, _query: &TipQuery) -> AppResult<Vec<Tip>> {
            self.calls.lock().unwrap().push("list".into());
            Ok(self.stored())
        }

        fn delete(&self, id: Uuid) -> AppResult<()> {
            self.calls.lock().unwrap().push("delete".into());
            let mut stored = self.stored.lock().unwrap();
            let before = stored.len();
            stored.retain(|t| t.id != id);
            if stored.len() == before {
                return Err(AppError::NotFound(format!("Tip {} 不存在", id)));
            }
            Ok(())
        }

        fn recent_color_keys(&self, _limit: usize) -> AppResult<Vec<NoteColorKey>> {
            Ok(vec![])
        }

        fn update_text(
            &self,
            _id: Uuid,
            _title: &str,
            _content: &str,
            _updated_at: chrono::DateTime<chrono::Utc>,
        ) -> AppResult<Tip> {
            unreachable!()
        }

        fn mark_used(&self, _id: Uuid, _used_at: chrono::DateTime<chrono::Utc>) -> AppResult<Tip> {
            unreachable!()
        }

        fn restore_used(&self, _id: Uuid) -> AppResult<Tip> {
            unreachable!()
        }

        fn update_color(&self, _id: Uuid, _color_key: NoteColorKey) -> AppResult<Tip> {
            unreachable!()
        }
    }

    #[derive(Default)]
    struct FakeClock(chrono::DateTime<Utc>);

    impl FakeClock {
        fn at(ms: i64) -> Self {
            FakeClock(Utc.timestamp_millis_opt(ms).unwrap())
        }
    }

    impl Clock for FakeClock {
        fn now_utc(&self) -> chrono::DateTime<Utc> {
            self.0
        }
    }

    #[derive(Default)]
    struct FixedId(Uuid);

    impl IdGenerator for FixedId {
        fn new_id(&self) -> Uuid {
            self.0
        }
    }

    fn uuid(seed: u8) -> Uuid {
        Uuid::from_bytes([seed; 16])
    }

    fn agent_id(seed: u8) -> Uuid {
        Uuid::from_bytes([seed; 16])
    }

    fn service(repo: Arc<FakeTipRepository>) -> TipService {
        TipService::new(
            repo,
            Arc::new(FakeClock::at(1_700_000_000_000)),
            Arc::new(FixedId(uuid(1))),
        )
    }

    fn create_command(content: &str, agent: Uuid, auto_attach: bool) -> CreateTipCommand {
        CreateTipCommand {
            title: Some("标题".into()),
            content: content.into(),
            status: TipStatus::Active,
            color_key: Some(NoteColorKey::Mint),
            bindings: vec![CreateBindingInput {
                agent_id: agent,
                auto_attach,
            }],
        }
    }

    #[test]
    fn create_calls_atomic_repository_method_with_timestamp_and_id() {
        let repo = Arc::new(FakeTipRepository::default());
        let tips = service(repo.clone());
        let created = tips
            .create(create_command("  内容  ", agent_id(2), true))
            .unwrap();
        assert_eq!(created.id, uuid(1));
        assert_eq!(created.content, "内容");
        assert_eq!(
            created.created_at,
            Utc.timestamp_millis_opt(1_700_000_000_000).unwrap()
        );
        assert!(repo
            .calls
            .lock()
            .unwrap()
            .contains(&"create_with_bindings".to_string()));
    }

    #[test]
    fn repository_error_is_mapped_through() {
        let repo = Arc::new(FakeTipRepository::default());
        *repo.fail_with.lock().unwrap() = Some(AppError::Database("disk full".into()));
        let tips = service(repo.clone());
        let error = tips
            .create(create_command("内容", agent_id(2), true))
            .unwrap_err();
        assert!(matches!(error, AppError::Database(_)));
    }

    #[test]
    fn update_missing_tip_returns_not_found() {
        let repo = Arc::new(FakeTipRepository::default());
        let tips = service(repo.clone());
        let error = tips
            .update(UpdateTipCommand {
                id: uuid(9),
                title: None,
                content: Some("新内容".into()),
                status: None,
                bindings: None,
            })
            .unwrap_err();
        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn update_uses_atomic_binding_replacement() {
        let repo = Arc::new(FakeTipRepository::default());
        let tips = service(repo.clone());
        let created = tips
            .create(create_command("原始", agent_id(2), true))
            .unwrap();
        let updated = tips
            .update(UpdateTipCommand {
                id: created.id,
                title: Some(Some("新标题".into())),
                content: Some("  新内容  ".into()),
                status: None,
                bindings: Some(vec![
                    CreateBindingInput {
                        agent_id: agent_id(2),
                        auto_attach: false,
                    },
                    CreateBindingInput {
                        agent_id: agent_id(4),
                        auto_attach: true,
                    },
                ]),
            })
            .unwrap();
        assert_eq!(updated.content, "新内容");
        assert_eq!(updated.bindings.len(), 2);
        assert_eq!(updated.bindings[0].sort_order, 0);
        assert_eq!(updated.bindings[1].sort_order, 1);
        assert!(repo
            .calls
            .lock()
            .unwrap()
            .contains(&"update_with_bindings".to_string()));
    }

    #[test]
    fn get_returns_none_for_missing() {
        let repo = Arc::new(FakeTipRepository::default());
        let tips = service(repo.clone());
        assert!(tips.get(uuid(99)).unwrap().is_none());
    }

    #[test]
    fn delete_missing_returns_not_found() {
        let repo = Arc::new(FakeTipRepository::default());
        let tips = service(repo.clone());
        assert!(matches!(tips.delete(uuid(99)), Err(AppError::NotFound(_))));
    }

    // 让 AgentKind 引用保持（domain 类型在测试中用到）
    #[allow(dead_code)]
    fn _agent_kind(kind: AgentKind) -> &'static str {
        kind.as_str()
    }
}
