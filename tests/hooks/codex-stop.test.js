const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const codexStop = require('../../scripts/hooks/codex-stop');

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-codex-stop-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

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

console.log('codex-stop.js hook tests');

const results = [];

results.push(test('runStopHooks executes the stop helper scripts from the workspace root with sanitized child inputs and returns a Codex-safe result', () => {
  const workspaceRoot = path.join(process.cwd(), 'tmp-codex-stop-root');
  const scriptDir = path.join(workspaceRoot, 'scripts', 'hooks');
  const calls = [];
  const transcriptPath = path.join(workspaceRoot, 'trace.jsonl');

  const result = codexStop.runStopHooks({
    workspaceRoot,
    scriptDir,
    nodeBinary: 'node',
    rawInput: JSON.stringify({ cwd: path.join(workspaceRoot, 'nested'), sessionId: 'sess-123', transcript_path: transcriptPath }),
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '{"ignored":true}\n', stderr: '' };
    },
  });

  assert.deepStrictEqual(calls.map((call) => path.basename(call.args[0])), [
    'session-stop.js',
    'safety-backup.js',
    'post-edit-typecheck.js',
  ]);
  assert.ok(calls.every((call) => call.command === 'node'), 'stop wrapper should invoke each child with the provided node binary');
  assert.ok(calls.every((call) => call.options.cwd === workspaceRoot), 'stop wrapper should run every child from the workspace root');
  assert.deepStrictEqual(JSON.parse(calls[0].options.input), {
    cwd: path.join(workspaceRoot, 'nested'),
    sessionId: 'sess-123',
    transcript_path: transcriptPath,
  });
  assert.deepStrictEqual(calls[1].args.slice(1), ['cleanup', '--session-id', 'sess-123']);
  assert.deepStrictEqual(calls[2].args.slice(1), ['cleanup']);
  assert.deepStrictEqual(JSON.parse(calls[2].options.input), { sessionId: 'sess-123' });
  assert.deepStrictEqual(result, { continue: true });
}));

results.push(test('runStopHooks collapses child failures into a single Codex-safe warning without echoing raw child stdout', () => {
  const workspaceRoot = path.join(process.cwd(), 'tmp-codex-stop-root');
  const scriptDir = path.join(workspaceRoot, 'scripts', 'hooks');

  const result = codexStop.runStopHooks({
    workspaceRoot,
    scriptDir,
    nodeBinary: 'node',
    spawnSyncImpl(_command, args) {
      if (path.basename(args[0]) === 'session-stop.js') {
        return { status: 1, stdout: 'plain-text-output\n', stderr: 'session-stop exploded\n' };
      }

      return { status: 0, stdout: '{"removedEntries":1}\n', stderr: '' };
    },
  });

  assert.strictEqual(result.continue, true);
  assert.ok(result.systemMessage.includes('session-stop.js'), 'warning should identify the failing stop helper');
  assert.ok(!result.systemMessage.includes('plain-text-output'), 'warning should not leak raw child stdout back to Codex');
}));

results.push(test('runStopHooks surfaces stderr warnings even when a child exits successfully', () => {
  const workspaceRoot = path.join(process.cwd(), 'tmp-codex-stop-root');
  const scriptDir = path.join(workspaceRoot, 'scripts', 'hooks');

  const result = codexStop.runStopHooks({
    workspaceRoot,
    scriptDir,
    nodeBinary: 'node',
    spawnSyncImpl(_command, args) {
      if (path.basename(args[0]) === 'session-stop.js') {
        return { status: 0, stdout: '', stderr: 'SQLite write failed\n' };
      }

      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.strictEqual(result.continue, true);
  assert.ok(result.systemMessage.includes('SQLite write failed'), 'successful child stderr should still be surfaced as a Codex warning');
}));

results.push(test('the shipped .codex Stop command executes codex-stop main and emits one JSON payload', () => {
  const testDir = createTestDir();

  try {
    const hooksConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '.codex', 'hooks.json'), 'utf8')
    );
    const stopCommand = hooksConfig.hooks.Stop[0].hooks[0].command;
    const scriptsDir = path.join(testDir, 'scripts', 'hooks');

    fs.mkdirSync(path.join(testDir, '.codex'), { recursive: true });
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# test\n', 'utf8');
    fs.writeFileSync(path.join(testDir, '.codex', 'hooks.json'), JSON.stringify(hooksConfig, null, 2), 'utf8');
    fs.writeFileSync(path.join(scriptsDir, '_shared.js'), [
      'function getContext() {',
      '  const raw = process.stdin.isTTY ? "" : require("fs").readFileSync(0, "utf8");',
      '  return { raw, payload: raw.trim() ? JSON.parse(raw) : {} };',
      '}',
      'function emit(message) {',
      '  process.stdout.write(`${message}\\n`);',
      '}',
      'module.exports = { emit, getContext };',
      '',
    ].join('\n'), 'utf8');
    fs.copyFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'hooks', 'codex-stop.js'),
      path.join(scriptsDir, 'codex-stop.js')
    );
    fs.writeFileSync(path.join(scriptsDir, 'session-stop.js'), 'process.exit(0);\n', 'utf8');
    fs.writeFileSync(path.join(scriptsDir, 'safety-backup.js'), 'process.exit(0);\n', 'utf8');
    fs.writeFileSync(path.join(scriptsDir, 'post-edit-typecheck.js'), 'process.exit(0);\n', 'utf8');

    const stdout = execSync(stopCommand, {
      cwd: testDir,
      encoding: 'utf8',
      input: JSON.stringify({ cwd: testDir }),
      shell: true,
    });

    assert.deepStrictEqual(JSON.parse(stdout.trim()), { continue: true });
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('the shipped .codex Stop command ignores nearer scripts without repo markers and resolves from the project root', () => {
  const testDir = createTestDir();

  try {
    const hooksConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '.codex', 'hooks.json'), 'utf8')
    );
    const stopCommand = hooksConfig.hooks.Stop[0].hooks[0].command;
    const rootScriptsDir = path.join(testDir, 'scripts', 'hooks');
    const rogueScriptsDir = path.join(testDir, 'nested', 'scripts', 'hooks');
    const workingDir = path.join(testDir, 'nested', 'deeper');
    const rootMarker = path.join(testDir, 'root-stop-ran.txt');
    const rogueMarker = path.join(testDir, 'rogue-stop-ran.txt');

    fs.mkdirSync(path.join(testDir, '.codex'), { recursive: true });
    fs.mkdirSync(rootScriptsDir, { recursive: true });
    fs.mkdirSync(rogueScriptsDir, { recursive: true });
    fs.mkdirSync(workingDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# test\n', 'utf8');
    fs.writeFileSync(path.join(testDir, '.codex', 'hooks.json'), JSON.stringify(hooksConfig, null, 2), 'utf8');
    fs.writeFileSync(path.join(rootScriptsDir, '_shared.js'), [
      'function getContext() {',
      '  const raw = process.stdin.isTTY ? "" : require("fs").readFileSync(0, "utf8");',
      '  return { raw, payload: raw.trim() ? JSON.parse(raw) : {} };',
      '}',
      'function emit(message) {',
      '  process.stdout.write(`${message}\\n`);',
      '}',
      'module.exports = { emit, getContext };',
      '',
    ].join('\n'), 'utf8');
    fs.copyFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'hooks', 'codex-stop.js'),
      path.join(rootScriptsDir, 'codex-stop.js')
    );
    fs.writeFileSync(path.join(rootScriptsDir, 'session-stop.js'), `require('fs').writeFileSync(${JSON.stringify(rootMarker)}, 'root');\nprocess.exit(0);\n`, 'utf8');
    fs.writeFileSync(path.join(rootScriptsDir, 'safety-backup.js'), 'process.exit(0);\n', 'utf8');
    fs.writeFileSync(path.join(rootScriptsDir, 'post-edit-typecheck.js'), 'process.exit(0);\n', 'utf8');
    fs.writeFileSync(path.join(rogueScriptsDir, 'codex-stop.js'), `require('fs').writeFileSync(${JSON.stringify(rogueMarker)}, 'rogue');\nmodule.exports = { main() {} };\n`, 'utf8');

    const stdout = execSync(stopCommand, {
      cwd: workingDir,
      encoding: 'utf8',
      input: JSON.stringify({ cwd: workingDir }),
      shell: true,
    });

    assert.deepStrictEqual(JSON.parse(stdout.trim()), { continue: true });
    assert.ok(fs.existsSync(rootMarker), 'root script should run');
    assert.strictEqual(fs.existsSync(rogueMarker), false, 'loader should ignore nearer scripts without repo markers');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('the shipped .codex Stop command stops at the nearest project root even when that root does not ship the hook script', () => {
  const testDir = createTestDir();

  try {
    const hooksConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '.codex', 'hooks.json'), 'utf8')
    );
    const stopCommand = hooksConfig.hooks.Stop[0].hooks[0].command;
    const parentScriptsDir = path.join(testDir, 'scripts', 'hooks');
    const nestedProjectDir = path.join(testDir, 'nested-project');
    const workingDir = path.join(nestedProjectDir, 'deeper');
    const parentMarker = path.join(testDir, 'parent-stop-ran.txt');

    fs.mkdirSync(path.join(testDir, '.codex'), { recursive: true });
    fs.mkdirSync(parentScriptsDir, { recursive: true });
    fs.mkdirSync(path.join(nestedProjectDir, '.codex'), { recursive: true });
    fs.mkdirSync(workingDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# parent\n', 'utf8');
    fs.writeFileSync(path.join(testDir, '.codex', 'hooks.json'), JSON.stringify(hooksConfig, null, 2), 'utf8');
    fs.writeFileSync(path.join(nestedProjectDir, 'AGENTS.md'), '# nested\n', 'utf8');
    fs.writeFileSync(path.join(nestedProjectDir, '.codex', 'hooks.json'), JSON.stringify(hooksConfig, null, 2), 'utf8');
    fs.writeFileSync(path.join(parentScriptsDir, '_shared.js'), [
      'function getContext() {',
      '  const raw = process.stdin.isTTY ? "" : require("fs").readFileSync(0, "utf8");',
      '  return { raw, payload: raw.trim() ? JSON.parse(raw) : {} };',
      '}',
      'function emit(message) {',
      '  process.stdout.write(`${message}\\n`);',
      '}',
      'module.exports = { emit, getContext };',
      '',
    ].join('\n'), 'utf8');
    fs.copyFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'hooks', 'codex-stop.js'),
      path.join(parentScriptsDir, 'codex-stop.js')
    );
    fs.writeFileSync(path.join(parentScriptsDir, 'session-stop.js'), `require('fs').writeFileSync(${JSON.stringify(parentMarker)}, 'parent');\nprocess.exit(0);\n`, 'utf8');
    fs.writeFileSync(path.join(parentScriptsDir, 'safety-backup.js'), 'process.exit(0);\n', 'utf8');
    fs.writeFileSync(path.join(parentScriptsDir, 'post-edit-typecheck.js'), 'process.exit(0);\n', 'utf8');

    const stdout = execSync(stopCommand, {
      cwd: workingDir,
      encoding: 'utf8',
      input: JSON.stringify({ cwd: workingDir }),
      shell: true,
    });

    assert.strictEqual(stdout.trim(), '', 'nearest marker root without the script should stop traversal and stay silent');
    assert.strictEqual(fs.existsSync(parentMarker), false, 'parent project hook should not run when a nearer project root exists');
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