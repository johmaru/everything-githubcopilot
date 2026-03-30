#!/usr/bin/env node
'use strict';

/**
 * Database module — SQLite-backed session persistence for Copilot hooks.
 *
 * Provides a thin DAO layer over better-sqlite3 with sqlite-vec support.
 * Falls back gracefully when the native module is unavailable.
 */

const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(process.cwd(), '.github', 'sessions');
const DB_PATH = path.join(DB_DIR, 'copilot.db');
const EMBEDDING_DIM = 384; // all-MiniLM-L6-v2
const REQUIRED_DEPS = ['better-sqlite3', 'sqlite-vec'];

let _db = null;
let _available = null;
let _vecLoaded = false;

/**
 * Find the nearest directory containing package.json, starting from startDir
 * and walking up. Returns null if not found.
 */
function findPackageRoot(startDir) {
  let dir = startDir;
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Detect the package manager configured for a project directory.
 * Returns 'yarn', 'pnpm', or 'npm' (default).
 */
function detectPackageManager(dir) {
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.packageManager === 'string') {
        if (pkg.packageManager.startsWith('yarn')) return 'yarn';
        if (pkg.packageManager.startsWith('pnpm')) return 'pnpm';
      }
    }
  } catch {
    // Ignore parse errors
  }
  return 'npm';
}

/**
 * Build the install command for the detected package manager.
 */
function buildInstallCommand(pm, deps) {
  switch (pm) {
    case 'yarn':
      return `yarn add ${deps}`;
    case 'pnpm':
      return `pnpm add ${deps}`;
    default:
      return `npm install --no-audit --no-fund ${deps}`;
  }
}

/**
 * Ensure required native dependencies (better-sqlite3, sqlite-vec) are installed.
 *
 * Looks for the nearest package.json from the scripts directory and runs
 * the appropriate package manager install there. Returns true if deps
 * became available (or already were).
 *
 * Safe to call from hooks — uses a short timeout and never throws.
 */
function ensureDependencies() {
  // Already available — nothing to do
  if (isAvailable()) {
    return true;
  }

  const { execSync } = require('child_process');

  // Walk up from this script to find the project root with package.json
  const installDir = findPackageRoot(__dirname) || process.cwd();
  const deps = REQUIRED_DEPS.join(' ');
  const pm = detectPackageManager(installDir);
  const cmd = buildInstallCommand(pm, deps);

  try {
    execSync(cmd, {
      cwd: installDir,
      timeout: 60_000,
      stdio: 'pipe',
    });
  } catch (err) {
    // Log to stderr so the user knows why DB features are unavailable
    process.stderr.write(
      `[db] Failed to install database dependencies (${pm}): ${err.message || 'unknown error'}\n` +
      `[db] Run manually: cd ${installDir} && ${cmd}\n`
    );
    return false;
  }

  // Clear the cached availability flag and re-check
  _available = null;
  return isAvailable();
}

/**
 * Check whether better-sqlite3 is loadable without actually opening a DB.
 */
function isAvailable() {
  if (_available !== null) {
    return _available;
  }

  try {
    require('better-sqlite3');
    _available = true;
  } catch {
    _available = false;
  }

  return _available;
}

/**
 * Open (or create) the SQLite database and apply migrations.
 * Returns the database handle or null if unavailable.
 */
function open() {
  if (_db) {
    return _db;
  }

  if (!isAvailable()) {
    return null;
  }

  const Database = require('better-sqlite3');

  fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);

  // Enable WAL mode for reliability and concurrent read performance
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 3000');

  // Load sqlite-vec extension for vector search
  try {
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(_db);
    _vecLoaded = true;
  } catch {
    // sqlite-vec not available — vector search disabled, core features still work
    _vecLoaded = false;
  }

  migrate(_db);
  return _db;
}

/**
 * Apply schema migrations idempotently.
 */
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      branch TEXT,
      summary TEXT,
      transcript_tail TEXT
    );

    CREATE TABLE IF NOT EXISTS session_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      file_path TEXT NOT NULL,
      action TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'pattern',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      session_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started
      ON sessions(started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_pending_status
      ON pending_tasks(status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_session_files_session
      ON session_files(session_id);

    CREATE INDEX IF NOT EXISTS idx_knowledge_kind
      ON knowledge(kind, created_at DESC);
  `);

  // Create virtual vector table (gracefully skips if sqlite-vec not loaded)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec
        USING vec0(embedding float[${EMBEDDING_DIM}]);
    `);
  } catch {
    // sqlite-vec not loaded — vector search will be unavailable
  }
}

// ---------------------------------------------------------------------------
// DAO helpers — all return plain objects (no mutation of inputs)
// ---------------------------------------------------------------------------

/**
 * Upsert a session record.
 */
function upsertSession(db, { id, startedAt, endedAt, branch, summary, transcriptTail }) {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, started_at, ended_at, branch, summary, transcript_tail)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
      branch = COALESCE(excluded.branch, sessions.branch),
      summary = COALESCE(excluded.summary, sessions.summary),
      transcript_tail = COALESCE(excluded.transcript_tail, sessions.transcript_tail)
  `);

  stmt.run(id, startedAt, endedAt || null, branch || null, summary || null, transcriptTail || null);
}

/**
 * Insert file records for a session.
 */
function insertSessionFiles(db, sessionId, files) {
  const stmt = db.prepare(
    'INSERT INTO session_files (session_id, file_path, action) VALUES (?, ?, ?)'
  );

  const tx = db.transaction((items) => {
    for (const { filePath, action } of items) {
      stmt.run(sessionId, filePath, action);
    }
  });

  tx(files);
}

/**
 * Insert a pending task.
 */
function insertPendingTask(db, { sessionId, description, status, createdAt }) {
  const stmt = db.prepare(
    'INSERT INTO pending_tasks (session_id, description, status, created_at) VALUES (?, ?, ?, ?)'
  );

  stmt.run(sessionId, description, status || 'pending', createdAt);
}

/**
 * Fetch the N most recent session summaries.
 */
function getRecentSessions(db, limit = 3) {
  const stmt = db.prepare(`
    SELECT id, started_at, ended_at, branch, summary
    FROM sessions
    WHERE summary IS NOT NULL AND summary != ''
    ORDER BY started_at DESC
    LIMIT ?
  `);

  return stmt.all(limit);
}

/**
 * Fetch all pending tasks (not yet done).
 */
function getPendingTasks(db) {
  const stmt = db.prepare(`
    SELECT pt.id, pt.session_id, pt.description, pt.status, pt.created_at
    FROM pending_tasks pt
    WHERE pt.status = 'pending'
    ORDER BY pt.created_at DESC
    LIMIT 20
  `);

  return stmt.all();
}

// ---------------------------------------------------------------------------
// Knowledge + vector helpers
// ---------------------------------------------------------------------------

/**
 * Check whether sqlite-vec was loaded successfully.
 */
function isVecAvailable() {
  return _vecLoaded;
}

/**
 * Insert a knowledge entry with its embedding vector.
 * Returns the inserted row id.
 */
function insertKnowledge(db, { source, kind, content, createdAt, sessionId, embedding }) {
  const stmt = db.prepare(`
    INSERT INTO knowledge (source, kind, content, created_at, session_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(source, kind || 'pattern', content, createdAt, sessionId || null);
  const rowId = result.lastInsertRowid;

  // Insert vector if embedding was provided (gracefully skips if sqlite-vec not loaded)
  if (embedding) {
    try {
      const vecStmt = db.prepare(
        'INSERT INTO knowledge_vec (rowid, embedding) VALUES (?, ?)'
      );
      vecStmt.run(rowId, vecToBlob(embedding));
    } catch {
      // sqlite-vec not loaded or knowledge_vec table missing — skip vector storage
    }
  }

  return Number(rowId);
}

/**
 * Search knowledge by vector similarity.
 * Returns [{id, source, kind, content, created_at, distance}] ordered by nearest first.
 */
function searchKnowledge(db, embedding, limit = 5) {
  try {
    const stmt = db.prepare(`
      SELECT kn.id, kn.source, kn.kind, kn.content, kn.created_at, v.distance
      FROM knowledge_vec v
      INNER JOIN knowledge kn ON kn.id = v.rowid
      WHERE v.embedding MATCH ?
        AND k = ?
      ORDER BY v.distance
    `);

    return stmt.all(vecToBlob(embedding), limit);
  } catch {
    // sqlite-vec not loaded or knowledge_vec table missing
    return [];
  }
}

/**
 * Search knowledge by keyword (fallback when no embedding available).
 */
function searchKnowledgeByKeyword(db, keyword, limit = 10) {
  const stmt = db.prepare(`
    SELECT id, source, kind, content, created_at
    FROM knowledge
    WHERE content LIKE ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  return stmt.all(`%${keyword}%`, limit);
}

/**
 * Get all knowledge entries (for export/review).
 */
function getAllKnowledge(db, limit = 100) {
  const stmt = db.prepare(`
    SELECT id, source, kind, content, created_at, session_id
    FROM knowledge
    ORDER BY created_at DESC
    LIMIT ?
  `);

  return stmt.all(limit);
}

// ---------------------------------------------------------------------------
// Vector conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Float32Array or number[] to a Buffer for sqlite-vec.
 */
function vecToBlob(vec) {
  const floats = vec instanceof Float32Array ? vec : new Float32Array(vec);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

/**
 * Convert a Buffer from sqlite-vec back to Float32Array.
 */
function blobToVec(blob) {
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

/**
 * Close the database connection.
 */
function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  blobToVec,
  close,
  ensureDependencies,
  getAllKnowledge,
  getRecentSessions,
  getPendingTasks,
  insertKnowledge,
  insertPendingTask,
  insertSessionFiles,
  isAvailable,
  isVecAvailable,
  open,
  searchKnowledge,
  searchKnowledgeByKeyword,
  upsertSession,
  vecToBlob,
  DB_PATH,
  EMBEDDING_DIM,
};
