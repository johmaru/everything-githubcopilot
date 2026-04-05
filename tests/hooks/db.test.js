/**
 * Tests for the SQLite DAO module (scripts/hooks/db.js)
 *
 * Uses in-memory better-sqlite3 databases to avoid touching disk.
 * Mirrors the schema from db.js migrate() exactly.
 *
 * Run with: node tests/hooks/db.test.js
 */

const assert = require('assert');
const db = require('../../scripts/hooks/db');

// ---------------------------------------------------------------------------
// Test runner (same pattern as tests/ci/validators.test.js)
// ---------------------------------------------------------------------------
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Schema SQL — copied verbatim from db.js migrate()
// ---------------------------------------------------------------------------
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    branch TEXT,
    summary TEXT,
    transcript_tail TEXT,
    project_id TEXT
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
    project_id TEXT,
    task_key TEXT,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'pattern',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    session_id TEXT,
    project_id TEXT,
    label TEXT,
    importance TEXT NOT NULL DEFAULT 'medium',
    confidence REAL NOT NULL DEFAULT 0.5
  );

  CREATE TABLE IF NOT EXISTS knowledge_vec_map (
    knowledge_id INTEGER PRIMARY KEY REFERENCES knowledge(id),
    vec_rowid INTEGER NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    project_id TEXT,
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    tool_output TEXT,
    event_type TEXT NOT NULL DEFAULT 'tool_complete',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_started
    ON sessions(started_at DESC);

  CREATE INDEX IF NOT EXISTS idx_pending_status
    ON pending_tasks(status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_pending_project_status
    ON pending_tasks(project_id, status, updated_at DESC, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_session_files_session
    ON session_files(session_id);

  CREATE INDEX IF NOT EXISTS idx_knowledge_kind
    ON knowledge(kind, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_observations_session
    ON observations(session_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_knowledge_project
    ON knowledge(project_id, kind);

  CREATE INDEX IF NOT EXISTS idx_observations_project
    ON observations(project_id, created_at DESC);
`;

/**
 * Create an in-memory DB with the full schema applied.
 * Optionally loads sqlite-vec for vector tests.
 */
function createTestDb({ withVec = false } = {}) {
  const Database = require('better-sqlite3');
  const handle = new Database(':memory:');

  if (withVec) {
    try {
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(handle);
    } catch {
      // sqlite-vec not available — skip vector table
      return { handle, vecLoaded: false };
    }
  }

  handle.exec(SCHEMA_SQL);

  if (withVec) {
    handle.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(embedding float[${db.EMBEDDING_DIM}]);`
    );
    return { handle, vecLoaded: true };
  }

  return { handle, vecLoaded: false };
}

/**
 * Shorthand: create a plain DB without vector support.
 */
function createPlainTestDb() {
  const { handle } = createTestDb();
  return handle;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
console.log('db.js DAO tests');

const results = [];

// 1. isAvailable returns true
results.push(
  test('isAvailable returns true when better-sqlite3 is installed', () => {
    assert.strictEqual(db.isAvailable(), true);
  })
);

// 2. Schema migration is idempotent
results.push(
  test('schema migration is idempotent (run CREATE TABLE twice, no error)', () => {
    const handle = createPlainTestDb();
    // Run the schema a second time — should not throw
    handle.exec(SCHEMA_SQL);
    handle.close();
  })
);

// 3. upsertSession inserts a new session
results.push(
  test('upsertSession inserts a new session', () => {
    const handle = createPlainTestDb();
    db.upsertSession(handle, {
      id: 'sess-1',
      startedAt: '2026-03-30T10:00:00Z',
      endedAt: '2026-03-30T10:30:00Z',
      branch: 'main',
      summary: 'Did stuff',
      transcriptTail: 'last line',
    });

    const row = handle.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1');
    assert.ok(row, 'session row should exist');
    assert.strictEqual(row.id, 'sess-1');
    assert.strictEqual(row.started_at, '2026-03-30T10:00:00Z');
    assert.strictEqual(row.ended_at, '2026-03-30T10:30:00Z');
    assert.strictEqual(row.branch, 'main');
    assert.strictEqual(row.summary, 'Did stuff');
    assert.strictEqual(row.transcript_tail, 'last line');
    handle.close();
  })
);

// 4. upsertSession updates existing session without overwriting non-null fields (COALESCE)
results.push(
  test('upsertSession updates existing session with COALESCE (preserves non-null fields)', () => {
    const handle = createPlainTestDb();

    // Insert initial session with all fields populated
    db.upsertSession(handle, {
      id: 'sess-2',
      startedAt: '2026-03-30T09:00:00Z',
      endedAt: '2026-03-30T09:30:00Z',
      branch: 'feature-a',
      summary: 'Original summary',
      transcriptTail: 'Original tail',
    });

    // Upsert again with some null/undefined fields — should preserve originals
    db.upsertSession(handle, {
      id: 'sess-2',
      startedAt: '2026-03-30T09:00:00Z',
      // endedAt omitted (undefined → null via || null)
      // branch omitted
      summary: 'Updated summary',
      // transcriptTail omitted
    });

    const row = handle.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-2');
    assert.ok(row);
    assert.strictEqual(row.ended_at, '2026-03-30T09:30:00Z', 'ended_at should be preserved');
    assert.strictEqual(row.branch, 'feature-a', 'branch should be preserved');
    assert.strictEqual(row.summary, 'Updated summary', 'summary should be updated');
    assert.strictEqual(row.transcript_tail, 'Original tail', 'transcript_tail should be preserved');
    handle.close();
  })
);

results.push(
  test('upsertSession updates an existing session when startedAt is omitted', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-2b',
      startedAt: '2026-03-30T09:45:00Z',
      branch: 'feature-a',
      summary: 'Original summary',
    });

    db.upsertSession(handle, {
      id: 'sess-2b',
      branch: 'feature-b',
      summary: 'Updated summary',
    });

    const row = handle.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-2b');
    assert.ok(row);
    assert.strictEqual(row.started_at, '2026-03-30T09:45:00Z', 'started_at should be preserved when omitted on update');
    assert.strictEqual(row.branch, 'feature-b', 'branch should be updated');
    assert.strictEqual(row.summary, 'Updated summary', 'summary should be updated');
    handle.close();
  })
);

// 5. insertSessionFiles inserts multiple file records in one transaction
results.push(
  test('insertSessionFiles inserts multiple file records in one transaction', () => {
    const handle = createPlainTestDb();

    // Need a parent session first (FK)
    db.upsertSession(handle, {
      id: 'sess-3',
      startedAt: '2026-03-30T11:00:00Z',
    });

    const files = [
      { filePath: 'src/index.ts', action: 'edit' },
      { filePath: 'src/utils.ts', action: 'create' },
      { filePath: 'README.md', action: 'edit' },
    ];

    db.insertSessionFiles(handle, 'sess-3', files);

    const rows = handle
      .prepare('SELECT file_path, action FROM session_files WHERE session_id = ? ORDER BY id')
      .all('sess-3');

    assert.strictEqual(rows.length, 3, 'should have 3 file records');
    assert.strictEqual(rows[0].file_path, 'src/index.ts');
    assert.strictEqual(rows[0].action, 'edit');
    assert.strictEqual(rows[1].file_path, 'src/utils.ts');
    assert.strictEqual(rows[1].action, 'create');
    assert.strictEqual(rows[2].file_path, 'README.md');
    assert.strictEqual(rows[2].action, 'edit');
    handle.close();
  })
);

// 6. insertPendingTask inserts a task with default status 'pending'
results.push(
  test('insertPendingTask inserts a task with default status pending', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-4',
      startedAt: '2026-03-30T12:00:00Z',
    });

    db.insertPendingTask(handle, {
      sessionId: 'sess-4',
      description: 'Fix the bug',
      createdAt: '2026-03-30T12:05:00Z',
      // status omitted — should default to 'pending'
    });

    const row = handle
      .prepare('SELECT * FROM pending_tasks WHERE session_id = ?')
      .get('sess-4');

    assert.ok(row, 'task row should exist');
    assert.strictEqual(row.description, 'Fix the bug');
    assert.strictEqual(row.status, 'pending');
    assert.strictEqual(row.created_at, '2026-03-30T12:05:00Z');
    handle.close();
  })
);

// 7. getRecentSessions returns sessions ordered by started_at DESC, limited, excludes empty summaries
results.push(
  test('getRecentSessions returns ordered, limited sessions with non-empty summaries', () => {
    const handle = createPlainTestDb();

    // Insert sessions: some with summaries, some without
    const sessions = [
      { id: 's1', startedAt: '2026-03-28T10:00:00Z', summary: 'First' },
      { id: 's2', startedAt: '2026-03-29T10:00:00Z' },                       // no summary
      { id: 's3', startedAt: '2026-03-30T10:00:00Z', summary: 'Third' },
      { id: 's4', startedAt: '2026-03-30T11:00:00Z', summary: '' },           // empty summary
      { id: 's5', startedAt: '2026-03-30T12:00:00Z', summary: 'Fifth' },
      { id: 's6', startedAt: '2026-03-30T13:00:00Z', summary: 'Sixth' },
    ];

    for (const s of sessions) {
      db.upsertSession(handle, s);
    }

    const recent = db.getRecentSessions(handle, 2);

    assert.strictEqual(recent.length, 2, 'should return exactly 2');
    assert.strictEqual(recent[0].id, 's6', 'most recent first');
    assert.strictEqual(recent[1].id, 's5', 'second most recent');

    // Verify sessions without summaries are excluded
    const all = db.getRecentSessions(handle, 100);
    const ids = all.map((r) => r.id);
    assert.ok(!ids.includes('s2'), 's2 (null summary) should be excluded');
    assert.ok(!ids.includes('s4'), 's4 (empty summary) should be excluded');
    handle.close();
  })
);

results.push(
  test('upsertPendingTask inserts a new project-scoped active task', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-active-1',
      startedAt: '2026-04-04T09:00:00Z',
      projectId: 'proj-active',
    });

    const rowId = db.upsertPendingTask(handle, {
      sessionId: 'sess-active-1',
      projectId: 'proj-active',
      taskKey: 'task-1',
      description: 'Inspect hook payload',
      status: 'in-progress',
      createdAt: '2026-04-04T09:01:00Z',
      updatedAt: '2026-04-04T09:01:30Z',
    });

    const row = handle.prepare('SELECT * FROM pending_tasks WHERE id = ?').get(rowId);
    assert.ok(row, 'active task row should exist');
    assert.strictEqual(row.project_id, 'proj-active');
    assert.strictEqual(row.task_key, 'task-1');
    assert.strictEqual(row.description, 'Inspect hook payload');
    assert.strictEqual(row.status, 'in-progress');
    assert.strictEqual(row.updated_at, '2026-04-04T09:01:30Z');
    handle.close();
  })
);

results.push(
  test('upsertPendingTask updates an existing task instead of duplicating it', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-active-2',
      startedAt: '2026-04-04T09:10:00Z',
      projectId: 'proj-active',
    });

    const firstId = db.upsertPendingTask(handle, {
      sessionId: 'sess-active-2',
      projectId: 'proj-active',
      taskKey: 'task-2',
      description: 'Read hooks',
      status: 'pending',
      createdAt: '2026-04-04T09:11:00Z',
      updatedAt: '2026-04-04T09:11:00Z',
    });

    const secondId = db.upsertPendingTask(handle, {
      sessionId: 'sess-active-2b',
      projectId: 'proj-active',
      taskKey: 'task-2',
      description: 'Read hook payloads carefully',
      status: 'in-progress',
      createdAt: '2026-04-04T09:12:00Z',
      updatedAt: '2026-04-04T09:12:30Z',
    });

    const rows = handle.prepare('SELECT * FROM pending_tasks WHERE project_id = ? AND task_key = ?').all('proj-active', 'task-2');
    assert.strictEqual(firstId, secondId, 'upsert should return the same row id');
    assert.strictEqual(rows.length, 1, 'should keep a single task row');
    assert.strictEqual(rows[0].session_id, 'sess-active-2b', 'latest session id should be retained');
    assert.strictEqual(rows[0].description, 'Read hook payloads carefully');
    assert.strictEqual(rows[0].status, 'in-progress');
    assert.strictEqual(rows[0].created_at, '2026-04-04T09:11:00Z', 'created_at should preserve the first seen time');
    assert.strictEqual(rows[0].updated_at, '2026-04-04T09:12:30Z');
    handle.close();
  })
);

results.push(
  test('upsertPendingTask can complete a task and active queries exclude it', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-active-3',
      startedAt: '2026-04-04T09:20:00Z',
      projectId: 'proj-active',
    });

    db.upsertPendingTask(handle, {
      sessionId: 'sess-active-3',
      projectId: 'proj-active',
      taskKey: 'task-3',
      description: 'Implement sync',
      status: 'in-progress',
      createdAt: '2026-04-04T09:21:00Z',
      updatedAt: '2026-04-04T09:21:00Z',
    });

    db.upsertPendingTask(handle, {
      sessionId: 'sess-active-3',
      projectId: 'proj-active',
      taskKey: 'task-3',
      description: 'Implement sync',
      status: 'completed',
      createdAt: '2026-04-04T09:22:00Z',
      updatedAt: '2026-04-04T09:22:00Z',
    });

    const activeTasks = db.getPendingTasks(handle, { projectId: 'proj-active' });
    const storedRow = handle.prepare('SELECT status FROM pending_tasks WHERE project_id = ? AND task_key = ?').get('proj-active', 'task-3');
    assert.strictEqual(storedRow.status, 'completed');
    assert.ok(!activeTasks.some((task) => task.description === 'Implement sync'), 'completed task should not be returned as active');
    handle.close();
  })
);

results.push(
  test('upsertPendingTask reuses legacy rows that do not have a project_id yet', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-legacy',
      startedAt: '2026-04-04T09:30:00Z',
      projectId: 'proj-active',
    });

    handle.prepare(`
      INSERT INTO pending_tasks (session_id, project_id, task_key, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-legacy',
      null,
      'legacy-task',
      'Carry legacy task forward',
      'pending',
      '2026-04-04T09:31:00Z',
      '2026-04-04T09:31:00Z'
    );

    const rowId = db.upsertPendingTask(handle, {
      sessionId: 'sess-legacy',
      projectId: 'proj-active',
      taskKey: 'legacy-task',
      description: 'Carry legacy task forward',
      status: 'in-progress',
      createdAt: '2026-04-04T09:32:00Z',
      updatedAt: '2026-04-04T09:33:00Z',
    });

    const rows = handle.prepare('SELECT * FROM pending_tasks WHERE task_key = ?').all('legacy-task');
    assert.strictEqual(rows.length, 1, 'legacy row should be updated in place');
    assert.strictEqual(rows[0].id, rowId);
    assert.strictEqual(rows[0].project_id, 'proj-active');
    assert.strictEqual(rows[0].status, 'in-progress');
    handle.close();
  })
);

results.push(
  test('upsertPendingTask does not reuse ambiguous legacy rows', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-legacy-1',
      startedAt: '2026-04-04T09:39:00Z',
      projectId: 'proj-active',
    });
    db.upsertSession(handle, {
      id: 'sess-legacy-2',
      startedAt: '2026-04-04T09:39:30Z',
      projectId: 'proj-active',
    });
    db.upsertSession(handle, {
      id: 'sess-legacy-ambiguous',
      startedAt: '2026-04-04T09:40:00Z',
      projectId: 'proj-active',
    });

    handle.prepare(`
      INSERT INTO pending_tasks (session_id, project_id, task_key, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('sess-legacy-1', null, 'shared-task', 'Old task A', 'pending', '2026-04-04T09:41:00Z', '2026-04-04T09:41:00Z');
    handle.prepare(`
      INSERT INTO pending_tasks (session_id, project_id, task_key, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('sess-legacy-2', null, 'shared-task', 'Old task B', 'pending', '2026-04-04T09:42:00Z', '2026-04-04T09:42:00Z');

    const rowId = db.upsertPendingTask(handle, {
      sessionId: 'sess-legacy-ambiguous',
      projectId: 'proj-active',
      taskKey: 'shared-task',
      description: 'Current task',
      status: 'in-progress',
      createdAt: '2026-04-04T09:43:00Z',
      updatedAt: '2026-04-04T09:43:00Z',
    });

    const rows = handle.prepare('SELECT id, project_id, description FROM pending_tasks WHERE task_key = ? ORDER BY created_at ASC').all('shared-task');
    assert.strictEqual(rows.length, 3, 'ambiguous legacy rows should be preserved and a new row should be added');
    assert.strictEqual(rows[2].id, rowId);
    assert.strictEqual(rows[2].project_id, 'proj-active');
    assert.strictEqual(rows[2].description, 'Current task');
    handle.close();
  })
);

// 8. getPendingTasks returns only pending tasks, ordered by created_at DESC, limited to 20
results.push(
  test('getPendingTasks returns only pending tasks ordered by created_at DESC, max 20', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, { id: 'sess-t', startedAt: '2026-03-30T08:00:00Z' });

    // Insert 22 pending tasks
    for (let i = 1; i <= 22; i++) {
      db.insertPendingTask(handle, {
        sessionId: 'sess-t',
        description: `Task ${i}`,
        createdAt: `2026-03-30T08:${String(i).padStart(2, '0')}:00Z`,
      });
    }

    // Insert a non-pending (done) task
    db.insertPendingTask(handle, {
      sessionId: 'sess-t',
      description: 'Done task',
      status: 'done',
      createdAt: '2026-03-30T09:00:00Z',
    });

    const tasks = db.getPendingTasks(handle);

    assert.strictEqual(tasks.length, 20, 'should return at most 20 tasks');
    assert.ok(
      tasks.every((t) => t.status === 'pending'),
      'all returned tasks should have status pending'
    );
    // Verify DESC order — first task should have the latest created_at
    assert.strictEqual(tasks[0].description, 'Task 22');
    assert.strictEqual(tasks[tasks.length - 1].description, 'Task 3');

    // Verify the 'done' task is excluded
    assert.ok(
      !tasks.some((t) => t.description === 'Done task'),
      'done task should be excluded'
    );
    handle.close();
  })
);

results.push(
  test('getPendingTasks scopes results to the current project and keeps in-progress tasks', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, { id: 'sess-pa', startedAt: '2026-04-04T10:00:00Z', projectId: 'proj-A' });
    db.upsertSession(handle, { id: 'sess-pb', startedAt: '2026-04-04T10:00:00Z', projectId: 'proj-B' });
    db.upsertSession(handle, { id: 'sess-pb-legacy', startedAt: '2026-04-04T10:00:00Z', projectId: 'proj-B' });

    db.upsertPendingTask(handle, {
      sessionId: 'sess-pa',
      projectId: 'proj-A',
      taskKey: 'a-1',
      description: 'Project A pending',
      status: 'pending',
      createdAt: '2026-04-04T10:01:00Z',
      updatedAt: '2026-04-04T10:01:00Z',
    });
    db.upsertPendingTask(handle, {
      sessionId: 'sess-pa',
      projectId: 'proj-A',
      taskKey: 'a-2',
      description: 'Project A in progress',
      status: 'in-progress',
      createdAt: '2026-04-04T10:02:00Z',
      updatedAt: '2026-04-04T10:03:00Z',
    });
    db.upsertPendingTask(handle, {
      sessionId: 'sess-pb',
      projectId: 'proj-B',
      taskKey: 'b-1',
      description: 'Project B pending',
      status: 'pending',
      createdAt: '2026-04-04T10:04:00Z',
      updatedAt: '2026-04-04T10:04:00Z',
    });
    handle.prepare(`
      INSERT INTO pending_tasks (session_id, project_id, task_key, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('sess-pb-legacy', null, 'legacy-b', 'Legacy Project B task', 'pending', '2026-04-04T10:05:00Z', '2026-04-04T10:05:00Z');

    const scoped = db.getPendingTasks(handle, { projectId: 'proj-A' });
    assert.strictEqual(scoped.length, 2, 'should only return active tasks from proj-A');
    assert.ok(scoped.every((row) => row.project_id === 'proj-A'), 'should exclude other projects');
    assert.ok(scoped.some((row) => row.status === 'in-progress'), 'in-progress tasks should be visible');
    assert.ok(!scoped.some((row) => row.description === 'Project B pending'), 'cross-project tasks should be excluded');
    assert.ok(!scoped.some((row) => row.description === 'Legacy Project B task'), 'legacy null-project rows from other projects should be excluded');
    handle.close();
  })
);

results.push(
  test('countPendingTasks returns the total active task count for the current project', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, { id: 'sess-count-a', startedAt: '2026-04-04T11:00:00Z', projectId: 'proj-A' });
    db.upsertSession(handle, { id: 'sess-count-b', startedAt: '2026-04-04T11:00:00Z', projectId: 'proj-B' });

    for (let index = 1; index <= 22; index += 1) {
      db.upsertPendingTask(handle, {
        sessionId: 'sess-count-a',
        projectId: 'proj-A',
        taskKey: `a-${index}`,
        description: `Project A task ${index}`,
        status: index % 2 === 0 ? 'in-progress' : 'pending',
        createdAt: `2026-04-04T11:${String(index).padStart(2, '0')}:00Z`,
        updatedAt: `2026-04-04T11:${String(index).padStart(2, '0')}:30Z`,
      });
    }

    db.upsertPendingTask(handle, {
      sessionId: 'sess-count-a',
      projectId: 'proj-A',
      taskKey: 'a-complete',
      description: 'Project A done',
      status: 'completed',
      createdAt: '2026-04-04T11:30:00Z',
      updatedAt: '2026-04-04T11:30:30Z',
    });

    db.upsertPendingTask(handle, {
      sessionId: 'sess-count-b',
      projectId: 'proj-B',
      taskKey: 'b-1',
      description: 'Project B pending',
      status: 'pending',
      createdAt: '2026-04-04T11:31:00Z',
      updatedAt: '2026-04-04T11:31:30Z',
    });

    const total = db.countPendingTasks(handle, { projectId: 'proj-A' });
    const displayed = db.getPendingTasks(handle, { projectId: 'proj-A' });

    assert.strictEqual(total, 22, 'total count should include all active project tasks, not only the first page');
    assert.strictEqual(displayed.length, 20, 'display list should still respect the default limit');
    handle.close();
  })
);

results.push(
  test('unknown task statuses are stored but excluded from active task queries and counts', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, { id: 'sess-count-unknown', startedAt: '2026-04-04T11:40:00Z', projectId: 'proj-A' });

    db.upsertPendingTask(handle, {
      sessionId: 'sess-count-unknown',
      projectId: 'proj-A',
      taskKey: 'blocked-1',
      description: 'Blocked task',
      status: 'blocked',
      createdAt: '2026-04-04T11:41:00Z',
      updatedAt: '2026-04-04T11:41:30Z',
    });

    const stored = handle.prepare('SELECT status FROM pending_tasks WHERE task_key = ?').get('blocked-1');
    const total = db.countPendingTasks(handle, { projectId: 'proj-A' });
    const displayed = db.getPendingTasks(handle, { projectId: 'proj-A' });

    assert.strictEqual(stored.status, 'blocked', 'unknown statuses should be preserved for later interpretation');
    assert.strictEqual(total, 0, 'unknown statuses should not inflate active task counts');
    assert.strictEqual(displayed.length, 0, 'unknown statuses should not appear in active task listings');
    handle.close();
  })
);

results.push(
  test('getVerificationCompletionState returns neutral when the session never used a todo tool', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-verify-neutral',
      startedAt: '2026-04-05T09:00:00Z',
      projectId: 'proj-verify',
    });

    const state = db.getVerificationCompletionState(handle, {
      sessionId: 'sess-verify-neutral',
      projectId: 'proj-verify',
    });

    assert.deepStrictEqual(state, {
      status: 'neutral',
      todoToolUsed: false,
      incompleteCount: 0,
      incompleteTasks: [],
      blockReason: null,
    });
    handle.close();
  })
);

results.push(
  test('getVerificationCompletionState ignores failed todo-tool observations', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-verify-failed-observation',
      startedAt: '2026-04-05T09:02:00Z',
      projectId: 'proj-verify',
    });

    handle.prepare(`
      INSERT INTO observations (session_id, project_id, tool_name, tool_input, tool_output, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-verify-failed-observation',
      'proj-verify',
      'manage_todo_list',
      '{}',
      '{}',
      'tool_correction_dry_run',
      '2026-04-05T09:02:30Z'
    );

    const state = db.getVerificationCompletionState(handle, {
      sessionId: 'sess-verify-failed-observation',
      projectId: 'proj-verify',
    });

    assert.deepStrictEqual(state, {
      status: 'neutral',
      todoToolUsed: false,
      incompleteCount: 0,
      incompleteTasks: [],
      blockReason: null,
    });
    handle.close();
  })
);

results.push(
  test('getVerificationCompletionState returns block when the session used todo and still has incomplete tasks', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-verify-block',
      startedAt: '2026-04-05T09:05:00Z',
      projectId: 'proj-verify',
    });

    handle.prepare(`
      INSERT INTO observations (session_id, project_id, tool_name, tool_input, tool_output, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-verify-block',
      'proj-verify',
      'manage_todo_list',
      '{}',
      '{}',
      'tool_complete',
      '2026-04-05T09:05:30Z'
    );

    db.upsertPendingTask(handle, {
      sessionId: 'sess-verify-block',
      projectId: 'proj-verify',
      taskKey: 'verify-block-1',
      description: 'Finish checklist gate',
      status: 'in-progress',
      createdAt: '2026-04-05T09:06:00Z',
      updatedAt: '2026-04-05T09:06:30Z',
    });

    const state = db.getVerificationCompletionState(handle, {
      sessionId: 'sess-verify-block',
      projectId: 'proj-verify',
    });

    assert.strictEqual(state.status, 'blocked');
    assert.strictEqual(state.todoToolUsed, true);
    assert.strictEqual(state.incompleteCount, 1);
    assert.strictEqual(state.blockReason, 'incomplete_tasks');
    assert.deepStrictEqual(state.incompleteTasks.map((task) => task.description), ['Finish checklist gate']);
    handle.close();
  })
);

results.push(
  test('getVerificationCompletionState returns pass when the session used todo and all session tasks are completed', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-verify-pass',
      startedAt: '2026-04-05T09:10:00Z',
      projectId: 'proj-verify',
    });

    handle.prepare(`
      INSERT INTO observations (session_id, project_id, tool_name, tool_input, tool_output, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-verify-pass',
      'proj-verify',
      'todo',
      '{}',
      '{}',
      'tool_complete',
      '2026-04-05T09:10:30Z'
    );

    db.upsertPendingTask(handle, {
      sessionId: 'sess-verify-pass',
      projectId: 'proj-verify',
      taskKey: 'verify-pass-1',
      description: 'Complete checklist gate',
      status: 'completed',
      createdAt: '2026-04-05T09:11:00Z',
      updatedAt: '2026-04-05T09:11:30Z',
    });

    const state = db.getVerificationCompletionState(handle, {
      sessionId: 'sess-verify-pass',
      projectId: 'proj-verify',
    });

    assert.deepStrictEqual(state, {
      status: 'pass',
      todoToolUsed: true,
      incompleteCount: 0,
      incompleteTasks: [],
      blockReason: null,
    });
    handle.close();
  })
);

results.push(
  test('getVerificationCompletionState ignores incomplete tasks from other sessions in the same project', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-verify-current',
      startedAt: '2026-04-05T09:15:00Z',
      projectId: 'proj-verify',
    });
    db.upsertSession(handle, {
      id: 'sess-verify-other',
      startedAt: '2026-04-05T09:16:00Z',
      projectId: 'proj-verify',
    });

    handle.prepare(`
      INSERT INTO observations (session_id, project_id, tool_name, tool_input, tool_output, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-verify-current',
      'proj-verify',
      'manage_todo_list',
      '{}',
      '{}',
      'tool_complete',
      '2026-04-05T09:15:30Z'
    );

    db.upsertPendingTask(handle, {
      sessionId: 'sess-verify-current',
      projectId: 'proj-verify',
      taskKey: 'verify-current-1',
      description: 'Current session task',
      status: 'completed',
      createdAt: '2026-04-05T09:16:30Z',
      updatedAt: '2026-04-05T09:16:45Z',
    });
    db.upsertPendingTask(handle, {
      sessionId: 'sess-verify-other',
      projectId: 'proj-verify',
      taskKey: 'verify-other-1',
      description: 'Other session pending task',
      status: 'pending',
      createdAt: '2026-04-05T09:17:00Z',
      updatedAt: '2026-04-05T09:17:15Z',
    });

    const state = db.getVerificationCompletionState(handle, {
      sessionId: 'sess-verify-current',
      projectId: 'proj-verify',
    });

    assert.deepStrictEqual(state, {
      status: 'pass',
      todoToolUsed: true,
      incompleteCount: 0,
      incompleteTasks: [],
      blockReason: null,
    });

    const projectScoped = db.getPendingTasks(handle, { projectId: 'proj-verify' });
    assert.ok(projectScoped.some((task) => task.description === 'Other session pending task'), 'project-scoped active task retrieval should remain unchanged');
    handle.close();
  })
);

// 9. Schema has correct indexes
results.push(
  test('schema has correct indexes on sqlite_master', () => {
    const handle = createPlainTestDb();

    const indexes = handle
      .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
      .all();

    const indexNames = indexes.map((i) => i.name);

    assert.ok(indexNames.includes('idx_sessions_started'), 'idx_sessions_started should exist');
    assert.ok(indexNames.includes('idx_pending_status'), 'idx_pending_status should exist');
    assert.ok(indexNames.includes('idx_pending_project_status'), 'idx_pending_project_status should exist');
    assert.ok(indexNames.includes('idx_session_files_session'), 'idx_session_files_session should exist');
    assert.ok(indexNames.includes('idx_knowledge_kind'), 'idx_knowledge_kind should exist');
    assert.ok(indexNames.includes('idx_observations_session'), 'idx_observations_session should exist');
    assert.ok(indexNames.includes('idx_knowledge_project'), 'idx_knowledge_project should exist');
    assert.ok(indexNames.includes('idx_observations_project'), 'idx_observations_project should exist');

    // Verify index targets
    const byName = Object.fromEntries(indexes.map((i) => [i.name, i.tbl_name]));
    assert.strictEqual(byName['idx_sessions_started'], 'sessions');
    assert.strictEqual(byName['idx_pending_status'], 'pending_tasks');
    assert.strictEqual(byName['idx_pending_project_status'], 'pending_tasks');
    assert.strictEqual(byName['idx_session_files_session'], 'session_files');
    assert.strictEqual(byName['idx_knowledge_kind'], 'knowledge');
    assert.strictEqual(byName['idx_observations_session'], 'observations');
    assert.strictEqual(byName['idx_knowledge_project'], 'knowledge');
    assert.strictEqual(byName['idx_observations_project'], 'observations');
    handle.close();
  })
);

// ---------------------------------------------------------------------------
// Phase 3: Knowledge + vector tests
// ---------------------------------------------------------------------------
console.log('\nPhase 3: knowledge + vector tests');

// 10. insertKnowledge inserts without embedding
results.push(
  test('insertKnowledge inserts a knowledge entry without embedding', () => {
    const handle = createPlainTestDb();

    const id = db.insertKnowledge(handle, {
      source: 'session',
      kind: 'pattern',
      content: 'Always use parameterized queries',
      createdAt: '2026-03-30T14:00:00Z',
      sessionId: null,
    });

    assert.ok(typeof id === 'number', 'should return numeric id');
    assert.ok(id > 0, 'id should be positive');

    const row = handle.prepare('SELECT * FROM knowledge WHERE id = ?').get(id);
    assert.ok(row, 'knowledge row should exist');
    assert.strictEqual(row.source, 'session');
    assert.strictEqual(row.kind, 'pattern');
    assert.strictEqual(row.content, 'Always use parameterized queries');
    handle.close();
  })
);

// 11. getAllKnowledge returns entries ordered by created_at DESC
results.push(
  test('getAllKnowledge returns entries ordered by created_at DESC with limit', () => {
    const handle = createPlainTestDb();

    db.insertKnowledge(handle, {
      source: 'session', kind: 'pattern',
      content: 'First', createdAt: '2026-03-30T10:00:00Z',
    });
    db.insertKnowledge(handle, {
      source: 'session', kind: 'correction',
      content: 'Second', createdAt: '2026-03-30T11:00:00Z',
    });
    db.insertKnowledge(handle, {
      source: 'repo', kind: 'preference',
      content: 'Third', createdAt: '2026-03-30T12:00:00Z',
    });

    const all = db.getAllKnowledge(handle, 2);
    assert.strictEqual(all.length, 2, 'should return exactly 2');
    assert.strictEqual(all[0].content, 'Third', 'most recent first');
    assert.strictEqual(all[1].content, 'Second');
    handle.close();
  })
);

// 12. searchKnowledgeByKeyword returns matching entries
results.push(
  test('searchKnowledgeByKeyword returns matching entries', () => {
    const handle = createPlainTestDb();

    db.insertKnowledge(handle, {
      source: 'session', kind: 'pattern',
      content: 'Use parameterized queries for SQL', createdAt: '2026-03-30T10:00:00Z',
    });
    db.insertKnowledge(handle, {
      source: 'session', kind: 'pattern',
      content: 'Use immutable data structures', createdAt: '2026-03-30T11:00:00Z',
    });
    db.insertKnowledge(handle, {
      source: 'repo', kind: 'preference',
      content: 'Prefer const over let', createdAt: '2026-03-30T12:00:00Z',
    });

    const results1 = db.searchKnowledgeByKeyword(handle, 'parameterized', 10);
    assert.strictEqual(results1.length, 1);
    assert.ok(results1[0].content.includes('parameterized'));

    const results2 = db.searchKnowledgeByKeyword(handle, 'Use', 10);
    assert.strictEqual(results2.length, 2, 'should match 2 entries');
    handle.close();
  })
);

// 13. vecToBlob and blobToVec roundtrip
results.push(
  test('vecToBlob and blobToVec roundtrip correctly', () => {
    const original = new Float32Array([1.0, 2.5, -3.14, 0.0]);
    const blob = db.vecToBlob(original);
    assert.ok(Buffer.isBuffer(blob), 'vecToBlob should return a Buffer');
    assert.strictEqual(blob.length, 16, 'should be 4 floats × 4 bytes');

    const restored = db.blobToVec(blob);
    assert.ok(restored instanceof Float32Array, 'blobToVec should return Float32Array');
    assert.strictEqual(restored.length, 4);
    for (let i = 0; i < original.length; i++) {
      assert.ok(Math.abs(restored[i] - original[i]) < 1e-6, `element ${i} should match`);
    }
  })
);

// 14. sqlite-vec vector search (if available)
results.push(
  test('insertKnowledge + searchKnowledge with sqlite-vec vector search', () => {
    const { handle, vecLoaded } = createTestDb({ withVec: true });

    if (!vecLoaded) {
      console.log('    (skipped: sqlite-vec not available)');
      handle.close();
      return true; // count as pass — optional test
    }

    // Insert 3 knowledge entries with fake embeddings
    const dim = db.EMBEDDING_DIM;
    const emb1 = new Float32Array(dim).fill(1.0);
    const emb2 = new Float32Array(dim).fill(0.0);
    const emb3 = new Float32Array(dim).fill(0.5);

    db.insertKnowledge(handle, {
      source: 'session', kind: 'pattern',
      content: 'Pattern A', createdAt: '2026-03-30T10:00:00Z',
      embedding: emb1,
    });
    db.insertKnowledge(handle, {
      source: 'session', kind: 'pattern',
      content: 'Pattern B', createdAt: '2026-03-30T11:00:00Z',
      embedding: emb2,
    });
    db.insertKnowledge(handle, {
      source: 'repo', kind: 'preference',
      content: 'Pattern C', createdAt: '2026-03-30T12:00:00Z',
      embedding: emb3,
    });

    // Search with query embedding close to emb1
    const queryVec = new Float32Array(dim).fill(0.99);
    const results = db.searchKnowledge(handle, queryVec, 2);

    assert.strictEqual(results.length, 2, 'should return 2 nearest');
    // emb1 (all 1.0) should be closer to queryVec (all 0.99) than emb2 (all 0.0)
    assert.strictEqual(results[0].content, 'Pattern A', 'nearest should be Pattern A');
    assert.ok(typeof results[0].distance === 'number', 'should have distance');
    handle.close();
  })
);

// 15. EMBEDDING_DIM is exported correctly
results.push(
  test('EMBEDDING_DIM is exported as 384', () => {
    assert.strictEqual(db.EMBEDDING_DIM, 384);
  })
);

// ---------------------------------------------------------------------------
// Phase 4: Observation + project ID tests
// ---------------------------------------------------------------------------
console.log('\nPhase 4: observations + project ID tests');

// 16. insertObservation inserts a record
results.push(
  test('insertObservation inserts an observation record', () => {
    const handle = createPlainTestDb();

    const id = db.insertObservation(handle, {
      sessionId: 'sess-obs-1',
      projectId: 'abc123def456',
      toolName: 'read_file',
      toolInput: '{"path": "/src/index.ts"}',
      toolOutput: 'file contents here',
      eventType: 'tool_complete',
      createdAt: '2026-04-01T10:00:00Z',
    });

    assert.ok(typeof id === 'number', 'should return numeric id');
    assert.ok(id > 0, 'id should be positive');

    const row = handle.prepare('SELECT * FROM observations WHERE id = ?').get(id);
    assert.ok(row, 'observation row should exist');
    assert.strictEqual(row.session_id, 'sess-obs-1');
    assert.strictEqual(row.project_id, 'abc123def456');
    assert.strictEqual(row.tool_name, 'read_file');
    assert.strictEqual(row.event_type, 'tool_complete');
    handle.close();
  })
);

// 17. insertObservation truncates long input/output to 5000 chars
results.push(
  test('insertObservation truncates long tool_input and tool_output to 5000 chars', () => {
    const handle = createPlainTestDb();

    const longStr = 'x'.repeat(6000);
    db.insertObservation(handle, {
      toolName: 'edit_file',
      toolInput: longStr,
      toolOutput: longStr,
      createdAt: '2026-04-01T10:01:00Z',
    });

    const row = handle.prepare('SELECT tool_input, tool_output FROM observations WHERE id = 1').get();
    assert.strictEqual(row.tool_input.length, 5000, 'tool_input should be truncated');
    assert.strictEqual(row.tool_output.length, 5000, 'tool_output should be truncated');
    handle.close();
  })
);

// 18. getSessionObservations returns observations for a session ordered by created_at ASC
results.push(
  test('getSessionObservations returns observations ordered by created_at ASC', () => {
    const handle = createPlainTestDb();

    db.insertObservation(handle, {
      sessionId: 'sess-obs-2',
      toolName: 'read_file',
      createdAt: '2026-04-01T10:02:00Z',
    });
    db.insertObservation(handle, {
      sessionId: 'sess-obs-2',
      toolName: 'edit_file',
      createdAt: '2026-04-01T10:03:00Z',
    });
    db.insertObservation(handle, {
      sessionId: 'sess-obs-other',
      toolName: 'run_terminal',
      createdAt: '2026-04-01T10:04:00Z',
    });

    const obs = db.getSessionObservations(handle, 'sess-obs-2');
    assert.strictEqual(obs.length, 2, 'should return 2 observations for session');
    assert.strictEqual(obs[0].tool_name, 'read_file', 'first by time');
    assert.strictEqual(obs[1].tool_name, 'edit_file', 'second by time');
    handle.close();
  })
);

// 19. countSessionObservations returns correct count
results.push(
  test('countSessionObservations returns correct count', () => {
    const handle = createPlainTestDb();

    db.insertObservation(handle, { sessionId: 'sess-cnt', toolName: 'a', createdAt: '2026-04-01T10:00:00Z' });
    db.insertObservation(handle, { sessionId: 'sess-cnt', toolName: 'b', createdAt: '2026-04-01T10:01:00Z' });
    db.insertObservation(handle, { sessionId: 'sess-cnt', toolName: 'c', createdAt: '2026-04-01T10:02:00Z' });
    db.insertObservation(handle, { sessionId: 'sess-other', toolName: 'd', createdAt: '2026-04-01T10:03:00Z' });

    assert.strictEqual(db.countSessionObservations(handle, 'sess-cnt'), 3);
    assert.strictEqual(db.countSessionObservations(handle, 'sess-other'), 1);
    assert.strictEqual(db.countSessionObservations(handle, 'sess-none'), 0);
    handle.close();
  })
);

// 20. pruneOldObservations deletes old records
results.push(
  test('pruneOldObservations deletes observations older than N days', () => {
    const handle = createPlainTestDb();

    const old = new Date(Date.now() - 40 * 86400000).toISOString();      // 40 days ago
    const recent = new Date(Date.now() - 10 * 86400000).toISOString();   // 10 days ago

    db.insertObservation(handle, { sessionId: 's1', toolName: 'old1', createdAt: old });
    db.insertObservation(handle, { sessionId: 's1', toolName: 'old2', createdAt: old });
    db.insertObservation(handle, { sessionId: 's1', toolName: 'recent1', createdAt: recent });

    const deleted = db.pruneOldObservations(handle, 30);
    assert.strictEqual(deleted, 2, 'should delete 2 old observations');

    const remaining = handle.prepare('SELECT COUNT(*) AS cnt FROM observations').get();
    assert.strictEqual(remaining.cnt, 1, 'should have 1 remaining');
    handle.close();
  })
);

// 21. detectProjectId returns 12-char hex or 'local'
results.push(
  test('detectProjectId returns a string (12-char hex or local)', () => {
    const pid = db.detectProjectId(process.cwd());
    assert.ok(typeof pid === 'string', 'should return a string');
    assert.ok(pid.length > 0, 'should not be empty');

    if (pid !== 'local') {
      assert.strictEqual(pid.length, 12, 'hash should be 12 chars');
      assert.ok(/^[0-9a-f]{12}$/.test(pid), 'should be hex');
    }
  })
);

// 22. insertKnowledge with projectId, label, importance, and confidence
results.push(
  test('insertKnowledge stores projectId, label, importance, and confidence', () => {
    const handle = createPlainTestDb();

    const id = db.insertKnowledge(handle, {
      source: 'auto',
      kind: 'workflow',
      content: 'Common pattern: read_file → edit_file → run_terminal',
      createdAt: '2026-04-01T11:00:00Z',
      projectId: 'abc123def456',
      label: 'err',
      importance: 'high',
      confidence: 0.7,
    });

    const row = handle.prepare('SELECT * FROM knowledge WHERE id = ?').get(id);
    assert.ok(row);
    assert.strictEqual(row.project_id, 'abc123def456');
    assert.strictEqual(row.label, 'err');
    assert.strictEqual(row.importance, 'high');
    assert.strictEqual(row.confidence, 0.7);
    handle.close();
  })
);

// 23. insertKnowledge defaults importance to medium and confidence to 0.5 when omitted
results.push(
  test('insertKnowledge defaults importance to medium and confidence to 0.5 when omitted', () => {
    const handle = createPlainTestDb();

    const id = db.insertKnowledge(handle, {
      source: 'session',
      kind: 'pattern',
      content: 'Some knowledge',
      createdAt: '2026-04-01T12:00:00Z',
    });

    const row = handle.prepare('SELECT importance, confidence FROM knowledge WHERE id = ?').get(id);
    assert.strictEqual(row.importance, 'medium');
    assert.strictEqual(row.confidence, 0.5);
    handle.close();
  })
);

// 24. upsertSession with projectId
results.push(
  test('upsertSession stores projectId', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, {
      id: 'sess-proj',
      startedAt: '2026-04-01T13:00:00Z',
      projectId: 'def456abc789',
    });

    const row = handle.prepare('SELECT project_id FROM sessions WHERE id = ?').get('sess-proj');
    assert.strictEqual(row.project_id, 'def456abc789');
    handle.close();
  })
);

// 25. getAllKnowledge returns project_id, label, importance, and confidence columns
results.push(
  test('getAllKnowledge returns project_id, label, importance, and confidence columns', () => {
    const handle = createPlainTestDb();

    db.insertKnowledge(handle, {
      source: 'auto',
      kind: 'hotspot',
      content: 'src/index.ts edited 5 times',
      createdAt: '2026-04-01T14:00:00Z',
      projectId: 'projX',
      label: 'err',
      importance: 'critical',
      confidence: 0.3,
    });

    const all = db.getAllKnowledge(handle, 1);
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].project_id, 'projX');
    assert.strictEqual(all[0].label, 'err');
    assert.strictEqual(all[0].importance, 'critical');
    assert.strictEqual(all[0].confidence, 0.3);
    handle.close();
  })
);

// ---------------------------------------------------------------------------
// Phase 5: Smart filtering tests
// ---------------------------------------------------------------------------
console.log('\nPhase 5: smart filtering tests');

// Helper: seed knowledge entries for filtering tests
function seedFilteringData(handle) {
  // Project A knowledge — varying confidence
  db.insertKnowledge(handle, { source: 'auto', kind: 'workflow', content: 'Always run tests before push', createdAt: '2026-04-01T10:00:00Z', projectId: 'projAAA', confidence: 0.8 });
  db.insertKnowledge(handle, { source: 'auto', kind: 'hotspot', content: 'src/main.ts is a hotspot', createdAt: '2026-04-01T10:01:00Z', projectId: 'projAAA', confidence: 0.3 });
  db.insertKnowledge(handle, { source: 'auto', kind: 'error_resolution', content: 'Fix ENOENT by checking path', createdAt: '2026-04-01T10:02:00Z', projectId: 'projAAA', confidence: 0.6 });
  db.insertKnowledge(handle, { source: 'auto', kind: 'pattern', content: 'Use async await over callbacks', createdAt: '2026-04-01T10:02:30Z', projectId: 'projAAA', confidence: 0.5 });
  // Project B knowledge
  db.insertKnowledge(handle, { source: 'auto', kind: 'workflow', content: 'Use docker compose for dev', createdAt: '2026-04-01T10:03:00Z', projectId: 'projBBB', confidence: 0.7 });
  // No project knowledge (global)
  db.insertKnowledge(handle, { source: 'session', kind: 'pattern', content: 'Prefer immutable patterns', createdAt: '2026-04-01T10:04:00Z', confidence: 0.9 });
  // Low confidence
  db.insertKnowledge(handle, { source: 'auto', kind: 'hotspot', content: 'README.md edited 3 times', createdAt: '2026-04-01T10:05:00Z', projectId: 'projAAA', confidence: 0.2 });
}

// 26. getProjectKnowledge filters by project and confidence
results.push(
  test('getProjectKnowledge returns project-specific entries above minConfidence', () => {
    const handle = createPlainTestDb();
    seedFilteringData(handle);

    const results26 = db.getProjectKnowledge(handle, { projectId: 'projAAA', minConfidence: 0.4, limit: 10 });
    // Should include projAAA entries above threshold and may include safe global knowledge.
    assert.ok(results26.length >= 3, 'should have at least 3');
    assert.ok(results26.every((r) => r.confidence >= 0.4), 'all above minConfidence');
    assert.ok(results26.every((r) => r.project_id === 'projAAA' || r.project_id === null), 'should stay within the project scope plus safe global knowledge');
    assert.ok(!results26.some((r) => r.project_id === 'projBBB'), 'should exclude unrelated project knowledge');
    handle.close();
  })
);

// 27. getProjectKnowledge falls back to cross-project when sparse
results.push(
  test('getProjectKnowledge falls back to cross-project when fewer than 3 project matches', () => {
    const handle = createPlainTestDb();
    seedFilteringData(handle);

    // projBBB only has 1 entry above 0.4 → fallback to cross-project.
    // Keep the limit small so the project-specific hit would be dropped by a naive global fallback.
    const results27 = db.getProjectKnowledge(handle, { projectId: 'projBBB', minConfidence: 0.4, limit: 2 });
    assert.ok(results27.length >= 2, 'should return cross-project fallback');
    // Should include entries from other projects too
    const projects = new Set(results27.map((r) => r.project_id));
    assert.ok(projects.size > 1 || results27.some((r) => r.project_id !== 'projBBB'),
      'should include entries beyond projBBB');
    assert.ok(results27.some((r) => r.project_id === 'projBBB' && r.content === 'Use docker compose for dev'),
      'fallback should retain the project-specific matches that triggered the query');
    handle.close();
  })
);

results.push(
  test('getProjectKnowledge fallback excludes unresolved issues from other projects', () => {
    const handle = createPlainTestDb();

    db.insertKnowledge(handle, { source: 'auto', kind: 'workflow', content: 'Project B note', createdAt: '2026-04-01T10:00:00Z', projectId: 'projBBB', confidence: 0.8 });
    db.insertKnowledge(handle, { source: 'agent', kind: 'unresolved_issue', content: 'Project C broken auth', createdAt: '2026-04-01T10:01:00Z', projectId: 'projCCC', label: 'err', importance: 'high', confidence: 0.95 });
    db.insertKnowledge(handle, { source: 'agent', kind: 'unresolved_issue', content: 'Legacy global broken cache', createdAt: '2026-04-01T10:01:30Z', label: 'err', importance: 'medium', confidence: 0.92 });
    db.insertKnowledge(handle, { source: 'session', kind: 'pattern', content: 'Safe global pattern', createdAt: '2026-04-01T10:02:00Z', confidence: 0.9 });

    const scoped = db.getProjectKnowledge(handle, { projectId: 'projBBB', minConfidence: 0.4, limit: 10 });
    assert.ok(scoped.some((row) => row.content === 'Project B note'), 'should keep project knowledge');
    assert.ok(scoped.some((row) => row.content === 'Safe global pattern'), 'should keep safe global knowledge');
    assert.ok(!scoped.some((row) => row.content === 'Project C broken auth'), 'should exclude unresolved issues from other projects');
    assert.ok(!scoped.some((row) => row.content === 'Legacy global broken cache'), 'should exclude unresolved issues even when older rows are global');
    handle.close();
  })
);

// 28. searchKnowledgeByKeywords matches multiple keywords with OR
results.push(
  test('searchKnowledgeByKeywords matches any of the provided keywords', () => {
    const handle = createPlainTestDb();
    seedFilteringData(handle);

    const results28 = db.searchKnowledgeByKeywords(handle, ['docker', 'ENOENT'], { limit: 10 });
    assert.strictEqual(results28.length, 2, 'should match 2 entries');
    const contents = results28.map((r) => r.content);
    assert.ok(contents.some((c) => c.includes('docker')), 'should include docker entry');
    assert.ok(contents.some((c) => c.includes('ENOENT')), 'should include ENOENT entry');
    handle.close();
  })
);

// 29. searchKnowledgeByKeywords with projectId scoping
results.push(
  test('searchKnowledgeByKeywords scopes to project when projectId provided', () => {
    const handle = createPlainTestDb();
    seedFilteringData(handle);

    // "tests" matches projAAA entry, "docker" matches projBBB
    const results29 = db.searchKnowledgeByKeywords(handle, ['tests', 'docker'], { projectId: 'projAAA', limit: 10 });
    // Should include projAAA "tests" match and also null project_id matches
    // Should NOT include projBBB "docker" entry
    assert.ok(results29.every((r) => r.project_id === 'projAAA' || r.project_id === null),
      'should only include projAAA or global entries');
    handle.close();
  })
);

// 30. getRecentProjectSessions filters by project
results.push(
  test('getRecentProjectSessions returns project-specific sessions first', () => {
    const handle = createPlainTestDb();

    db.upsertSession(handle, { id: 's-a1', startedAt: '2026-04-01T10:00:00Z', summary: 'Session A1', projectId: 'projAAA' });
    db.upsertSession(handle, { id: 's-b1', startedAt: '2026-04-01T11:00:00Z', summary: 'Session B1', projectId: 'projBBB' });
    db.upsertSession(handle, { id: 's-a2', startedAt: '2026-04-01T12:00:00Z', summary: 'Session A2', projectId: 'projAAA' });

    const results30 = db.getRecentProjectSessions(handle, { projectId: 'projAAA', limit: 3 });
    assert.ok(results30.every((r) => r.project_id === 'projAAA'), 'should only return projAAA sessions');
    assert.strictEqual(results30[0].summary, 'Session A2', 'most recent first');
    handle.close();
  })
);

// 31. searchKnowledgeByKeywords with empty keywords returns empty
results.push(
  test('searchKnowledgeByKeywords returns empty for empty keywords array', () => {
    const handle = createPlainTestDb();
    seedFilteringData(handle);

    const results31 = db.searchKnowledgeByKeywords(handle, [], { limit: 10 });
    assert.strictEqual(results31.length, 0);
    handle.close();
  })
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing\n`);
process.exit(failed > 0 ? 1 : 0);
