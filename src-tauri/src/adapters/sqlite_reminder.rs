use std::sync::Arc;

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::domain::color::NoteColorKey;
use crate::domain::reminder::{validate_cooldown_minutes, ReminderSettings, ReminderTip};
use crate::error::{AppError, AppResult};
use crate::ports::reminder::{AgentIdentity, ReminderEligibilityPort, ReminderStateRepositoryPort};

use super::sqlite::SqliteDatabase;

/// reminder_settings + agent_reminder_state 的 SQLite 实现（复用同一连接）。
pub struct SqliteReminderStateRepository {
    db: Arc<SqliteDatabase>,
}

/// detection 侧 agent key → DB agents.key 归一化。
/// Phase 4B 检测规则使用 "codex"，而 DB built-in key 为 "codex-cli"。
fn normalize_agent_key(key: &str) -> &str {
    match key {
        "codex" => "codex-cli",
        other => other,
    }
}

impl SqliteReminderStateRepository {
    pub fn new(db: Arc<SqliteDatabase>) -> Self {
        Self { db }
    }

    fn agent_db_id(&self, conn: &rusqlite::Connection, agent_key: &str) -> AppResult<String> {
        let agent_key = normalize_agent_key(agent_key);
        conn.query_row(
            "SELECT id FROM agents WHERE key = ?1",
            params![agent_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(|| {
            AppError::Database(format!("未知 Agent key: {agent_key}（无对应 agents 记录）"))
        })
    }
}

impl ReminderStateRepositoryPort for SqliteReminderStateRepository {
    fn get_settings(&self) -> AppResult<ReminderSettings> {
        self.db.with_conn(|conn| {
            let (cooldown_minutes, updated_at): (i64, String) = conn
                .query_row(
                    "SELECT cooldown_minutes, updated_at FROM reminder_settings WHERE id = 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(AppError::from)?
                .ok_or_else(|| {
                    AppError::Database(
                        "reminder_settings 缺少 id=1 默认行（migration 未执行）".into(),
                    )
                })?;
            Ok(ReminderSettings {
                cooldown_minutes: validate_cooldown_minutes(cooldown_minutes)?,
                updated_at: parse_rfc(&updated_at)?,
            })
        })
    }

    fn update_settings(&self, cooldown_minutes: i64) -> AppResult<ReminderSettings> {
        validate_cooldown_minutes(cooldown_minutes)?;
        let now = Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE reminder_settings SET cooldown_minutes = ?1, updated_at = ?2 WHERE id = 1",
                params![cooldown_minutes, now],
            )
            .map_err(AppError::from)?;
            Ok(ReminderSettings {
                cooldown_minutes,
                updated_at: parse_rfc(&now)?,
            })
        })
    }

    fn last_shown_at(&self, agent_key: &str) -> AppResult<Option<DateTime<Utc>>> {
        self.db.with_conn(|conn| {
            let agent_id = self.agent_db_id(conn, agent_key)?;
            let raw: Option<String> = conn
                .query_row(
                    "SELECT last_shown_at FROM agent_reminder_state WHERE agent_id = ?1",
                    params![agent_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(AppError::from)?;
            raw.map(|value| parse_rfc(&value)).transpose()
        })
    }

    fn set_last_shown_at(&self, agent_key: &str, at: DateTime<Utc>) -> AppResult<()> {
        self.db.with_conn(|conn| {
            let agent_id = self.agent_db_id(conn, agent_key)?;
            conn.execute(
                "INSERT INTO agent_reminder_state (agent_id, last_shown_at, updated_at)
                 VALUES (?1, ?2, ?2)
                 ON CONFLICT(agent_id) DO UPDATE SET last_shown_at = excluded.last_shown_at,
                                                      updated_at = excluded.updated_at",
                params![agent_id, at.to_rfc3339()],
            )
            .map_err(AppError::from)?;
            Ok(())
        })
    }
}

/// Default Carry eligibility 查询（只读，join agents.key）。
pub struct SqliteReminderEligibility {
    db: Arc<SqliteDatabase>,
}

impl SqliteReminderEligibility {
    pub fn new(db: Arc<SqliteDatabase>) -> Self {
        Self { db }
    }
}

impl ReminderEligibilityPort for SqliteReminderEligibility {
    fn agent_info(&self, agent_key: &str) -> AppResult<Option<AgentIdentity>> {
        let agent_key = normalize_agent_key(agent_key);
        self.db.with_conn(|conn| {
            let row: Option<(String, String)> = conn
                .query_row(
                    "SELECT id, name FROM agents WHERE key = ?1",
                    params![agent_key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(AppError::from)?;
            match row {
                Some((id, name)) => {
                    let parsed = Uuid::parse_str(&id)
                        .map_err(|e| AppError::Database(format!("agents.id 无效: {e}")))?;
                    Ok(Some(AgentIdentity {
                        id: parsed,
                        display_name: name,
                    }))
                }
                None => Ok(None),
            }
        })
    }

    fn eligible_tips(&self, agent_key: &str) -> AppResult<Vec<ReminderTip>> {
        let agent_key = normalize_agent_key(agent_key);
        self.db.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT t.id, t.title, t.content, t.color_key
                     FROM tip_agents ta
                     JOIN tips t ON t.id = ta.tip_id
                     JOIN agents a ON a.id = ta.agent_id
                     WHERE a.key = ?1
                       AND ta.auto_attach = 1
                       AND t.status = 'active'
                       AND t.deleted_at IS NULL
                       AND t.used_at IS NULL
                     ORDER BY ta.sort_order ASC, t.created_at ASC, t.id ASC",
                )
                .map_err(AppError::from)?;
            let rows = stmt
                .query_map(params![agent_key], |row| {
                    Ok(ReminderTip {
                        tip_id: Uuid::parse_str(&row.get::<_, String>(0)?)
                            .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
                        title: row.get(1)?,
                        body: row.get(2)?,
                        color_key: NoteColorKey::parse(&row.get::<_, String>(3)?)
                            .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
                    })
                })
                .map_err(AppError::from)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(AppError::from)?;
            Ok(rows)
        })
    }
}

fn parse_rfc(value: &str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| AppError::Database(format!("reminder 时间字段格式无效: {value:?} ({e})")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use rusqlite::params;

    fn setup() -> (
        Arc<SqliteDatabase>,
        SqliteReminderStateRepository,
        SqliteReminderEligibility,
    ) {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let repo = SqliteReminderStateRepository::new(db.clone());
        let eligibility = SqliteReminderEligibility::new(db.clone());
        (db, repo, eligibility)
    }

    fn codex_id() -> String {
        // agents.key='codex-cli' 的确定性 UUID（与 seed 一致）
        let db = SqliteDatabase::open_in_memory().unwrap();
        let id: String = db
            .with_conn(|conn| {
                Ok(conn
                    .query_row("SELECT id FROM agents WHERE key = 'codex-cli'", [], |r| {
                        r.get(0)
                    })
                    .unwrap())
            })
            .unwrap();
        id
    }

    fn insert_tip(
        db: &SqliteDatabase,
        tip_id: &str,
        content: &str,
        agent_key: &str,
        auto_attach: bool,
        used: bool,
        deleted: bool,
    ) {
        let now = Utc::now().to_rfc3339();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO tips (id, title, content, status, created_at, updated_at, deleted_at, color_key, used_at)
                 VALUES (?1, ?2, ?3, 'active', ?4, ?4, ?5, 'lemon', ?6)",
                params![
                    tip_id,
                    content,
                    content,
                    now,
                    if deleted { Some(&now) } else { None },
                    if used { Some(&now) } else { None },
                ],
            )
            .unwrap();
            let agent_id: String = conn
                .query_row("SELECT id FROM agents WHERE key = ?1", params![agent_key], |r| {
                    r.get(0)
                })
                .unwrap();
            conn.execute(
                "INSERT INTO tip_agents (tip_id, agent_id, auto_attach, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 0, ?4, ?4)",
                params![tip_id, agent_id, auto_attach as i64, now],
            )
            .unwrap();
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn fresh_db_migrates_to_latest_version() {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let version: i64 = db
            .with_conn(|conn| {
                Ok(conn
                    .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
                    .unwrap())
            })
            .unwrap();
        assert_eq!(version, 5);
    }

    #[test]
    fn reminder_settings_seed_is_15() {
        let (_, repo, _) = setup();
        assert_eq!(repo.get_settings().unwrap().cooldown_minutes, 15);
    }

    #[test]
    fn update_cooldown_persists() {
        let (_, repo, _) = setup();
        let updated = repo.update_settings(5).unwrap();
        assert_eq!(updated.cooldown_minutes, 5);
        assert_eq!(repo.get_settings().unwrap().cooldown_minutes, 5);
    }

    #[test]
    fn invalid_cooldown_rejected() {
        let (_, repo, _) = setup();
        assert!(repo.update_settings(0).is_err());
        assert!(repo.update_settings(121).is_err());
        assert!(repo.update_settings(-1).is_err());
        assert_eq!(repo.get_settings().unwrap().cooldown_minutes, 15);
    }

    #[test]
    fn last_shown_persists_per_agent_independently() {
        let (_, repo, _) = setup();
        let t1 = Utc.timestamp_opt(1000, 0).unwrap();
        let t2 = Utc.timestamp_opt(2000, 0).unwrap();
        repo.set_last_shown_at("codex-cli", t1).unwrap();
        repo.set_last_shown_at("cursor", t2).unwrap();
        assert_eq!(repo.last_shown_at("codex-cli").unwrap(), Some(t1));
        assert_eq!(repo.last_shown_at("cursor").unwrap(), Some(t2));
        // 覆盖更新
        let t3 = Utc.timestamp_opt(3000, 0).unwrap();
        repo.set_last_shown_at("codex-cli", t3).unwrap();
        assert_eq!(repo.last_shown_at("codex-cli").unwrap(), Some(t3));
        assert_eq!(repo.last_shown_at("cursor").unwrap(), Some(t2));
    }

    #[test]
    fn restart_reads_states() {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let repo = SqliteReminderStateRepository::new(db.clone());
        let t = Utc.timestamp_opt(1234, 0).unwrap();
        repo.set_last_shown_at("codex-cli", t).unwrap();
        repo.update_settings(7).unwrap();
        // 重开（新连接/migration 幂等）后仍能读回
        let repo2 = SqliteReminderStateRepository::new(db);
        assert_eq!(repo2.last_shown_at("codex-cli").unwrap(), Some(t));
        assert_eq!(repo2.get_settings().unwrap().cooldown_minutes, 7);
    }

    #[test]
    fn unknown_agent_state_handled_safely() {
        let (_, repo, _) = setup();
        assert!(repo.set_last_shown_at("unknown-agent", Utc::now()).is_err());
        assert!(repo.last_shown_at("unknown-agent").is_err());
    }

    #[test]
    fn eligibility_respects_auto_attach_and_active_semantics() {
        let (db, _, eligibility) = setup();
        insert_tip(
            &db,
            "11111111-1111-1111-1111-111111111111",
            "A",
            "codex-cli",
            true,
            false,
            false,
        );
        insert_tip(
            &db,
            "22222222-2222-2222-2222-222222222222",
            "B",
            "codex-cli",
            false,
            false,
            false,
        );
        insert_tip(
            &db,
            "33333333-3333-3333-3333-333333333333",
            "C",
            "cursor",
            true,
            false,
            false,
        );
        insert_tip(
            &db,
            "44444444-4444-4444-4444-444444444444",
            "D",
            "codex-cli",
            true,
            true,
            false,
        );
        insert_tip(
            &db,
            "55555555-5555-5555-5555-555555555555",
            "E",
            "codex-cli",
            true,
            false,
            true,
        );
        let tips = eligibility.eligible_tips("codex-cli").unwrap();
        assert_eq!(tips.len(), 1);
        assert_eq!(
            tips[0].tip_id.to_string(),
            "11111111-1111-1111-1111-111111111111"
        );
        assert_eq!(tips[0].body, "A");
        let cursor_tips = eligibility.eligible_tips("cursor").unwrap();
        assert_eq!(cursor_tips.len(), 1);
        assert_eq!(cursor_tips[0].body, "C");
    }

    #[test]
    fn eligibility_empty_for_unknown_agent() {
        let (_, _, eligibility) = setup();
        assert!(eligibility.eligible_tips("unknown").unwrap().is_empty());
    }

    #[test]
    fn eligibility_respects_sort_order() {
        let (db, _, eligibility) = setup();
        let now = Utc::now().to_rfc3339();
        let agent_id = codex_id();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO tips (id, title, content, status, created_at, updated_at, color_key)
                 VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1', 'first', 'active', ?1, ?1, 'lemon')",
                params![now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tips (id, title, content, status, created_at, updated_at, color_key)
                 VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2', 'second', 'active', ?1, ?1, 'mint')",
                params![now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tip_agents (tip_id, agent_id, auto_attach, sort_order, created_at, updated_at)
                 VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ?1, 1, 5, ?2, ?2)",
                params![agent_id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tip_agents (tip_id, agent_id, auto_attach, sort_order, created_at, updated_at)
                 VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ?1, 1, 1, ?2, ?2)",
                params![agent_id, now],
            )
            .unwrap();
            Ok(())
        })
        .unwrap();
        let tips = eligibility.eligible_tips("codex-cli").unwrap();
        assert_eq!(tips[0].body, "second");
        assert_eq!(tips[1].body, "first");
    }

    #[test]
    fn detection_key_codex_maps_to_codex_cli() {
        let (db, repo, eligibility) = setup();
        insert_tip(
            &db,
            "99999999-9999-9999-9999-999999999999",
            "codex tip",
            "codex-cli",
            true,
            false,
            false,
        );
        // detection 侧 key 是 "codex"（Phase 4B），DB 侧是 "codex-cli"。
        let tips = eligibility.eligible_tips("codex").unwrap();
        assert_eq!(tips.len(), 1);
        assert_eq!(tips[0].body, "codex tip");
        let t = Utc.timestamp_opt(4000, 0).unwrap();
        repo.set_last_shown_at("codex", t).unwrap();
        assert_eq!(repo.last_shown_at("codex").unwrap(), Some(t));
        assert_eq!(repo.last_shown_at("codex-cli").unwrap(), Some(t));
    }
}
