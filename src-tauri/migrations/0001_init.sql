CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('desktop', 'terminal')),
    built_in INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    reminder_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tips (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tips_updated_at ON tips(updated_at DESC);

CREATE TABLE IF NOT EXISTS tip_agents (
    tip_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    auto_attach INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tip_id, agent_id),
    FOREIGN KEY (tip_id) REFERENCES tips(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tip_agents_agent ON tip_agents(agent_id);
