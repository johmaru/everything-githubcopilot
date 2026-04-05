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
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-post-edit-hooks-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runHookScript(scriptName, { cwd, sharedStub }) {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', scriptName);
  const resolvedScriptPath = require.resolve(scriptPath);
  const originalCwd = process.cwd();
  const originalLoad = Module._load;
  const originalExit = process.exit;
  const stdout = [];
  const stderr = [];
  let exitCode = null;

  class ExitSignal extends Error {
    constructor(code) {
      super(`Exited with code ${code}`);
      this.code = code;
    }
  }

  delete require.cache[resolvedScriptPath];

  try {
    process.chdir(cwd);

    Module._load = function patchedLoad(request, parent, isMain) {
      if (parent && parent.filename === resolvedScriptPath && request === './_shared') {
        return sharedStub;
      }

      return originalLoad.call(this, request, parent, isMain);
    };

    process.exit = (code = 0) => {
      exitCode = code;
      throw new ExitSignal(code);
    };

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    process.stdout.write = (chunk) => {
      stdout.push(String(chunk));
      return true;
    };
    process.stderr.write = (chunk) => {
      stderr.push(String(chunk));
      return true;
    };

    try {
      require(resolvedScriptPath);
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
  } catch (error) {
    if (!(error instanceof ExitSignal)) {
      throw error;
    }
  } finally {
    process.exit = originalExit;
    Module._load = originalLoad;
    process.chdir(originalCwd);
    delete require.cache[resolvedScriptPath];
  }

  return {
    exitCode,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  };
}

function createSharedStub({ payload, emitted, runLocalBinImpl }) {
  return {
    emit(message, stream = 'stdout') {
      emitted.push({ message, stream });
    },
    getContext() {
      return { payload };
    },
    getFilePath() {
      const firstEdit = payload.tool_input.edits[0];
      return firstEdit.filePath;
    },
    getFilePaths() {
      return payload.tool_input.edits.map((edit) => edit.filePath);
    },
    fileExists(filePath) {
      return fs.existsSync(filePath);
    },
    readFile(filePath) {
      return fs.readFileSync(filePath, 'utf8');
    },
    runLocalBin(name, args) {
      if (!runLocalBinImpl) {
        return null;
      }
      return runLocalBinImpl(name, args);
    },
    toWorkspacePath(filePath) {
      return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    },
  };
}

console.log('post-edit hook tests');

const results = [];

results.push(test('post-edit-format formats every eligible file from a multi-edit payload', () => {
  const testDir = createTestDir();
  const emitted = [];
  const runCalls = [];

  try {
    const firstFile = path.join(testDir, 'src', 'first.ts');
    const secondFile = path.join(testDir, 'src', 'second.ts');
    fs.mkdirSync(path.dirname(firstFile), { recursive: true });
    fs.writeFileSync(firstFile, 'export const first=1\n');
    fs.writeFileSync(secondFile, 'export const second=2\n');

    runHookScript('post-edit-format.js', {
      cwd: testDir,
      sharedStub: createSharedStub({
        payload: {
          tool_input: {
            edits: [
              { filePath: firstFile },
              { filePath: secondFile },
            ],
          },
        },
        emitted,
        runLocalBinImpl(name, args) {
          runCalls.push({ name, args });
          return { status: 0, stdout: '', stderr: '' };
        },
      }),
    });

    assert.strictEqual(runCalls.length, 1, 'prettier should run once');
    assert.deepStrictEqual(runCalls[0], {
      name: 'prettier',
      args: ['--write', firstFile, secondFile],
    });
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('post-edit-typecheck triggers one targeted TypeScript check when any edited file is TypeScript', () => {
  const testDir = createTestDir();
  const emitted = [];
  const runCalls = [];

  try {
    const firstFile = path.join(testDir, 'src', 'first.js');
    const secondFile = path.join(testDir, 'src', 'second.ts');
    fs.mkdirSync(path.dirname(firstFile), { recursive: true });
    fs.writeFileSync(firstFile, 'export const first = 1;\n');
    fs.writeFileSync(secondFile, 'export const second = 2;\n');

    runHookScript('post-edit-typecheck.js', {
      cwd: testDir,
      sharedStub: createSharedStub({
        payload: {
          tool_input: {
            edits: [
              { filePath: firstFile },
              { filePath: secondFile },
            ],
          },
        },
        emitted,
        runLocalBinImpl(name, args) {
          runCalls.push({ name, args });
          return { status: 0, stdout: '', stderr: '' };
        },
      }),
    });

    assert.strictEqual(runCalls.length, 1, 'tsc should run once when any TS file is present');
    assert.deepStrictEqual(runCalls[0], {
      name: 'tsc',
      args: ['--noEmit', '--pretty', 'false'],
    });
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('post-edit-console-warn reports console.log usage for every changed JS or TS file in a multi-edit payload', () => {
  const testDir = createTestDir();
  const emitted = [];

  try {
    const firstFile = path.join(testDir, 'src', 'first.ts');
    const secondFile = path.join(testDir, 'src', 'second.js');
    fs.mkdirSync(path.dirname(firstFile), { recursive: true });
    fs.writeFileSync(firstFile, 'console.log("first");\n');
    fs.writeFileSync(secondFile, 'console.log("second");\n');

    runHookScript('post-edit-console-warn.js', {
      cwd: testDir,
      sharedStub: createSharedStub({
        payload: {
          tool_input: {
            edits: [
              { filePath: firstFile },
              { filePath: secondFile },
            ],
          },
        },
        emitted,
      }),
    });

    assert.strictEqual(emitted.length, 2, 'console warnings should be emitted for both files');
    assert.ok(emitted.some((entry) => entry.message.includes(firstFile)), 'first file warning should be emitted');
    assert.ok(emitted.some((entry) => entry.message.includes(secondFile)), 'second file warning should be emitted');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('quality-gate checks every file from a multi-edit payload and fails when a later JS file has invalid syntax', () => {
  const testDir = createTestDir();
  const emitted = [];

  try {
    const firstFile = path.join(testDir, 'src', 'first.js');
    const secondFile = path.join(testDir, 'src', 'second.js');
    fs.mkdirSync(path.dirname(firstFile), { recursive: true });
    fs.writeFileSync(firstFile, 'const ok = 1;\n');
    fs.writeFileSync(secondFile, 'function broken( {\n');

    const result = runHookScript('quality-gate.js', {
      cwd: testDir,
      sharedStub: createSharedStub({
        payload: {
          tool_input: {
            edits: [
              { filePath: firstFile },
              { filePath: secondFile },
            ],
          },
        },
        emitted,
      }),
    });

    assert.strictEqual(result.exitCode, 1, 'quality gate should fail when any edited JS file is invalid');
    assert.ok(emitted.some((entry) => entry.message.includes(secondFile)), 'error output should mention the later invalid file');
  } finally {
    cleanupTestDir(testDir);
  }
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}