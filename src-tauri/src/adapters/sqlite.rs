use std::path::Path;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::domain::agents::{Agent, AgentKind};
use crate::domain::tips::{Tip, TipBinding, TipQuery, TipStatus};
use crate::error::{AppError, AppResult};
use crate::ports::agents::AgentRepository;
use crate::ports::tips::TipRepository;

const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("../../migrations/0001_init.sql"))];

/// 内置 Agent 初始名单（docs/03-domain-data-model.md）。
const BUILTIN_AGENTS: &[(&str, &str, AgentKind)] = &[
    ("chatgpt-desktop", "ChatGPT", AgentKind::Desktop),
    ("cursor", "Cursor", AgentKind::Desktop),
    ("trae", "Trae", AgentKind::Desktop),
    ("claude-code", "Claude Code", AgentKind::Terminal),
    ("opencode", "OpenCode", AgentKind::Terminal),
    ("codex-cli", "Codex", AgentKind::Terminal),
];

pub struct SqliteDatabase {
    conn: Mutex<Connection>,
}

impl SqliteDatabase {
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path).map_err(AppError::from)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory().map_err(AppError::from)?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        conn.pragma_update(None, "foreign_keys", true)
            .map_err(AppError::from)?;
        // 单连接 Mutex 串行化自身访问；busy_timeout 防止与外部进程短暂写竞争时报 locked。
        conn.busy_timeout(Duration::from_millis(5000))
            .map_err(AppError::from)?;
        run_migrations(&conn)?;
        seed_builtin_agents(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

/// 单版本迁移：schema DDL 与版本记录在同一事务，中途失败整体回滚。
fn apply_migration(conn: &Connection, version: i64, sql: &str) -> AppResult<()> {
    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    tx.execute_batch(sql).map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
        params![version, Utc::now().to_rfc3339()],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )
    .map_err(AppError::from)?;

    for (version, sql) in MIGRATIONS {
        let applied: Option<i64> = conn
            .query_row(
                "SELECT version FROM schema_migrations WHERE version = ?1",
                params![version],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)?;
        if applied.is_some() {
            continue;
        }
        apply_migration(conn, *version, sql)?;
    }
    Ok(())
}

fn seed_builtin_agents(conn: &Connection) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    for (key, name, kind) in BUILTIN_AGENTS {
        // 稳定 ID（与 Phase 1 Mock 的 agent-* 不同；以数据库为准）
        let id = builtin_agent_id(key);
        let inserted = conn
            .execute(
                "INSERT OR IGNORE INTO agents (id, key, name, kind, built_in, enabled, reminder_enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, 1, 1, ?5, ?5)",
                params![id.to_string(), key, name, kind.as_str(), now],
            )
            .map_err(AppError::from)?;
        if inserted == 0 {
            // 已存在（key 唯一）：不覆盖用户字段
            continue;
        }
    }
    Ok(())
}

fn builtin_agent_id(key: &str) -> Uuid {
    // 稳定 UUID：以 key 生成确定性 ID，保证幂等且可读。
    let bytes = key.as_bytes();
    let mut seed = [0u8; 16];
    for (i, b) in bytes.iter().enumerate() {
        seed[i % 16] ^= b;
    }
    seed[6] = (seed[6] & 0x0f) | 0x40;
    seed[8] = (seed[8] & 0x3f) | 0x80;
    Uuid::from_bytes(seed)
}

fn parse_rfc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn rfc(at: DateTime<Utc>) -> String {
    at.to_rfc3339()
}

fn tip_from_row(row: &Row) -> rusqlite::Result<Tip> {
    let id: String = row.get(0)?;
    let title: Option<String> = row.get(1)?;
    let content: String = row.get(2)?;
    let status: String = row.get(3)?;
    let created_at: String = row.get(4)?;
    let updated_at: String = row.get(5)?;
    let deleted_at: Option<String> = row.get(6)?;
    Ok(Tip {
        id: Uuid::from_str(&id).map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        title,
        content,
        status: TipStatus::parse(&status)
            .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        created_at: parse_rfc(&created_at)
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("created_at".into()))?,
        updated_at: parse_rfc(&updated_at)
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("updated_at".into()))?,
        deleted_at: deleted_at.and_then(|v| parse_rfc(&v)),
        bindings: Vec::new(),
    })
}

fn agent_from_row(row: &Row) -> rusqlite::Result<Agent> {
    let id: String = row.get(0)?;
    let key: String = row.get(1)?;
    let name: String = row.get(2)?;
    let kind: String = row.get(3)?;
    let built_in: i64 = row.get(4)?;
    let enabled: i64 = row.get(5)?;
    let reminder_enabled: i64 = row.get(6)?;
    let created_at: String = row.get(7)?;
    let updated_at: String = row.get(8)?;
    Ok(Agent {
        id: Uuid::from_str(&id).map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        key,
        name,
        kind: AgentKind::parse(&kind)
            .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
        built_in: built_in != 0,
        enabled: enabled != 0,
        reminder_enabled: reminder_enabled != 0,
        created_at: parse_rfc(&created_at)
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("created_at".into()))?,
        updated_at: parse_rfc(&updated_at)
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("updated_at".into()))?,
    })
}

fn load_bindings(conn: &Connection, tip_ids: &[Uuid]) -> AppResult<Vec<(Uuid, TipBinding)>> {
    if tip_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; tip_ids.len()].join(", ");
    let sql = format!(
        "SELECT tip_id, agent_id, auto_attach, sort_order FROM tip_agents WHERE tip_id IN ({placeholders}) ORDER BY tip_id, sort_order"
    );
    let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
    let params: Vec<String> = tip_ids.iter().map(|id| id.to_string()).collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            let tip_id: String = row.get(0)?;
            let agent_id: String = row.get(1)?;
            let auto_attach: i64 = row.get(2)?;
            let sort_order: i64 = row.get(3)?;
            Ok((
                Uuid::from_str(&tip_id)
                    .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
                TipBinding {
                    agent_id: Uuid::from_str(&agent_id)
                        .map_err(|e| rusqlite::Error::InvalidColumnName(e.to_string()))?,
                    auto_attach: auto_attach != 0,
                    sort_order,
                },
            ))
        })
        .map_err(AppError::from)?;
    let mut by_tip: Vec<(Uuid, TipBinding)> = Vec::new();
    for row in rows {
        by_tip.push(row.map_err(AppError::from)?);
    }
    Ok(by_tip)
}

fn load_tip(conn: &Connection, id: Uuid) -> AppResult<Option<Tip>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, status, created_at, updated_at, deleted_at
             FROM tips WHERE id = ?1 AND deleted_at IS NULL",
        )
        .map_err(AppError::from)?;
    let mut rows = stmt
        .query_map(params![id.to_string()], tip_from_row)
        .map_err(AppError::from)?;
    let Some(row) = rows.next() else {
        return Ok(None);
    };
    let mut tip = row.map_err(AppError::from)?;
    tip.bindings = load_bindings(conn, &[id])?
        .into_iter()
        .map(|(_, b)| b)
        .collect();
    Ok(Some(tip))
}

fn ensure_agents_exist(conn: &Connection, agent_ids: &[Uuid]) -> AppResult<()> {
    for agent_id in agent_ids {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE id = ?1",
                params![agent_id.to_string()],
                |row| row.get(0),
            )
            .map_err(AppError::from)?;
        if count == 0 {
            return Err(AppError::NotFound(format!("Agent {} 不存在", agent_id)));
        }
    }
    Ok(())
}

fn insert_bindings(conn: &Connection, tip_id: Uuid, bindings: &[TipBinding]) -> AppResult<()> {
    let now = rfc(Utc::now());
    for binding in bindings {
        conn.execute(
            "INSERT INTO tip_agents (tip_id, agent_id, auto_attach, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                tip_id.to_string(),
                binding.agent_id.to_string(),
                binding.auto_attach as i64,
                binding.sort_order,
                now
            ],
        )
        .map_err(AppError::from)?;
    }
    Ok(())
}

impl TipRepository for SqliteDatabase {
    fn create_with_bindings(&self, tip: &Tip, bindings: &[TipBinding]) -> AppResult<Tip> {
        let conn = self.conn.lock().unwrap();
        ensure_agents_exist(
            &conn,
            &bindings.iter().map(|b| b.agent_id).collect::<Vec<_>>(),
        )?;
        let tx = conn.unchecked_transaction().map_err(AppError::from)?;
        tx.execute(
            "INSERT INTO tips (id, title, content, status, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL)",
            params![
                tip.id.to_string(),
                tip.title,
                tip.content,
                tip.status.as_str(),
                rfc(tip.created_at)
            ],
        )
        .map_err(AppError::from)?;
        insert_bindings(&tx, tip.id, bindings)?;
        tx.commit().map_err(AppError::from)?;
        load_tip(&conn, tip.id)?.ok_or_else(|| AppError::Internal("创建后读取失败".into()))
    }

    fn update_with_bindings(&self, tip: &Tip, bindings: &[TipBinding]) -> AppResult<Tip> {
        let conn = self.conn.lock().unwrap();
        ensure_agents_exist(
            &conn,
            &bindings.iter().map(|b| b.agent_id).collect::<Vec<_>>(),
        )?;
        let tx = conn.unchecked_transaction().map_err(AppError::from)?;
        let affected = tx
            .execute(
                "UPDATE tips SET title = ?2, content = ?3, status = ?4, updated_at = ?5
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![
                    tip.id.to_string(),
                    tip.title,
                    tip.content,
                    tip.status.as_str(),
                    rfc(tip.updated_at)
                ],
            )
            .map_err(AppError::from)?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Tip {} 不存在", tip.id)));
        }
        tx.execute(
            "DELETE FROM tip_agents WHERE tip_id = ?1",
            params![tip.id.to_string()],
        )
        .map_err(AppError::from)?;
        insert_bindings(&tx, tip.id, bindings)?;
        tx.commit().map_err(AppError::from)?;
        load_tip(&conn, tip.id)?.ok_or_else(|| AppError::Internal("更新后读取失败".into()))
    }

    fn get(&self, id: Uuid) -> AppResult<Option<Tip>> {
        let conn = self.conn.lock().unwrap();
        load_tip(&conn, id)
    }

    fn list(&self, query: &TipQuery) -> AppResult<Vec<Tip>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT id, title, content, status, created_at, updated_at, deleted_at
             FROM tips WHERE deleted_at IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(search) = &query.search {
            let needle = format!("%{}%", search.trim().to_lowercase());
            sql.push_str(" AND (LOWER(COALESCE(title, '')) LIKE ? OR LOWER(content) LIKE ?)");
            args.push(Box::new(needle.clone()));
            args.push(Box::new(needle));
        }
        if let Some(agent_id) = query.agent_id {
            sql.push_str(
                " AND EXISTS (SELECT 1 FROM tip_agents b WHERE b.tip_id = tips.id AND b.agent_id = ?)",
            );
            args.push(Box::new(agent_id.to_string()));
        }
        sql.push_str(" ORDER BY updated_at DESC, id ASC");

        let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
        let mut tips: Vec<Tip> = Vec::new();
        let rows = stmt
            .query_map(
                rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())),
                tip_from_row,
            )
            .map_err(AppError::from)?;
        for row in rows {
            tips.push(row.map_err(AppError::from)?);
        }
        drop(stmt);

        // 批量加载绑定并分组，避免 N+1
        let ids: Vec<Uuid> = tips.iter().map(|tip| tip.id).collect();
        let bindings = load_bindings(&conn, &ids)?;
        let mut grouped: std::collections::HashMap<Uuid, Vec<TipBinding>> =
            std::collections::HashMap::new();
        for (tip_id, binding) in bindings {
            grouped.entry(tip_id).or_default().push(binding);
        }
        for tip in tips.iter_mut() {
            if let Some(bindings) = grouped.remove(&tip.id) {
                tip.bindings = bindings;
            }
        }
        Ok(tips)
    }

    fn delete(&self, id: Uuid) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction().map_err(AppError::from)?;
        let now = rfc(Utc::now());
        let affected = tx
            .execute(
                "UPDATE tips SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
                params![id.to_string(), now],
            )
            .map_err(AppError::from)?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Tip {} 不存在", id)));
        }
        tx.execute(
            "DELETE FROM tip_agents WHERE tip_id = ?1",
            params![id.to_string()],
        )
        .map_err(AppError::from)?;
        tx.commit().map_err(AppError::from)?;
        Ok(())
    }
}

impl AgentRepository for SqliteDatabase {
    fn list(&self) -> AppResult<Vec<Agent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, key, name, kind, built_in, enabled, reminder_enabled, created_at, updated_at
                 FROM agents ORDER BY name ASC",
            )
            .map_err(AppError::from)?;
        let rows = stmt.query_map([], agent_from_row).map_err(AppError::from)?;
        let mut agents = Vec::new();
        for row in rows {
            agents.push(row.map_err(AppError::from)?);
        }
        Ok(agents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::agents::AgentKind;
    use crate::domain::tips::TipStatus;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now() -> DateTime<Utc> {
        Utc::now()
    }

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("agenttips-test-{name}-{nanos}.sqlite3"))
    }

    fn sample_tip(id: Uuid, title: Option<&str>, content: &str, bindings: &[TipBinding]) -> Tip {
        let t = now();
        Tip {
            id,
            title: title.map(str::to_string),
            content: content.to_string(),
            status: TipStatus::Active,
            created_at: t,
            updated_at: t,
            deleted_at: None,
            bindings: bindings.to_vec(),
        }
    }

    fn binding(agent_id: Uuid, auto_attach: bool, sort_order: i64) -> TipBinding {
        TipBinding {
            agent_id,
            auto_attach,
            sort_order,
        }
    }

    fn builtin_agents() -> Vec<Agent> {
        let db = SqliteDatabase::open_in_memory().unwrap();
        AgentRepository::list(&db).unwrap()
    }

    fn agent_ids(agents: &[Agent]) -> (Uuid, Uuid) {
        (agents[1].id, agents[3].id)
    }

    // ---------- migration 测试 ----------

    #[test]
    fn empty_database_migrates_successfully() {
        let path = temp_db_path("migrate");
        let db = SqliteDatabase::open(&path).expect("open should succeed");
        assert!(!AgentRepository::list(&db).unwrap().is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migration_is_idempotent_on_second_open() {
        let path = temp_db_path("idempotent");
        {
            let db = SqliteDatabase::open(&path).unwrap();
            drop(db);
        }
        let db = SqliteDatabase::open(&path).expect("second open should not error");
        assert!(!AgentRepository::list(&db).unwrap().is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn required_tables_indices_and_fk_exist() {
        let path = temp_db_path("schema");
        let db = SqliteDatabase::open(&path).unwrap();
        let conn = db.conn.lock().unwrap();
        for table in ["agents", "tips", "tip_agents", "schema_migrations"] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing table {table}");
        }
        for index in ["idx_tips_updated_at", "idx_tip_agents_agent"] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    params![index],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing index {index}");
        }
        // tip_agents 联合主键存在
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tip_agents') WHERE pk > 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "tip_agents composite PK expected");
        // 外键已开启
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn builtin_agents_seeded_idempotently() {
        let path = temp_db_path("agents");
        {
            let db = SqliteDatabase::open(&path).unwrap();
            let first = AgentRepository::list(&db).unwrap();
            assert_eq!(first.len(), 6);
            assert!(first.iter().all(|a| a.built_in));
            drop(db);
        }
        {
            let db = SqliteDatabase::open(&path).unwrap();
            let second = AgentRepository::list(&db).unwrap();
            assert_eq!(second.len(), 6, "restart must not duplicate builtin agents");
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn busy_timeout_is_configured() {
        let db = SqliteDatabase::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(timeout, 5000, "busy_timeout must be 5000ms");
    }

    #[test]
    fn every_new_connection_enables_foreign_keys() {
        let db = SqliteDatabase::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn migration_failure_rolls_back_and_does_not_write_version() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )
        .unwrap();
        // 坏 SQL：第二条语句引用不存在表
        let bad_sql = "CREATE TABLE temp_migrate (id TEXT); INSERT INTO missing_table VALUES (1);";
        assert!(apply_migration(&conn, 99, bad_sql).is_err());
        let version: Option<i64> = conn
            .query_row(
                "SELECT version FROM schema_migrations WHERE version = 99",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(
            version.is_none(),
            "failed migration must not record version"
        );
        // 表也不应残留
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'temp_migrate'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "failed migration DDL must be rolled back");
    }

    #[test]
    fn concurrent_list_calls_do_not_fail() {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let agents = AgentRepository::list(&*db).unwrap();
        let tip = sample_tip(
            Uuid::new_v4(),
            Some("并发"),
            "并发数据",
            &[binding(agents[0].id, true, 0)],
        );
        TipRepository::create_with_bindings(&*db, &tip, &tip.bindings).unwrap();

        let handles: Vec<_> = (0..2)
            .map(|_| {
                let db = db.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        TipRepository::list(&*db, &TipQuery::default())
                            .expect("list must not fail");
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("list thread must not panic");
        }
    }

    #[test]
    fn concurrent_list_and_create_do_not_panic() {
        let db = Arc::new(SqliteDatabase::open_in_memory().unwrap());
        let agents = AgentRepository::list(&*db).unwrap();
        let agent_id = agents[0].id;

        let reader = {
            let db = db.clone();
            std::thread::spawn(move || {
                for _ in 0..20 {
                    TipRepository::list(&*db, &TipQuery::default()).expect("list must not fail");
                }
            })
        };
        let writer = {
            let db = db.clone();
            std::thread::spawn(move || {
                for i in 0..20 {
                    let tip = sample_tip(
                        Uuid::new_v4(),
                        Some(&format!("写入 {i}")),
                        "并发写入",
                        &[binding(agent_id, true, 0)],
                    );
                    TipRepository::create_with_bindings(&*db, &tip, &tip.bindings)
                        .expect("create must not fail");
                }
            })
        };
        reader.join().expect("reader must not panic");
        writer.join().expect("writer must not panic");
        assert_eq!(
            TipRepository::list(&*db, &TipQuery::default())
                .unwrap()
                .len(),
            20
        );
    }

    // ---------- repository 集成测试 ----------

    fn setup_repo() -> (SqliteDatabase, Uuid, Uuid) {
        let agents = builtin_agents();
        let (agent_a, agent_b) = agent_ids(&agents);
        (SqliteDatabase::open_in_memory().unwrap(), agent_a, agent_b)
    }

    #[test]
    fn create_then_read_back() {
        let (db, agent_a, _) = setup_repo();
        let tip = sample_tip(
            Uuid::new_v4(),
            Some("标题"),
            "正文",
            &[binding(agent_a, true, 0)],
        );
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        let read = db.get(created.id).unwrap().expect("tip should exist");
        assert_eq!(read.content, "正文");
        assert_eq!(read.bindings.len(), 1);
        assert_eq!(read.bindings[0].agent_id, agent_a);
    }

    #[test]
    fn create_with_multi_agent_bindings_keeps_independent_auto_attach() {
        let (db, agent_a, agent_b) = setup_repo();
        let tip = sample_tip(
            Uuid::new_v4(),
            None,
            "多 Agent",
            &[binding(agent_a, true, 0), binding(agent_b, false, 1)],
        );
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        assert_eq!(created.bindings.len(), 2);
        assert!(created.bindings[0].auto_attach);
        assert!(!created.bindings[1].auto_attach);
        assert_eq!(created.bindings[0].sort_order, 0);
        assert_eq!(created.bindings[1].sort_order, 1);
    }

    #[test]
    fn update_content_and_replace_bindings() {
        let (db, agent_a, agent_b) = setup_repo();
        let tip = sample_tip(Uuid::new_v4(), None, "旧正文", &[binding(agent_a, true, 0)]);
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();

        let mut updated = created.clone();
        updated.title = Some("新标题".into());
        updated.content = "新正文".into();
        updated.updated_at = now();
        updated.bindings = vec![binding(agent_b, true, 0), binding(agent_a, false, 1)];
        let result = db
            .update_with_bindings(&updated, &updated.bindings)
            .unwrap();
        assert_eq!(result.content, "新正文");
        assert_eq!(result.title.as_deref(), Some("新标题"));
        assert_eq!(result.bindings.len(), 2);
        assert!(result.bindings[0].auto_attach);
        assert!(!result.bindings[1].auto_attach);
    }

    #[test]
    fn delete_removes_tip_and_bindings() {
        let (db, agent_a, _) = setup_repo();
        let tip = sample_tip(Uuid::new_v4(), None, "待删除", &[binding(agent_a, true, 0)]);
        let created = db.create_with_bindings(&tip, &tip.bindings).unwrap();
        db.delete(created.id).unwrap();
        assert!(db.get(created.id).unwrap().is_none());
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tip_agents WHERE tip_id = ?1",
                params![created.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "bindings must be removed");
    }

    #[test]
    fn binding_unknown_agent_rolls_back_transaction() {
        let (db, _, _) = setup_repo();
        let ghost = Uuid::new_v4();
        let tip = sample_tip(Uuid::new_v4(), None, "不会残留", &[binding(ghost, true, 0)]);
        assert!(matches!(
            db.create_with_bindings(&tip, &tip.bindings),
            Err(AppError::NotFound(_))
        ));
        assert!(TipRepository::list(&db, &TipQuery::default())
            .unwrap()
            .is_empty());
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tips", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0, "no partial tip rows");
    }

    #[test]
    fn filter_by_agent() {
        let (db, agent_a, agent_b) = setup_repo();
        let t1 = sample_tip(Uuid::new_v4(), None, "A", &[binding(agent_a, true, 0)]);
        let t2 = sample_tip(Uuid::new_v4(), None, "B", &[binding(agent_b, true, 0)]);
        db.create_with_bindings(&t1, &t1.bindings).unwrap();
        db.create_with_bindings(&t2, &t2.bindings).unwrap();
        let list = TipRepository::list(
            &db,
            &TipQuery {
                agent_id: Some(agent_a),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].content, "A");
    }

    #[test]
    fn search_by_keyword() {
        let (db, agent_a, _) = setup_repo();
        let t1 = sample_tip(
            Uuid::new_v4(),
            Some("运行测试"),
            "内容一",
            &[binding(agent_a, true, 0)],
        );
        let t2 = sample_tip(
            Uuid::new_v4(),
            Some("部署脚本"),
            "内容二",
            &[binding(agent_a, true, 0)],
        );
        db.create_with_bindings(&t1, &t1.bindings).unwrap();
        db.create_with_bindings(&t2, &t2.bindings).unwrap();
        let list = TipRepository::list(
            &db,
            &TipQuery {
                search: Some("测试".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title.as_deref(), Some("运行测试"));
    }

    #[test]
    fn list_order_is_deterministic() {
        let (db, agent_a, _) = setup_repo();
        let base = now();
        for (i, title) in ["第一条", "第二条", "第三条"].iter().enumerate() {
            let mut tip = sample_tip(
                Uuid::new_v4(),
                Some(title),
                "内容",
                &[binding(agent_a, true, 0)],
            );
            tip.updated_at = base + chrono::Duration::seconds(i as i64);
            db.create_with_bindings(&tip, &tip.bindings).unwrap();
        }
        let first = TipRepository::list(&db, &TipQuery::default()).unwrap();
        let second = TipRepository::list(&db, &TipQuery::default()).unwrap();
        let titles: Vec<Option<String>> = first.iter().map(|t| t.title.clone()).collect();
        assert_eq!(titles[0].as_deref(), Some("第三条"));
        assert_eq!(titles[2].as_deref(), Some("第一条"));
        assert_eq!(
            titles,
            second.iter().map(|t| t.title.clone()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn data_survives_reopen() {
        let path = temp_db_path("reopen");
        let tip_id = Uuid::new_v4();
        {
            let db = SqliteDatabase::open(&path).unwrap();
            let agents = AgentRepository::list(&db).unwrap();
            let tip = sample_tip(
                tip_id,
                Some("持久化"),
                "重启后仍在",
                &[binding(agents[0].id, true, 0)],
            );
            db.create_with_bindings(&tip, &tip.bindings).unwrap();
        }
        let db = SqliteDatabase::open(&path).unwrap();
        let read = db.get(tip_id).unwrap().expect("data must survive reopen");
        assert_eq!(read.content, "重启后仍在");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    // 防止 builtin_agents helper 未使用告警
    #[allow(dead_code)]
    fn _kind_used(kind: AgentKind) -> &'static str {
        kind.as_str()
    }
}
