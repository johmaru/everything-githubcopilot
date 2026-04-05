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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-observe-tool-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runObserveTool({ cwd, payload, dbStub }) {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'observe-tool.js');
  const resolvedScriptPath = require.resolve(scriptPath);
  const originalCwd = process.cwd();
  const originalLoad = Module._load;
  const originalExit = process.exit;
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

  return { exitCode };
}

console.log('observe-tool.js hook tests');

const results = [];

results.push(
  test('syncs active tasks from manage_todo_list payloads', () => {
    const testDir = createTestDir();
    const observations = [];
    const tasks = [];

    try {
      const result = runObserveTool({
        cwd: testDir,
        payload: {
          tool_name: 'manage_todo_list',
          tool_input: {
            todoList: [
              { id: 1, title: 'Inspect hooks', status: 'pending' },
              { id: 2, title: 'Implement parser', status: 'in-progress' },
              { id: 3, title: 'Finalize verification', status: 'completed' },
            ],
          },
          session_id: 'sess-observe-1',
          cwd: testDir,
        },
        dbStub: {
          isAvailable() {
            return true;
          },
          open() {
            return {
              prepare() {
                return { get() { return { 1: 1 }; } };
              },
            };
          },
          detectProjectId() {
            return 'proj-observe';
          },
          upsertSession() {
            throw new Error('existing session should not be recreated in this test');
          },
          insertObservation(_handle, entry) {
            observations.push(entry);
          },
          upsertPendingTask(_handle, entry) {
            tasks.push(entry);
            return tasks.length;
          },
          close() { },
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(observations.length, 1, 'tool observation should still be recorded');
      assert.strictEqual(tasks.length, 3, 'all todo items should be synced');
      assert.deepStrictEqual(tasks.map((task) => task.status), ['pending', 'in-progress', 'completed']);
      assert.deepStrictEqual(tasks.map((task) => task.taskKey), ['1:inspect-hooks', '2:implement-parser', '3:finalize-verification']);
      assert.ok(tasks.every((task) => task.projectId === 'proj-observe'));
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('handles alternate todo payload shapes and normalizes statuses', () => {
    const testDir = createTestDir();
    const tasks = [];

    try {
      const result = runObserveTool({
        cwd: testDir,
        payload: {
          tool_name: 'todo',
          input: JSON.stringify({
            todos: [
              { id: 'alpha', content: 'Write tests', state: 'in_progress' },
              { id: 'beta', text: 'Ship fix', done: true },
            ],
          }),
          sessionId: 'sess-observe-2',
          cwd: testDir,
        },
        dbStub: {
          isAvailable() {
            return true;
          },
          open() {
            return {
              prepare() {
                return { get() { return { 1: 1 }; } };
              },
            };
          },
          detectProjectId() {
            return 'proj-observe';
          },
          insertObservation() { },
          upsertPendingTask(_handle, entry) {
            tasks.push(entry);
            return tasks.length;
          },
          close() { },
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(tasks.length, 2, 'alternate payload items should be parsed');
      assert.deepStrictEqual(tasks.map((task) => task.status), ['in-progress', 'completed']);
      assert.deepStrictEqual(tasks.map((task) => task.description), ['Write tests', 'Ship fix']);
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('does not sync active tasks for unrelated tools', () => {
    const testDir = createTestDir();
    let syncCalls = 0;
    let observationCalls = 0;

    try {
      const result = runObserveTool({
        cwd: testDir,
        payload: {
          tool_name: 'read_file',
          tool_input: { filePath: 'README.md' },
          session_id: 'sess-observe-3',
          cwd: testDir,
        },
        dbStub: {
          isAvailable() {
            return true;
          },
          open() {
            return {
              prepare() {
                return { get() { return { 1: 1 }; } };
              },
            };
          },
          detectProjectId() {
            return 'proj-observe';
          },
          insertObservation() {
            observationCalls += 1;
          },
          upsertPendingTask() {
            syncCalls += 1;
          },
          close() { },
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(observationCalls, 1, 'non-todo tools should still be observed');
      assert.strictEqual(syncCalls, 0, 'non-todo tools must not update active tasks');
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('derives distinct task keys when numeric ids are reused for different titles', () => {
    const testDir = createTestDir();
    const tasks = [];

    try {
      const result = runObserveTool({
        cwd: testDir,
        payload: {
          tool_name: 'manage_todo_list',
          tool_input: {
            todoList: [
              { id: 1, title: 'Inspect hooks', status: 'pending' },
              { id: 1, title: 'Write tests', status: 'pending' },
            ],
          },
          session_id: 'sess-observe-4',
          cwd: testDir,
        },
        dbStub: {
          isAvailable() {
            return true;
          },
          open() {
            return {
              prepare() {
                return { get() { return { 1: 1 }; } };
              },
            };
          },
          detectProjectId() {
            return 'proj-observe';
          },
          insertObservation() { },
          upsertPendingTask(_handle, entry) {
            tasks.push(entry);
            return tasks.length;
          },
          close() { },
        },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(tasks.length, 2);
      assert.notStrictEqual(tasks[0].taskKey, tasks[1].taskKey, 'task keys should diverge when a numeric id is reused for a different title');
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