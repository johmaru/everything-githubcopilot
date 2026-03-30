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
    assert.ok(indexNames.includes('idx_session_files_session'), 'idx_session_files_session should exist');
    assert.ok(indexNames.includes('idx_knowledge_kind'), 'idx_knowledge_kind should exist');

    // Verify index targets
    const byName = Object.fromEntries(indexes.map((i) => [i.name, i.tbl_name]));
    assert.strictEqual(byName['idx_sessions_started'], 'sessions');
    assert.strictEqual(byName['idx_pending_status'], 'pending_tasks');
    assert.strictEqual(byName['idx_session_files_session'], 'session_files');
    assert.strictEqual(byName['idx_knowledge_kind'], 'knowledge');
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
// Summary
// ---------------------------------------------------------------------------
const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing\n`);
process.exit(failed > 0 ? 1 : 0);
