const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { getProjectInstallManifest } = require('../../scripts/installer/manifest');

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

function createTestDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function runProjectSetup(targetDir, env = {}) {
  const cliPath = path.join(__dirname, '..', '..', 'scripts', 'installer', 'project-setup.js');
  return execFileSync('node', [cliPath, targetDir], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      ...env,
      EGCOPILOT_SKIP_DEP_INSTALL: '1',
    },
    timeout: 120000,
  });
}

function runProjectSetupFailure(targetDir, env = {}) {
  const cliPath = path.join(__dirname, '..', '..', 'scripts', 'installer', 'project-setup.js');
  try {
    const args = targetDir ? [cliPath, targetDir] : [cliPath];
    execFileSync('node', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '..', '..'),
      env: {
        ...process.env,
        ...env,
        EGCOPILOT_SKIP_DEP_INSTALL: '1',
      },
      timeout: 120000,
    });
  } catch (error) {
    return error;
  }

  throw new Error('Expected project setup to fail');
}

console.log('project setup tests');

const results = [];

results.push(test('project setup copies the shared manifest payload without overwriting existing workspace settings', () => {
  const targetDir = createTestDir('egc-project-setup-');

  try {
    const repoWorkflowsDir = path.join(__dirname, '..', '..', '.github', 'workflows');
    const existingVsSettings = path.join(targetDir, '.vscode', 'settings.json');
    const existingWorkflow = path.join(targetDir, '.github', 'workflows', 'ci.yml');
    fs.mkdirSync(path.dirname(existingVsSettings), { recursive: true });
    fs.mkdirSync(path.dirname(existingWorkflow), { recursive: true });
    fs.writeFileSync(existingVsSettings, '{\n  "editor.wordWrap": "on"\n}\n');
    fs.writeFileSync(existingWorkflow, 'name: custom-ci\n');

    const output = runProjectSetup(targetDir);

    const manifest = getProjectInstallManifest();
    for (const operation of manifest.copyOperations) {
      if (operation.src === '.vscode/settings.json') {
        continue;
      }

      const targetPath = path.join(targetDir, operation.dst);
      assert.ok(fs.existsSync(targetPath), `expected copied path ${operation.dst}`);
    }

    assert.ok(output.includes('Warning: .vscode/settings.json already exists'), 'setup should warn when preserving workspace settings');
    assert.strictEqual(fs.readFileSync(existingVsSettings, 'utf8'), '{\n  "editor.wordWrap": "on"\n}\n', 'existing .vscode/settings.json should be preserved');
    assert.strictEqual(fs.readFileSync(existingWorkflow, 'utf8'), 'name: custom-ci\n', 'existing workflow files with colliding names should be preserved');
    for (const workflowName of fs.readdirSync(repoWorkflowsDir)) {
      assert.ok(fs.existsSync(path.join(targetDir, '.github', 'workflows', workflowName)), `expected shipped workflow ${workflowName}`);
    }
    assert.ok(fs.existsSync(path.join(targetDir, '.github', 'instructions', 'converted', 'common-performance.instructions.md')), 'nested instructions should be copied');
    assert.ok(fs.existsSync(path.join(targetDir, 'rust', 'semantic-indexer', 'Cargo.toml')), 'rust semantic indexer should be copied');
    assert.ok(!fs.existsSync(path.join(targetDir, 'rust', 'semantic-indexer', 'target')), 'rust build artifacts should not be copied');
    assert.ok(fs.existsSync(path.join(targetDir, 'tests', 'fixtures', 'skill-router', 'eval-cases.json')), 'eval fixtures should be copied');
    assert.ok(fs.existsSync(path.join(targetDir, 'scripts', 'ci', 'validate-github-hooks.js')), 'validator scripts should be copied');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup refuses to target the source repository itself', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const error = runProjectSetupFailure(repoRoot);

  assert.notStrictEqual(error.status, 0, 'setup should fail for source repo target');
  assert.ok((error.stderr || '').includes('target is the same as the source repository'), 'failure should explain the rejected target');
}));

results.push(test('project setup requires an explicit target argument', () => {
  const error = runProjectSetupFailure();

  assert.notStrictEqual(error.status, 0, 'setup should fail without an explicit target');
  assert.ok((error.stderr || '').includes('target argument is required'), 'failure should explain the missing target');
}));

results.push(test('project setup rejects targets inside the source repository', () => {
  const nestedTarget = path.join(__dirname, '..', '..', '.tmp-project-setup-target');

  try {
    fs.mkdirSync(nestedTarget, { recursive: true });

    const error = runProjectSetupFailure(nestedTarget);

    assert.notStrictEqual(error.status, 0, 'setup should fail for nested source-repo targets');
    assert.ok((error.stderr || '').includes('target must be outside the source repository'), 'failure should explain the nested target rejection');
  } finally {
    cleanupTestDir(nestedTarget);
  }
}));

results.push(test('project setup rejects symlink or junction escapes inside the target tree', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const escapedDir = createTestDir('egc-project-setup-escape-');
  const linkedGithubDir = path.join(targetDir, '.github');

  try {
    try {
      fs.symlinkSync(escapedDir, linkedGithubDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    const error = runProjectSetupFailure(targetDir);

    assert.notStrictEqual(error.status, 0, 'setup should fail when a child path escapes the target root');
    assert.ok((error.stderr || '').includes('outside the target root'), 'failure should explain the escaped child path');
    assert.deepStrictEqual(fs.readdirSync(escapedDir), [], 'escaped directories should stay untouched when setup is rejected');
    assert.deepStrictEqual(fs.readdirSync(targetDir), ['.github'], 'setup should not partially populate the target after rejecting an escaped child path');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(escapedDir);
  }
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}