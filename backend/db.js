// db.js — SQLite 資料庫連線與資料表結構
// 使用 better-sqlite3：同步 API，適合中小型平台，部署簡單。
// 若未來流量成長，建議遷移至 PostgreSQL（架構可完全沿用，改用 pg 套件即可）。

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'studyseal.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  address TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  director_name TEXT DEFAULT '',
  director_phone TEXT DEFAULT '',
  director_email TEXT,
  authorization_year TEXT DEFAULT '',
  authorization_period TEXT DEFAULT '',
  plan TEXT DEFAULT '標準方案',
  status TEXT DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institution_id INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super','institution','teacher','student')),
  class_name TEXT,
  subject TEXT,
  created_by INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT,
  youtube_url TEXT,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('mc','photo')),
  text TEXT NOT NULL,
  image_url TEXT,
  options TEXT NOT NULL,      -- JSON array of strings
  correct_index INTEGER NOT NULL,
  order_index INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS course_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(course_id, student_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  submitted_at TEXT DEFAULT (datetime('now')),
  graded_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_index INTEGER,
  is_correct INTEGER DEFAULT 0,
  overridden_by INTEGER REFERENCES users(id)
);
`);

// 輕量 migration：既有 SQLite 資料庫也會補上新欄位，不需清空資料。
const institutionColumns = new Set(
  db.prepare('PRAGMA table_info(institutions)').all().map((column) => column.name)
);
const institutionMigrations = {
  address: "TEXT DEFAULT ''",
  contact_phone: "TEXT DEFAULT ''",
  director_name: "TEXT DEFAULT ''",
  director_phone: "TEXT DEFAULT ''",
  director_email: 'TEXT',
  authorization_year: "TEXT DEFAULT ''",
  authorization_period: "TEXT DEFAULT ''",
};
for (const [column, definition] of Object.entries(institutionMigrations)) {
  if (!institutionColumns.has(column)) {
    db.exec(`ALTER TABLE institutions ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = db;
