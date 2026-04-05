const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-safety-backup-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function scriptPath() {
  return path.join(__dirname, '..', '..', 'scripts', 'hooks', 'safety-backup.js');
}

function runBackup(args, cwd, input = '') {
  return execFileSync('node', [scriptPath(), ...args], {
    cwd,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

console.log('safety-backup.js CLI tests');

const results = [];

results.push(
  test('creates a session-scoped backup and cleanup removes it', () => {
    const testDir = createTestDir();

    try {
      const targetDir = path.join(testDir, 'src');
      const targetFile = path.join(targetDir, 'config.json');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetFile, '{"safe":false}\n');

      const backupOutput = runBackup([
        'backup',
        '--session-id', 'sess-123',
        '--file', targetFile,
        '--reason', 'suspicious config edit',
      ], testDir);
      const backupResult = JSON.parse(backupOutput.trim());

      assert.strictEqual(backupResult.sessionId, 'sess-123');
      assert.ok(backupResult.backupPath.includes('safety-backups'));

      const backupFile = path.join(testDir, backupResult.backupPath);
      const manifestFile = path.join(testDir, '.github', 'sessions', 'safety-backups', 'sess-123.json');
      assert.ok(fs.existsSync(backupFile), 'backup file should be created');
      assert.ok(fs.existsSync(manifestFile), 'manifest file should be created');

      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      assert.strictEqual(manifest.entries.length, 1);
      assert.strictEqual(manifest.entries[0].reason, 'suspicious config edit');

      const cleanupOutput = runBackup(['cleanup', '--session-id', 'sess-123'], testDir);
      const cleanupResult = JSON.parse(cleanupOutput.trim());
      assert.strictEqual(cleanupResult.removedEntries, 1);
      assert.ok(!fs.existsSync(backupFile), 'backup file should be removed after cleanup');
      assert.ok(!fs.existsSync(manifestFile), 'manifest should be removed after cleanup');
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('rejects files outside the workspace root', () => {
    const testDir = createTestDir();
    const outsideFile = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
    fs.writeFileSync(outsideFile, 'outside\n');

    try {
      const result = spawnSync('node', [scriptPath(), 'backup', '--session-id', 'sess-999', '--file', outsideFile], {
        cwd: testDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });

      assert.notStrictEqual(result.status, 0, 'backup should fail for paths outside the workspace');
      assert.ok(result.stderr.includes('outside the workspace'), 'failure should explain the safety boundary');
    } finally {
      fs.rmSync(outsideFile, { force: true });
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('cleanup without explicit session id uses the current session file', () => {
    const testDir = createTestDir();

    try {
      const targetDir = path.join(testDir, 'hooks');
      const targetFile = path.join(targetDir, 'danger.js');
      const sessionsDir = path.join(testDir, '.github', 'sessions');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(targetFile, 'console.log("danger")\n');
      fs.writeFileSync(path.join(sessionsDir, '.current-session-id'), 'sess-from-file');

      runBackup([
        'backup',
        '--session-id', 'sess-from-file',
        '--file', targetFile,
        '--reason', 'hook script risk',
      ], testDir);

      const output = runBackup(['cleanup'], testDir, JSON.stringify({ hookEventName: 'Stop' }));
      const result = JSON.parse(output.trim());
      assert.strictEqual(result.sessionId, 'sess-from-file');
      assert.strictEqual(result.removedEntries, 1);
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('rejects invalid session ids before touching the filesystem', () => {
    const testDir = createTestDir();

    try {
      const targetFile = path.join(testDir, 'settings.json');
      fs.writeFileSync(targetFile, '{}\n');

      const result = spawnSync('node', [scriptPath(), 'backup', '--session-id', '.', '--file', targetFile], {
        cwd: testDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });

      assert.notStrictEqual(result.status, 0, 'backup should fail for invalid session ids');
      assert.ok(result.stderr.includes('Invalid session id'), 'failure should explain the rejected session id');

      const traversalResult = spawnSync('node', [scriptPath(), 'backup', '--session-id', '..\\..\\escape', '--file', targetFile], {
        cwd: testDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });

      assert.notStrictEqual(traversalResult.status, 0, 'backup should also fail for traversal-like session ids');
      assert.ok(traversalResult.stderr.includes('Invalid session id'), 'traversal rejection should explain the session id failure');
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('rejects junctions or symlinks that resolve outside the workspace', () => {
    const testDir = createTestDir();
    const outsideDir = createTestDir();

    try {
      const outsideFile = path.join(outsideDir, 'external.txt');
      const linkDir = path.join(testDir, 'linked-outside');
      fs.writeFileSync(outsideFile, 'outside\n');
      fs.symlinkSync(outsideDir, linkDir, 'junction');

      const result = spawnSync('node', [scriptPath(), 'backup', '--session-id', 'sess-link', '--file', path.join(linkDir, 'external.txt')], {
        cwd: testDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });

      assert.notStrictEqual(result.status, 0, 'backup should fail for symlinked paths outside the workspace');
      assert.ok(result.stderr.includes('outside the workspace'), 'failure should mention the workspace boundary');
    } finally {
      cleanupTestDir(testDir);
      cleanupTestDir(outsideDir);
    }
  })
);

results.push(
  test('rejects directory targets even when they are inside the workspace', () => {
    const testDir = createTestDir();

    try {
      const targetDir = path.join(testDir, 'src');
      fs.mkdirSync(targetDir, { recursive: true });

      const result = spawnSync('node', [scriptPath(), 'backup', '--session-id', 'sess-dir', '--file', targetDir], {
        cwd: testDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });

      assert.notStrictEqual(result.status, 0, 'backup should fail for directories');
      assert.ok(result.stderr.includes('Refusing to back up directories'), 'failure should explain that only files are allowed');
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