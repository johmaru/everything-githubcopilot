const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { getProjectInstallManifest } = require('../../scripts/installer/manifest');
const projectSetup = require('../../scripts/installer/project-setup');

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
      EGCOPILOT_SKIP_DEP_INSTALL: env.EGCOPILOT_SKIP_DEP_INSTALL || '1',
    },
    timeout: 120000,
  });
}

function runProjectInstaller(command, targetDir, env = {}) {
  const cliPath = path.join(__dirname, '..', '..', 'scripts', 'installer', 'project-setup.js');
  return execFileSync('node', [cliPath, command, targetDir], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      ...env,
      EGCOPILOT_SKIP_DEP_INSTALL: env.EGCOPILOT_SKIP_DEP_INSTALL || '1',
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
        EGCOPILOT_SKIP_DEP_INSTALL: env.EGCOPILOT_SKIP_DEP_INSTALL || '1',
      },
      timeout: 120000,
    });
  } catch (error) {
    return error;
  }

  throw new Error('Expected project setup to fail');
}

function runProjectInstallerFailure(command, targetDir, env = {}) {
  const cliPath = path.join(__dirname, '..', '..', 'scripts', 'installer', 'project-setup.js');
  try {
    execFileSync('node', [cliPath, command, targetDir], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '..', '..'),
      env: {
        ...process.env,
        ...env,
        EGCOPILOT_SKIP_DEP_INSTALL: env.EGCOPILOT_SKIP_DEP_INSTALL || '1',
      },
      timeout: 120000,
    });
  } catch (error) {
    return error;
  }

  throw new Error('Expected project installer command to fail');
}

function createPackageManagerStub(prefix, handlerSource) {
  const stubDir = createTestDir(prefix);
  const commandName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const handlerPath = path.join(stubDir, 'npm-stub.js');
  const commandPath = path.join(stubDir, commandName);

  fs.writeFileSync(handlerPath, handlerSource, 'utf8');

  if (process.platform === 'win32') {
    fs.writeFileSync(commandPath, `@echo off\r\nnode "%~dp0\\npm-stub.js" %*\r\nexit /b %ERRORLEVEL%\r\n`, 'utf8');
  } else {
    fs.writeFileSync(commandPath, '#!/usr/bin/env sh\nnode "$(dirname "$0")/npm-stub.js" "$@"\n', 'utf8');
    fs.chmodSync(commandPath, 0o755);
  }

  return {
    stubDir,
    env: {
      PATH: `${stubDir}${path.delimiter}${process.env.PATH || ''}`,
      EGCOPILOT_SKIP_DEP_INSTALL: '0',
    },
  };
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
    assert.ok(fs.existsSync(path.join(targetDir, '.codex', 'config.toml')), 'codex config should be copied');
    assert.ok(fs.existsSync(path.join(targetDir, '.codex', 'AGENTS.md')), 'codex AGENTS.md should be copied');
    assert.ok(fs.existsSync(path.join(targetDir, '.codex', 'agents', 'explorer.toml')), 'codex agent roles should be copied');
    assert.ok(fs.existsSync(path.join(targetDir, 'tests', 'fixtures', 'skill-router', 'eval-cases.json')), 'eval fixtures should be copied');
    assert.ok(fs.existsSync(path.join(targetDir, 'scripts', 'ci', 'validate-github-hooks.js')), 'validator scripts should be copied');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project uninstall rejects tampered installer state that references sibling .agents content outside the managed bridge', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');

  try {
    fs.writeFileSync(stateFile, JSON.stringify({
      copiedFiles: ['.agents/custom-skill/SKILL.md'],
      backupFiles: [],
      dependencyState: null,
    }, null, 2));

    const error = runProjectInstallerFailure('uninstall', targetDir);

    assert.notStrictEqual(error.status, 0, 'tampered sibling .agents content should fail closed');
    assert.ok((error.stderr || '').includes('invalid or references unmanaged paths'), 'failure should explain the invalid installer state');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup falls back to a copied .agents/skills bridge when junction creation fails', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const originalSymlinkSync = fs.symlinkSync;
  const originalSkipDepInstall = process.env.EGCOPILOT_SKIP_DEP_INSTALL;

  try {
    process.env.EGCOPILOT_SKIP_DEP_INSTALL = '1';
    fs.symlinkSync = () => {
      throw new Error('simulated junction failure');
    };

    projectSetup.installProject(targetDir);

    const bridgeDir = path.join(targetDir, '.agents', 'skills');
    const sampleSkill = path.join(bridgeDir, 'verification-loop', 'SKILL.md');

    assert.ok(fs.existsSync(bridgeDir), 'fallback bridge should exist even when junction creation fails');
    assert.ok(fs.statSync(bridgeDir).isDirectory(), 'fallback bridge should be a real directory');
    assert.strictEqual(fs.lstatSync(bridgeDir).isSymbolicLink(), false, 'fallback bridge should not remain a broken symlink');
    assert.ok(fs.existsSync(sampleSkill), 'fallback bridge should contain copied skills');

    projectSetup.uninstallProject(targetDir);

    assert.strictEqual(fs.existsSync(bridgeDir), false, 'uninstall should remove the fallback bridge');
  } finally {
    fs.symlinkSync = originalSymlinkSync;
    if (originalSkipDepInstall === undefined) {
      delete process.env.EGCOPILOT_SKIP_DEP_INSTALL;
    } else {
      process.env.EGCOPILOT_SKIP_DEP_INSTALL = originalSkipDepInstall;
    }
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project uninstall preserves preexisting empty .agents/skills directories after removing a copied fallback bridge', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const originalSymlinkSync = fs.symlinkSync;
  const originalSkipDepInstall = process.env.EGCOPILOT_SKIP_DEP_INSTALL;
  const agentsDir = path.join(targetDir, '.agents');
  const bridgeDir = path.join(agentsDir, 'skills');

  try {
    process.env.EGCOPILOT_SKIP_DEP_INSTALL = '1';
    fs.mkdirSync(bridgeDir, { recursive: true });
    fs.symlinkSync = () => {
      throw new Error('simulated junction failure');
    };

    projectSetup.installProject(targetDir);
    projectSetup.uninstallProject(targetDir);

    assert.ok(fs.existsSync(agentsDir), 'uninstall should preserve the preexisting .agents directory');
    assert.ok(fs.existsSync(bridgeDir), 'uninstall should preserve the preexisting empty .agents/skills directory');
    assert.strictEqual(fs.readdirSync(bridgeDir).length, 0, 'preserved .agents/skills directory should be restored empty');
  } finally {
    fs.symlinkSync = originalSymlinkSync;
    if (originalSkipDepInstall === undefined) {
      delete process.env.EGCOPILOT_SKIP_DEP_INSTALL;
    } else {
      process.env.EGCOPILOT_SKIP_DEP_INSTALL = originalSkipDepInstall;
    }
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

results.push(test('project setup rejects managed paths redirected to sibling locations inside the target tree', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const redirectedGithubDir = path.join(targetDir, '.shadow-github');
  const linkedGithubDir = path.join(targetDir, '.github');

  try {
    fs.mkdirSync(redirectedGithubDir, { recursive: true });

    try {
      fs.symlinkSync(redirectedGithubDir, linkedGithubDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    const error = runProjectSetupFailure(targetDir);

    assert.notStrictEqual(error.status, 0, 'setup should fail when a managed path is redirected to a sibling location');
    assert.ok((error.stderr || '').includes('redirected managed path'), 'failure should explain the redirected managed path rejection');
    assert.deepStrictEqual(fs.readdirSync(redirectedGithubDir), [], 'redirected managed directories should stay untouched when setup is rejected');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup rejects in-root redirected dependency manifests before install', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const redirectedManifestDir = path.join(targetDir, '.redirected-manifest');
  const linkedPackageJson = path.join(targetDir, 'package.json');
  const redirectedPackageJson = path.join(redirectedManifestDir, 'package.json');
  const originalReadlinkSync = fs.readlinkSync;
  const originalSkipDepInstall = process.env.EGCOPILOT_SKIP_DEP_INSTALL;

  try {
    process.env.EGCOPILOT_SKIP_DEP_INSTALL = '1';
    fs.mkdirSync(redirectedManifestDir, { recursive: true });
    fs.writeFileSync(redirectedPackageJson, '{"name":"redirected"}\n');

    try {
      fs.symlinkSync(redirectedPackageJson, linkedPackageJson, 'file');
    } catch {
      fs.writeFileSync(linkedPackageJson, '{"name":"redirected"}\n');
      fs.readlinkSync = (targetPath, ...args) => {
        if (targetPath === linkedPackageJson) {
          return redirectedPackageJson;
        }

        return originalReadlinkSync.call(fs, targetPath, ...args);
      };
    }

    assert.throws(
      () => projectSetup.installProject(targetDir),
      /redirected managed path/,
      'setup should fail when package.json redirects to a sibling location inside target root'
    );
  } finally {
    fs.readlinkSync = originalReadlinkSync;
    if (originalSkipDepInstall === undefined) {
      delete process.env.EGCOPILOT_SKIP_DEP_INSTALL;
    } else {
      process.env.EGCOPILOT_SKIP_DEP_INSTALL = originalSkipDepInstall;
    }
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup rejects broken dependency manifest links before creating a new package.json', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const missingManifestDir = path.join(targetDir, '.missing-manifest');
  const linkedPackageJson = path.join(targetDir, 'package.json');
  const missingPackageJson = path.join(missingManifestDir, 'package.json');
  const originalReadlinkSync = fs.readlinkSync;
  const originalSkipDepInstall = process.env.EGCOPILOT_SKIP_DEP_INSTALL;

  try {
    process.env.EGCOPILOT_SKIP_DEP_INSTALL = '1';

    try {
      fs.symlinkSync(missingPackageJson, linkedPackageJson, 'file');
    } catch {
      fs.readlinkSync = (targetPath, ...args) => {
        if (targetPath === linkedPackageJson) {
          return missingPackageJson;
        }

        return originalReadlinkSync.call(fs, targetPath, ...args);
      };
    }

    assert.throws(
      () => projectSetup.installProject(targetDir),
      /redirected managed path/,
      'setup should reject a broken package.json link instead of treating it as a missing manifest'
    );
  } finally {
    fs.readlinkSync = originalReadlinkSync;
    if (originalSkipDepInstall === undefined) {
      delete process.env.EGCOPILOT_SKIP_DEP_INSTALL;
    } else {
      process.env.EGCOPILOT_SKIP_DEP_INSTALL = originalSkipDepInstall;
    }
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup rejects .agents junction escapes inside the target tree', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const escapedDir = createTestDir('egc-project-setup-escape-');
  const linkedAgentsDir = path.join(targetDir, '.agents');

  try {
    try {
      fs.symlinkSync(escapedDir, linkedAgentsDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    const error = runProjectSetupFailure(targetDir);

    assert.notStrictEqual(error.status, 0, 'setup should fail when .agents escapes the target root');
    assert.ok((error.stderr || '').includes('outside the target root'), 'failure should explain the escaped .agents path');
    assert.deepStrictEqual(fs.readdirSync(escapedDir), [], 'escaped .agents directories should stay untouched when setup is rejected');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(escapedDir);
  }
}));

results.push(test('project uninstall restores overwritten files and removes files created by the installer', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const customCopilotInstructions = path.join(targetDir, '.github', 'copilot-instructions.md');
  const customAgents = path.join(targetDir, 'AGENTS.md');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');

  try {
    fs.mkdirSync(path.dirname(customCopilotInstructions), { recursive: true });
    fs.writeFileSync(customCopilotInstructions, '# custom instructions\n');
    fs.writeFileSync(customAgents, '# custom agents\n');

    const installOutput = runProjectSetup(targetDir);

    assert.ok(installOutput.includes('Project setup complete'), 'install should complete successfully');
    assert.ok(fs.existsSync(stateFile), 'install should persist a project installer state file');
    assert.notStrictEqual(fs.readFileSync(customCopilotInstructions, 'utf8'), '# custom instructions\n', 'install should replace copied files with shipped content');
    assert.notStrictEqual(fs.readFileSync(customAgents, 'utf8'), '# custom agents\n', 'install should replace copied files with shipped content');
    assert.ok(fs.existsSync(path.join(targetDir, '.github', 'instructions', 'common-agents.instructions.md')), 'install should create managed files under .github');

    const uninstallOutput = runProjectInstaller('uninstall', targetDir);

    assert.ok(uninstallOutput.includes('Project uninstall complete'), 'uninstall should complete successfully');
    assert.strictEqual(fs.existsSync(stateFile), false, 'uninstall should remove the installer state file');
    assert.strictEqual(fs.readFileSync(customCopilotInstructions, 'utf8'), '# custom instructions\n', 'uninstall should restore overwritten files');
    assert.strictEqual(fs.readFileSync(customAgents, 'utf8'), '# custom agents\n', 'uninstall should restore overwritten files');
    assert.strictEqual(fs.existsSync(path.join(targetDir, '.github', 'instructions', 'common-agents.instructions.md')), false, 'uninstall should remove files created by the installer');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup rejects live .agents/skills links that point away from .github/skills', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const originalSkipDepInstall = process.env.EGCOPILOT_SKIP_DEP_INSTALL;
  const agentsDir = path.join(targetDir, '.agents');
  const skillsDir = path.join(targetDir, '.github', 'skills');
  const wrongSkillsDir = path.join(targetDir, 'custom-skills');
  const bridgeDir = path.join(agentsDir, 'skills');

  try {
    process.env.EGCOPILOT_SKIP_DEP_INSTALL = '1';
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(wrongSkillsDir, { recursive: true });
    fs.writeFileSync(path.join(wrongSkillsDir, 'SKILL.md'), '# wrong\n');

    try {
      fs.symlinkSync(wrongSkillsDir, bridgeDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    assert.throws(
      () => projectSetup.installProject(targetDir),
      /unexpected target|Remove it and rerun project setup/,
      'setup should fail closed when an existing live bridge points to the wrong target'
    );
  } finally {
    if (originalSkipDepInstall === undefined) {
      delete process.env.EGCOPILOT_SKIP_DEP_INSTALL;
    } else {
      process.env.EGCOPILOT_SKIP_DEP_INSTALL = originalSkipDepInstall;
    }
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup accepts live .agents/skills links that already point to .github/skills', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const originalSkipDepInstall = process.env.EGCOPILOT_SKIP_DEP_INSTALL;
  const agentsDir = path.join(targetDir, '.agents');
  const skillsDir = path.join(targetDir, '.github', 'skills');
  const bridgeDir = path.join(agentsDir, 'skills');

  try {
    process.env.EGCOPILOT_SKIP_DEP_INSTALL = '1';
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });

    try {
      fs.symlinkSync(skillsDir, bridgeDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    projectSetup.installProject(targetDir);

    projectSetup.uninstallProject(targetDir);

    assert.ok(fs.existsSync(bridgeDir), 'uninstall should preserve a preexisting valid live bridge');
    assert.ok(fs.existsSync(skillsDir), 'uninstall should restore the preexisting .github/skills directory behind the valid live bridge');
    assert.strictEqual(fs.readdirSync(skillsDir).length, 0, 'uninstall should restore the preexisting .github/skills directory to its original empty state');
  } finally {
    if (originalSkipDepInstall === undefined) {
      delete process.env.EGCOPILOT_SKIP_DEP_INSTALL;
    } else {
      process.env.EGCOPILOT_SKIP_DEP_INSTALL = originalSkipDepInstall;
    }
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project uninstall refuses to run without installer state', () => {
  const targetDir = createTestDir('egc-project-setup-');

  try {
    fs.mkdirSync(path.join(targetDir, '.github'), { recursive: true });
    fs.writeFileSync(path.join(targetDir, '.github', 'copilot-instructions.md'), '# unmanaged\n');

    const error = runProjectInstallerFailure('uninstall', targetDir);

    assert.notStrictEqual(error.status, 0, 'uninstall should fail without state');
    assert.ok((error.stderr || '').includes('No installer state file found'), 'failure should explain that uninstall requires installer state');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project uninstall allows legacy redirected installs that stayed inside the target root to clean up safely', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const redirectedGithubDir = path.join(targetDir, '.legacy-github');
  const linkedGithubDir = path.join(targetDir, '.github');
  const managedFile = path.join(redirectedGithubDir, 'copilot-instructions.md');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');

  try {
    fs.mkdirSync(redirectedGithubDir, { recursive: true });
    fs.writeFileSync(managedFile, '# installed by legacy setup\n');

    try {
      fs.symlinkSync(redirectedGithubDir, linkedGithubDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    fs.writeFileSync(stateFile, JSON.stringify({
      version: 1,
      copiedFiles: ['.github/copilot-instructions.md'],
      backupFiles: [],
      preservedDirectories: [],
      dependencyState: null,
    }, null, 2));

    projectSetup.uninstallProject(targetDir);

    assert.strictEqual(fs.existsSync(managedFile), false, 'legacy uninstall should remove redirected managed files that stayed inside target root');
    assert.strictEqual(fs.existsSync(stateFile), false, 'legacy uninstall should remove the installer state after successful cleanup');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project uninstall rejects redirected dependency manifests before running dependency removal', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const packageJsonPath = path.join(targetDir, 'package.json');
  const redirectedPackageJson = path.join(targetDir, '.redirected-package', 'package.json');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');
  const originalReadlinkSync = fs.readlinkSync;

  try {
    fs.mkdirSync(path.dirname(redirectedPackageJson), { recursive: true });
    fs.writeFileSync(packageJsonPath, '{"name":"target"}\n');

    fs.writeFileSync(stateFile, JSON.stringify({
      version: 2,
      copiedFiles: [],
      backupFiles: [],
      preservedDirectories: [],
      dependencyState: {
        packageManager: 'npm',
        skippedDependencyInstall: false,
        hadPackageJson: true,
        createdPackageJson: false,
        preexistingLockfiles: [],
        generatedLockfiles: [],
        hadNodeModules: false,
        createdNodeModules: false,
      },
    }, null, 2));

    fs.readlinkSync = (targetPath, ...args) => {
      if (targetPath === packageJsonPath) {
        return redirectedPackageJson;
      }

      return originalReadlinkSync.call(fs, targetPath, ...args);
    };

    assert.throws(
      () => projectSetup.uninstallProject(targetDir),
      /redirected managed path/,
      'uninstall should reject redirected dependency manifests before invoking package-manager removal'
    );
  } finally {
    fs.readlinkSync = originalReadlinkSync;
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project uninstall rejects tampered installer state that references unmanaged paths', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');

  try {
    fs.writeFileSync(stateFile, JSON.stringify({
      copiedFiles: ['src'],
      backupFiles: [],
      dependencyState: null,
    }, null, 2));

    const error = runProjectInstallerFailure('uninstall', targetDir);

    assert.notStrictEqual(error.status, 0, 'tampered state should fail closed');
    assert.ok((error.stderr || '').includes('invalid or references unmanaged paths'), 'failure should explain the invalid installer state');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project uninstall rejects tampered dependency metadata before invoking the package manager', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');
  const markerFile = path.join(targetDir, 'npm-called.txt');
  const stub = createPackageManagerStub('egc-project-setup-stub-', `'use strict';
const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(process.cwd(), 'npm-called.txt'), 'called\n');
process.exit(0);
`);

  try {
    fs.writeFileSync(stateFile, JSON.stringify({
      copiedFiles: [],
      backupFiles: [],
      dependencyState: {
        packageManager: 'npm',
        skippedDependencyInstall: 'nope',
      },
    }, null, 2));

    const error = runProjectInstallerFailure('uninstall', targetDir, stub.env);

    assert.notStrictEqual(error.status, 0, 'tampered dependency metadata should fail closed');
    assert.ok((error.stderr || '').includes('invalid or references unmanaged paths'), 'failure should explain the invalid installer state');
    assert.strictEqual(fs.existsSync(markerFile), false, 'invalid dependency metadata should be rejected before npm uninstall runs');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(stub.stubDir);
  }
}));

results.push(test('project setup refuses to back up dependency files that resolve outside the target root', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const externalDir = createTestDir('egc-project-setup-external-');
  const packageJsonPath = path.join(targetDir, 'package.json');
  const externalPackageJson = path.join(externalDir, 'package.json');

  try {
    fs.writeFileSync(externalPackageJson, '{\n  "private": true\n}\n');

    try {
      fs.symlinkSync(externalPackageJson, packageJsonPath, 'file');
    } catch {
      return;
    }

    const error = runProjectSetupFailure(targetDir, { EGCOPILOT_SKIP_DEP_INSTALL: '0' });

    assert.notStrictEqual(error.status, 0, 'setup should fail when dependency backups escape the target root');
    assert.ok((error.stderr || '').includes('symlinked content outside the target root'), 'failure should explain the rejected dependency backup path');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(externalDir);
  }
}));

results.push(test('project setup rolls back copied files and dependency artifacts when dependency installation fails', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const customCopilotInstructions = path.join(targetDir, '.github', 'copilot-instructions.md');
  const packageJsonPath = path.join(targetDir, 'package.json');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');
  const backupDir = path.join(targetDir, '.everything-githubcopilot-project-install-backup');
  const stub = createPackageManagerStub('egc-project-setup-stub-', `'use strict';
const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(process.cwd(), 'package.json'), JSON.stringify({ private: true, dependencies: { broken: '1.0.0' } }, null, 2));
fs.writeFileSync(path.join(process.cwd(), 'package-lock.json'), '{\n  "lockfileVersion": 3\n}\n');
fs.mkdirSync(path.join(process.cwd(), 'node_modules'), { recursive: true });
process.exit(1);
`);

  try {
    fs.mkdirSync(path.dirname(customCopilotInstructions), { recursive: true });
    fs.writeFileSync(customCopilotInstructions, '# custom instructions\n');
    fs.writeFileSync(packageJsonPath, '{\n  "private": true\n}\n');

    const error = runProjectSetupFailure(targetDir, stub.env);

    assert.notStrictEqual(error.status, 0, 'setup should fail when dependency installation fails');
    assert.strictEqual(fs.readFileSync(customCopilotInstructions, 'utf8'), '# custom instructions\n', 'failed setup should restore overwritten files');
    assert.strictEqual(fs.readFileSync(packageJsonPath, 'utf8'), '{\n  "private": true\n}\n', 'failed setup should restore package.json');
    assert.strictEqual(fs.existsSync(path.join(targetDir, 'package-lock.json')), false, 'failed setup should remove generated lockfiles');
    assert.strictEqual(fs.existsSync(path.join(targetDir, 'node_modules')), false, 'failed setup should remove generated node_modules when they did not exist before');
    assert.strictEqual(fs.existsSync(stateFile), false, 'failed setup should not leave an installer state file behind');
    assert.strictEqual(fs.existsSync(backupDir), false, 'failed setup should clean up the temporary backup directory');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(stub.stubDir);
  }
}));

results.push(test('project uninstall keeps state and backups when a required backup file is missing', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const customCopilotInstructions = path.join(targetDir, '.github', 'copilot-instructions.md');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');
  const backupDir = path.join(targetDir, '.everything-githubcopilot-project-install-backup');

  try {
    fs.mkdirSync(path.dirname(customCopilotInstructions), { recursive: true });
    fs.writeFileSync(customCopilotInstructions, '# custom instructions\n');

    runProjectSetup(targetDir);
    fs.rmSync(path.join(backupDir, '.github', 'copilot-instructions.md'));

    const error = runProjectInstallerFailure('uninstall', targetDir);

    assert.notStrictEqual(error.status, 0, 'uninstall should fail when required backups are missing');
    assert.strictEqual(fs.existsSync(stateFile), true, 'failed uninstall should keep the state file for retry');
    assert.strictEqual(fs.existsSync(backupDir), true, 'failed uninstall should keep remaining backups for retry');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project uninstall removes generated node_modules when the target had none before install', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const packageJsonPath = path.join(targetDir, 'package.json');
  const stub = createPackageManagerStub('egc-project-setup-stub-', [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const command = process.argv[2];",
    "if (command === 'install') {",
    "  fs.writeFileSync(path.join(process.cwd(), 'package.json'), JSON.stringify({ private: true, dependencies: { installed: '1.0.0' } }, null, 2));",
    "  fs.writeFileSync(path.join(process.cwd(), 'package-lock.json'), '{\\n  \"lockfileVersion\": 3\\n}\\n');",
    "  fs.mkdirSync(path.join(process.cwd(), 'node_modules'), { recursive: true });",
    "}",
    'process.exit(0);',
  ].join('\n'));

  try {
    fs.writeFileSync(packageJsonPath, '{\n  "private": true\n}\n');

    runProjectSetup(targetDir, stub.env);
    assert.strictEqual(fs.existsSync(path.join(targetDir, 'node_modules')), true, 'install should create node_modules through the stub package manager');

    runProjectInstaller('uninstall', targetDir, stub.env);

    assert.strictEqual(fs.existsSync(path.join(targetDir, 'node_modules')), false, 'uninstall should remove node_modules that did not exist before install');
    assert.strictEqual(fs.readFileSync(packageJsonPath, 'utf8'), '{\n  "private": true\n}\n', 'uninstall should restore the original package.json');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(stub.stubDir);
  }
}));

results.push(test('project uninstall fails closed when dependency removal fails for a preexisting node_modules tree', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const packageJsonPath = path.join(targetDir, 'package.json');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');
  const backupDir = path.join(targetDir, '.everything-githubcopilot-project-install-backup');
  const stub = createPackageManagerStub('egc-project-setup-stub-', [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const command = process.argv[2];",
    "if (command === 'install') {",
    "  fs.writeFileSync(path.join(process.cwd(), 'package.json'), JSON.stringify({ private: true, dependencies: { installed: '1.0.0' } }, null, 2));",
    "  fs.writeFileSync(path.join(process.cwd(), 'package-lock.json'), '{\\n  \"lockfileVersion\": 3\\n}\\n');",
    "}",
    "if (command === 'uninstall') {",
    "  process.exit(1);",
    "}",
    'process.exit(0);',
  ].join('\n'));

  try {
    fs.writeFileSync(packageJsonPath, '{\n  "private": true\n}\n');
    fs.mkdirSync(path.join(targetDir, 'node_modules'), { recursive: true });

    runProjectSetup(targetDir, stub.env);

    const error = runProjectInstallerFailure('uninstall', targetDir, stub.env);

    assert.notStrictEqual(error.status, 0, 'uninstall should fail when dependency removal cannot restore a preexisting node_modules tree');
    assert.strictEqual(fs.existsSync(stateFile), true, 'failed uninstall should preserve installer state for retry');
    assert.strictEqual(fs.existsSync(backupDir), true, 'failed uninstall should preserve backups for retry');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(stub.stubDir);
  }
}));

results.push(test('project reinstall restores the previous install before applying a fresh copy without deleting untracked user files', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const customCopilotInstructions = path.join(targetDir, '.github', 'copilot-instructions.md');

  try {
    fs.mkdirSync(path.dirname(customCopilotInstructions), { recursive: true });
    fs.writeFileSync(customCopilotInstructions, '# custom instructions\n');

    runProjectSetup(targetDir);
    fs.writeFileSync(path.join(targetDir, '.github', 'instructions', 'temp.txt'), 'transient\n');

    const reinstallOutput = runProjectInstaller('reinstall', targetDir);

    assert.ok(reinstallOutput.includes('Running uninstall first'), 'reinstall should announce the uninstall phase');
    assert.ok(reinstallOutput.includes('Project setup complete'), 'reinstall should run a fresh install after uninstall');
    assert.notStrictEqual(fs.readFileSync(customCopilotInstructions, 'utf8'), '# custom instructions\n', 'reinstall should leave the shipped content installed');
    assert.strictEqual(fs.existsSync(path.join(targetDir, '.github', 'instructions', 'temp.txt')), true, 'reinstall should preserve untracked user files inside managed directories');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup rejects unknown commands instead of treating them as install targets', () => {
  const targetDir = createTestDir('egc-project-setup-');

  try {
    const error = runProjectInstallerFailure('instal', targetDir);

    assert.notStrictEqual(error.status, 0, 'unknown project installer commands should fail');
    assert.ok((error.stderr || '').includes('Usage:'), 'unknown commands should report usage instead of being interpreted as a target path');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('project setup still supports the explicit install command with a target argument', () => {
  const targetDir = createTestDir('egc-project-setup-');
  const stateFile = path.join(targetDir, '.everything-githubcopilot-project-install.json');

  try {
    const output = runProjectInstaller('install', targetDir);

    assert.ok(output.includes('Project setup complete'), 'explicit install should complete successfully');
    assert.strictEqual(fs.existsSync(stateFile), true, 'explicit install should preserve the state file contract');
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