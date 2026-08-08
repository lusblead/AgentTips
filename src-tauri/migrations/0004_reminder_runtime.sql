CREATE TABLE IF NOT EXISTS reminder_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cooldown_minutes INTEGER NOT NULL CHECK (cooldown_minutes BETWEEN 1 AND 120),
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO reminder_settings (id, cooldown_minutes, updated_at)
VALUES (1, 15, '2026-08-08T00:00:00+00:00');

CREATE TABLE IF NOT EXISTS agent_reminder_state (
    agent_id TEXT PRIMARY KEY,
    last_shown_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_reminder_state_agent ON agent_reminder_state(agent_id);
