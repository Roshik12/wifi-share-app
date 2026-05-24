const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, "server", "data");
const dbPath = path.join(dataDir, "messages.sqlite");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    group_name TEXT NOT NULL DEFAULT 'main',
    group_key TEXT NOT NULL DEFAULT 'open:main',
    username TEXT NOT NULL,
    text TEXT,
    timestamp INTEGER NOT NULL,
    file_url TEXT,
    file_path TEXT,
    file_name TEXT,
    file_type TEXT,
    file_size INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_timestamp
  ON messages (timestamp);

  CREATE INDEX IF NOT EXISTS idx_messages_group_timestamp
  ON messages (group_name, timestamp);

  CREATE INDEX IF NOT EXISTS idx_messages_group_key_timestamp
  ON messages (group_key, timestamp);

  CREATE TABLE IF NOT EXISTS groups (
    name_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    group_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
`);

const columns = db.prepare("PRAGMA table_info(messages)").all().map((column) => column.name);
if (!columns.includes("group_name")) {
  db.exec("ALTER TABLE messages ADD COLUMN group_name TEXT NOT NULL DEFAULT 'main'");
}
if (!columns.includes("group_key")) {
  db.exec("ALTER TABLE messages ADD COLUMN group_key TEXT NOT NULL DEFAULT 'open:main'");
}

const insertGroup = db.prepare(`
  INSERT INTO groups (name_key, display_name, password_hash, group_key, created_at)
  VALUES (@nameKey, @displayName, @passwordHash, @groupKey, @createdAt)
`);

const findGroup = db.prepare(`
  SELECT
    name_key AS nameKey,
    display_name AS displayName,
    password_hash AS passwordHash,
    group_key AS groupKey,
    created_at AS createdAt
  FROM groups
  WHERE name_key = ?
`);

const insertMessage = db.prepare(`
  INSERT INTO messages (
    id, group_name, group_key, username, text, timestamp, file_url, file_path, file_name, file_type, file_size
  )
  VALUES (
    @id, @groupName, @groupKey, @username, @text, @timestamp, @fileUrl, @filePath, @fileName, @fileType, @fileSize
  )
`);

const listMessages = db.prepare(`
  SELECT
    id,
    group_name AS groupName,
    group_key AS groupKey,
    username,
    text,
    timestamp,
    file_url AS fileUrl,
    file_path AS filePath,
    file_name AS fileName,
    file_type AS fileType,
    file_size AS fileSize
  FROM messages
  WHERE timestamp >= ?
    AND group_key = ?
  ORDER BY timestamp ASC
`);

const expiredMessages = db.prepare(`
  SELECT
    id,
    file_path AS filePath
  FROM messages
  WHERE timestamp < ?
`);

const deleteExpired = db.prepare(`
  DELETE FROM messages
  WHERE timestamp < ?
`);

module.exports = {
  dbPath,
  insertGroup,
  findGroup,
  insertMessage,
  listMessages,
  expiredMessages,
  deleteExpired,
};
