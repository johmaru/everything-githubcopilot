const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getDependencyInstallPlan, getDependencyUninstallPlan, installDependencies } = require('../../scripts/installer/project-setup');
const packageJson = require('../../package.json');

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

console.log('project bootstrap tests');

const results = [];
const expectedDependencies = [
  `@huggingface/transformers@${packageJson.dependencies['@huggingface/transformers']}`,
  `ajv@${packageJson.dependencies.ajv}`,
  `better-sqlite3@${packageJson.dependencies['better-sqlite3']}`,
  `sqlite-vec@${packageJson.dependencies['sqlite-vec']}`,
].join(' ');

results.push(test('packageManager field takes precedence over lockfiles', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');

  try {
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
      private: true,
      packageManager: 'yarn@4.9.2',
    }, null, 2));
    fs.writeFileSync(path.join(targetDir, 'package-lock.json'), '{}\n');

    const plan = getDependencyInstallPlan(targetDir);

    assert.strictEqual(plan.packageManager, 'yarn');
    assert.strictEqual(plan.command, `yarn add ${expectedDependencies}`);
    assert.strictEqual(plan.needsPackageJson, false);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('lockfiles determine the package manager when packageManager is absent', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');

  try {
    fs.writeFileSync(path.join(targetDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

    const plan = getDependencyInstallPlan(targetDir);

    assert.strictEqual(plan.packageManager, 'pnpm');
    assert.strictEqual(plan.command, `pnpm add ${expectedDependencies}`);
    assert.strictEqual(plan.needsPackageJson, true);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('pnpm workspace roots use -w when adding dependencies', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');

  try {
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ private: true }, null, 2));
    fs.writeFileSync(path.join(targetDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    fs.writeFileSync(path.join(targetDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');

    const plan = getDependencyInstallPlan(targetDir);

    assert.strictEqual(plan.packageManager, 'pnpm');
    assert.strictEqual(plan.command, `pnpm add -w ${expectedDependencies}`);
    assert.strictEqual(plan.needsPackageJson, false);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('malformed package.json falls back to lockfile detection and reports the parse error', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');

  try {
    fs.writeFileSync(path.join(targetDir, 'package.json'), '{\n  "private": true,,\n}\n');
    fs.writeFileSync(path.join(targetDir, 'yarn.lock'), '# yarn lockfile\n');

    const plan = getDependencyInstallPlan(targetDir);

    assert.strictEqual(plan.packageManager, 'yarn');
    assert.strictEqual(plan.command, `yarn add ${expectedDependencies}`);
    assert.strictEqual(plan.canInstall, false);
    assert.ok(typeof plan.packageJsonParseError === 'string' && plan.packageJsonParseError.length > 0, 'plan should expose the package.json parse error message');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('malformed package.json without hints falls back to npm but remains non-executable', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');

  try {
    fs.writeFileSync(path.join(targetDir, 'package.json'), '{\n  "private": true,,\n}\n');

    const plan = getDependencyInstallPlan(targetDir);

    assert.strictEqual(plan.packageManager, 'npm');
    assert.strictEqual(plan.command, `npm install --no-audit --no-fund ${expectedDependencies}`);
    assert.strictEqual(plan.canInstall, false);
    assert.ok(typeof plan.packageJsonParseError === 'string' && plan.packageJsonParseError.length > 0, 'plan should expose the package.json parse error message');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('installDependencies rejects non-executable plans before running a package manager', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');
  const previousSkipFlag = process.env.EGCOPILOT_SKIP_DEP_INSTALL;

  try {
    delete process.env.EGCOPILOT_SKIP_DEP_INSTALL;
    fs.writeFileSync(path.join(targetDir, 'package.json'), '{\n  "private": true,,\n}\n');

    assert.throws(() => {
      installDependencies(targetDir);
    }, /Unable to parse target package\.json/);
  } finally {
    if (previousSkipFlag === undefined) {
      delete process.env.EGCOPILOT_SKIP_DEP_INSTALL;
    } else {
      process.env.EGCOPILOT_SKIP_DEP_INSTALL = previousSkipFlag;
    }
    cleanupTestDir(targetDir);
  }
}));

results.push(test('npm is the default when no package manager hints exist', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');

  try {
    const plan = getDependencyInstallPlan(targetDir);

    assert.strictEqual(plan.packageManager, 'npm');
    assert.strictEqual(plan.command, `npm install --no-audit --no-fund ${expectedDependencies}`);
    assert.strictEqual(plan.needsPackageJson, true);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('dependency uninstall uses the detected package manager remove command', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');

  try {
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
      private: true,
      packageManager: 'pnpm@9.0.0',
    }, null, 2));
    fs.writeFileSync(path.join(targetDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');

    const plan = getDependencyUninstallPlan(targetDir);

    assert.strictEqual(plan.packageManager, 'pnpm');
    assert.strictEqual(plan.command, `pnpm remove -w ${expectedDependencies}`);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('dependency uninstall falls back to npm remove when no package manager hints exist', () => {
  const targetDir = createTestDir('egc-project-bootstrap-');

  try {
    const plan = getDependencyUninstallPlan(targetDir);

    assert.strictEqual(plan.packageManager, 'npm');
    assert.strictEqual(plan.command, `npm uninstall --no-audit --no-fund ${expectedDependencies}`);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}