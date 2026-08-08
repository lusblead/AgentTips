CREATE TABLE IF NOT EXISTS hotkey_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    modifier TEXT NOT NULL,
    key_code TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO hotkey_settings (id, modifier, key_code, updated_at)
VALUES (1, 'Control', 'F12', '2026-08-07T00:00:00+00:00');
