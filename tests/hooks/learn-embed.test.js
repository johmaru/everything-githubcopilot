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

function runLearnEmbed(args, cwd) {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'learn-embed.js');
  return execFileSync('node', [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

function openKnowledgeDb(cwd) {
  const Database = require('better-sqlite3');
  const dbPath = path.join(cwd, '.github', 'sessions', 'copilot.db');
  return new Database(dbPath, { readonly: true });
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

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);
if (failed > 0) {
  process.exit(1);
}