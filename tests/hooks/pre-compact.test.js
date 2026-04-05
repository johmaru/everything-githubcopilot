const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-pre-compact-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runPreCompact({ cwd, payload, dbStub, spawnSyncImpl }) {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-compact.js');
  const resolvedScriptPath = require.resolve(scriptPath);
  const originalCwd = process.cwd();
  const originalLoad = Module._load;
  const originalExit = process.exit;
  const emitted = [];
  let exitCode = null;

  class ExitSignal extends Error {
    constructor(code) {
      super(`Exited with code ${code}`);
      this.code = code;
    }
  }

  const sharedStub = {
    getContext() {
      return { payload };
    },
    emit(message) {
      emitted.push(message);
    },
  };

  delete require.cache[resolvedScriptPath];

  try {
    process.chdir(cwd);

    Module._load = function patchedLoad(request, parent, isMain) {
      if (parent && parent.filename === resolvedScriptPath) {
        if (request === './_shared') {
          return sharedStub;
        }

        if (request === './db') {
          return dbStub;
        }

        if (request === 'child_process') {
          return { spawnSync: spawnSyncImpl };
        }
      }

      return originalLoad.call(this, request, parent, isMain);
    };

    process.exit = (code = 0) => {
      exitCode = code;
      throw new ExitSignal(code);
    };

    require(resolvedScriptPath);
  } catch (err) {
    if (!(err instanceof ExitSignal)) {
      throw err;
    }
  } finally {
    process.exit = originalExit;
    Module._load = originalLoad;
    process.chdir(originalCwd);
    delete require.cache[resolvedScriptPath];
  }

  return { emitted, exitCode };
}

function readSnapshot(testDir) {
  return fs.readFileSync(path.join(testDir, '.github', 'sessions', 'compact-snapshot.md'), 'utf8');
}

console.log('pre-compact.js hook tests');

const results = [];

results.push(
  test('writes compact snapshot and persists branch plus modified files', () => {
    const testDir = createTestDir();
    const upsertedSessions = [];
    const insertedFileBatches = [];

    try {
      const result = runPreCompact({
        cwd: testDir,
        payload: {
          sessionId: 'sess-precompact-1',
          timestamp: '2026-04-04T10:00:00.000Z',
          cwd: testDir,
        },
        dbStub: {
          open() {
            return {};
          },
          upsertSession(_handle, session) {
            upsertedSessions.push(session);
          },
          insertSessionFiles(_handle, sessionId, fileRecords) {
            insertedFileBatches.push({ sessionId, fileRecords });
          },
          close() { },
        },
        spawnSyncImpl(command, args) {
          if (command !== 'git') {
            throw new Error(`unexpected command: ${command}`);
          }

          if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') {
            return { status: 0, stdout: 'feat/phase2\n' };
          }

          if (args.join(' ') === 'diff --name-only HEAD') {
            return { status: 0, stdout: 'scripts/hooks/session-start.js\nPRODUCT.md\n' };
          }

          throw new Error(`unexpected git args: ${args.join(' ')}`);
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.deepStrictEqual(upsertedSessions, [{ id: 'sess-precompact-1', branch: 'feat/phase2' }]);
      assert.strictEqual(insertedFileBatches.length, 1);
      assert.strictEqual(insertedFileBatches[0].sessionId, 'sess-precompact-1');
      assert.deepStrictEqual(insertedFileBatches[0].fileRecords, [
        { filePath: 'scripts/hooks/session-start.js', action: 'modified' },
        { filePath: 'PRODUCT.md', action: 'modified' },
      ]);

      const snapshot = readSnapshot(testDir);
      assert.ok(snapshot.includes('# Pre-Compact Snapshot'));
      assert.ok(snapshot.includes('**Timestamp**: 2026-04-04T10:00:00.000Z'));
      assert.ok(snapshot.includes('**Session ID**: sess-precompact-1'));
      assert.ok(snapshot.includes('**Branch**: feat/phase2'));
      assert.ok(snapshot.includes('**Modified File Count**: 2'));
      assert.ok(snapshot.includes('**Displayed File Count**: 2'));
      assert.ok(snapshot.includes('**Modified Files Truncated**: no'));
      assert.ok(snapshot.includes('## Modified Files'));
      assert.ok(snapshot.includes('- scripts/hooks/session-start.js'));
      assert.ok(snapshot.includes('- PRODUCT.md'));
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('limits modified files to the first 10 entries', () => {
    const testDir = createTestDir();
    const insertedFileBatches = [];
    const modifiedFiles = Array.from({ length: 12 }, (_, index) => `file-${index + 1}.js`).join('\n');

    try {
      const result = runPreCompact({
        cwd: testDir,
        payload: {
          sessionId: 'sess-precompact-limit',
          timestamp: '2026-04-04T10:05:00.000Z',
          cwd: testDir,
        },
        dbStub: {
          open() {
            return {};
          },
          upsertSession() { },
          insertSessionFiles(_handle, _sessionId, fileRecords) {
            insertedFileBatches.push(fileRecords);
          },
          close() { },
        },
        spawnSyncImpl(command, args) {
          if (command !== 'git') {
            throw new Error(`unexpected command: ${command}`);
          }

          if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') {
            return { status: 0, stdout: 'feat/limit\n' };
          }

          if (args.join(' ') === 'diff --name-only HEAD') {
            return { status: 0, stdout: `${modifiedFiles}\n` };
          }

          throw new Error(`unexpected git args: ${args.join(' ')}`);
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(insertedFileBatches.length, 1);
      assert.strictEqual(insertedFileBatches[0].length, 10);
      assert.deepStrictEqual(
        insertedFileBatches[0].map((entry) => entry.filePath),
        Array.from({ length: 10 }, (_, index) => `file-${index + 1}.js`)
      );

      const snapshot = readSnapshot(testDir);
      assert.ok(snapshot.includes('**Modified File Count**: 12'));
      assert.ok(snapshot.includes('**Displayed File Count**: 10'));
      assert.ok(snapshot.includes('**Modified Files Truncated**: yes'));
      assert.ok(snapshot.includes('- file-10.js'));
      assert.ok(!snapshot.includes('- file-11.js'));
      assert.ok(!snapshot.includes('- file-12.js'));
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('still writes a minimal snapshot when git metadata is unavailable', () => {
    const testDir = createTestDir();

    try {
      const result = runPreCompact({
        cwd: testDir,
        payload: {
          sessionId: 'sess-precompact-nogit',
          timestamp: '2026-04-04T10:10:00.000Z',
          cwd: testDir,
        },
        dbStub: {
          open() {
            return null;
          },
        },
        spawnSyncImpl() {
          throw new Error('git unavailable');
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.deepStrictEqual(result.emitted, []);

      const snapshot = readSnapshot(testDir);
      assert.ok(snapshot.includes('# Pre-Compact Snapshot'));
      assert.ok(snapshot.includes('**Session ID**: sess-precompact-nogit'));
      assert.ok(snapshot.includes('**CWD**: '));
      assert.ok(!snapshot.includes('## Modified Files'));
      assert.ok(!snapshot.includes('**Branch**:'));
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('skips SQLite persistence when sessionId is unknown', () => {
    const testDir = createTestDir();
    let upsertCalls = 0;
    let fileInsertCalls = 0;

    try {
      const result = runPreCompact({
        cwd: testDir,
        payload: {
          timestamp: '2026-04-04T10:15:00.000Z',
          cwd: testDir,
        },
        dbStub: {
          open() {
            return {};
          },
          upsertSession() {
            upsertCalls += 1;
          },
          insertSessionFiles() {
            fileInsertCalls += 1;
          },
          close() { },
        },
        spawnSyncImpl(command, args) {
          if (command !== 'git') {
            throw new Error(`unexpected command: ${command}`);
          }

          if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') {
            return { status: 0, stdout: 'feat/unknown\n' };
          }

          if (args.join(' ') === 'diff --name-only HEAD') {
            return { status: 0, stdout: 'scripts/hooks/pre-compact.js\n' };
          }

          throw new Error(`unexpected git args: ${args.join(' ')}`);
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(upsertCalls, 0, 'unknown sessions should not be persisted to SQLite');
      assert.strictEqual(fileInsertCalls, 0, 'unknown sessions should not write session_files rows');

      const snapshot = readSnapshot(testDir);
      assert.ok(snapshot.includes('**Session ID**: unknown'));
      assert.ok(snapshot.includes('- scripts/hooks/pre-compact.js'));
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