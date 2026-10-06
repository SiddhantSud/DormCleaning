// SQLite storage (built into Node 22.5+), kept in data/app.db.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    date TEXT NOT NULL,
    room TEXT NOT NULL,
    bed TEXT NOT NULL,
    action TEXT NOT NULL,          -- change | set | leave
    position INTEGER NOT NULL,
    done_by TEXT,
    done_at TEXT,
    PRIMARY KEY (date, room, bed)
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    room TEXT NOT NULL,
    staff TEXT NOT NULL,
    file TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    sub TEXT NOT NULL,
    staff TEXT,
    lang TEXT NOT NULL DEFAULT 'en',
    manager INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const meta = {
  get(key) { return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null; },
  set(key, value) { db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value)); },
};

module.exports = { db, meta };
