const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-learn-embed-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runLearnEmbed(args, cwd, env = {}) {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'learn-embed.js');
  return execFileSync('node', [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

function openKnowledgeDb(cwd) {
  const Database = require('better-sqlite3');
  const dbPath = path.join(cwd, '.github', 'sessions', 'copilot.db');
  return new Database(dbPath, { readonly: true });
}

function seedUnembeddedKnowledge(cwd, entries) {
  const dbPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'db.js');
  const resolvedDbPath = require.resolve(dbPath);
  const originalCwd = process.cwd();
  delete require.cache[resolvedDbPath];

  try {
    process.chdir(cwd);
    const db = require(resolvedDbPath);
    const handle = db.open();
    for (const entry of entries) {
      db.insertKnowledge(handle, {
        source: entry.source || 'auto-observation',
        kind: entry.kind || 'workflow',
        content: entry.content,
        createdAt: entry.createdAt || new Date().toISOString(),
        projectId: entry.projectId || db.detectProjectId(cwd),
        confidence: entry.confidence,
      });
    }
    db.close();
  } finally {
    process.chdir(originalCwd);
    delete require.cache[resolvedDbPath];
  }
}

console.log('learn-embed.js CLI tests');

const results = [];

results.push(
  test('stores label and importance metadata from CLI arguments', () => {
    const testDir = createTestDir();

    try {
      const output = runLearnEmbed([
        '--source', 'manual',
        '--kind', 'unresolved_issue',
        '--label', 'err',
        '--importance', 'high',
        '--content', 'Safety check left one unresolved issue',
      ], testDir);

      const parsed = JSON.parse(output.trim());
      assert.ok(parsed.id > 0, 'CLI should return inserted knowledge id');

      const handle = openKnowledgeDb(testDir);
      const row = handle.prepare('SELECT source, kind, label, importance, content FROM knowledge WHERE id = ?').get(parsed.id);
      handle.close();

      assert.ok(row, 'stored knowledge row should exist');
      assert.strictEqual(row.source, 'manual');
      assert.strictEqual(row.kind, 'unresolved_issue');
      assert.strictEqual(row.label, 'err');
      assert.strictEqual(row.importance, 'high');
      assert.strictEqual(row.content, 'Safety check left one unresolved issue');
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('defaults invalid importance input to medium', () => {
    const testDir = createTestDir();

    try {
      const output = runLearnEmbed([
        '--source', 'manual',
        '--label', 'err',
        '--importance', 'urgent',
        '--content', 'Fallback importance value should be normalized',
      ], testDir);

      const parsed = JSON.parse(output.trim());
      const handle = openKnowledgeDb(testDir);
      const row = handle.prepare('SELECT label, importance FROM knowledge WHERE id = ?').get(parsed.id);
      handle.close();

      assert.strictEqual(row.label, 'err');
      assert.strictEqual(row.importance, 'medium');
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('sanitizes secrets and assigns a workspace project id by default', () => {
    const testDir = createTestDir();

    try {
      const output = runLearnEmbed([
        '--source', 'agent',
        '--kind', 'unresolved_issue',
        '--label', 'err',
        '--content', 'token=abcd1234 path=C:\\Users\\hatun\\secret.txt bearer Bearer topsecret',
      ], testDir);

      const parsed = JSON.parse(output.trim());
      const handle = openKnowledgeDb(testDir);
      const row = handle.prepare('SELECT project_id, content FROM knowledge WHERE id = ?').get(parsed.id);
      handle.close();

      assert.ok(row.project_id, 'project id should be set automatically');
      assert.ok(/^[a-f0-9]{12}$/.test(row.project_id), 'project id should be a scoped hash');
      assert.ok(!row.content.includes('abcd1234'), 'secret values should be redacted');
      assert.ok(!row.content.includes('C:\\Users\\hatun'), 'personal paths should be redacted');
      assert.ok(row.content.includes('<redacted>'), 'redaction marker should be present');
      assert.ok(row.content.includes('<redacted-path>'), 'path redaction marker should be present');
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('redacts token formats without named key prefixes', () => {
    const testDir = createTestDir();

    try {
      const output = runLearnEmbed([
        '--source', 'agent',
        '--kind', 'unresolved_issue',
        '--label', 'err',
        '--content', 'ghp_abcdefghijklmnopqrstuvwxyz sk-1234567890ABCDEFGHIJ',
      ], testDir);

      const parsed = JSON.parse(output.trim());
      const handle = openKnowledgeDb(testDir);
      const row = handle.prepare('SELECT content FROM knowledge WHERE id = ?').get(parsed.id);
      handle.close();

      assert.ok(!row.content.includes('ghp_abcdefghijklmnopqrstuvwxyz'), 'GitHub token should be redacted');
      assert.ok(!row.content.includes('sk-1234567890ABCDEFGHIJ'), 'OpenAI-style token should be redacted');
      assert.strictEqual(row.content, '<redacted> <redacted>');
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('backfills only unembedded knowledge entries up to the requested limit', () => {
    const testDir = createTestDir();

    try {
      seedUnembeddedKnowledge(testDir, [
        { content: 'Backfill first project memory', createdAt: '2026-04-01T10:00:00Z' },
        { content: 'Backfill second project memory', createdAt: '2026-04-01T10:01:00Z' },
      ]);

      const output = runLearnEmbed(['--backfill', '--limit', '1'], testDir, {
        EGC_TEST_FAKE_EMBEDDING: '1',
      });
      const parsed = JSON.parse(output.trim());
      assert.strictEqual(parsed.processed, 1);
      assert.strictEqual(parsed.embedded, 1);

      const handle = openKnowledgeDb(testDir);
      const rows = handle.prepare('SELECT content, embedded_at, embedding_model FROM knowledge ORDER BY created_at ASC').all();
      handle.close();

      assert.strictEqual(rows.length, 2);
      assert.ok(rows[0].embedded_at, 'oldest pending row should be embedded first');
      assert.strictEqual(rows[0].embedding_model, 'test/fake-embedding');
      assert.strictEqual(rows[1].embedded_at, null, 'limit should leave the second row pending');
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);
if (failed > 0) {
  process.exit(1);
}
