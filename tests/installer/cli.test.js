const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { getUserInstallManifest } = require('../../scripts/installer/manifest');

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

function runInstaller(command, env) {
  const cliPath = path.join(__dirname, '..', '..', 'scripts', 'installer', 'cli.js');
  return execFileSync('node', [cliPath, command], {
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

function runInstallerFailure(command, env) {
  const cliPath = path.join(__dirname, '..', '..', 'scripts', 'installer', 'cli.js');
  try {
    execFileSync('node', [cliPath, command], {
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

  throw new Error(`Expected ${command} to fail`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

console.log('installer cli tests');

const results = [];

results.push(test('install preserves unrelated settings and does not enable dangerous skip permissions by default', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const vsSettings = path.join(tempVs, 'settings.json');
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, JSON.stringify({
      'editor.fontSize': 16,
      'chat.instructionsFilesLocations': {
        '.claude/rules': true,
      },
      'chat.agentFilesLocations': {
        'C:/custom/agents': true,
      },
      'chat.hookFilesLocations': {
        '.claude/settings.json': true,
      },
    }, null, 2));

    runInstaller('install', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    const settings = readJson(vsSettings);
    const state = readJson(path.join(copilotBase, '.everything-githubcopilot-install.json'));
    assert.strictEqual(settings['editor.fontSize'], 16, 'unrelated settings should be preserved');
    assert.strictEqual(settings['chat.instructionsFilesLocations']['.claude/rules'], false, 'installer should disable legacy Claude rules discovery');
    assert.strictEqual(settings['chat.agentFilesLocations']['C:/custom/agents'], true, 'existing discovery paths should be preserved');
    assert.strictEqual(settings['chat.agentFilesLocations']['~/.copilot/agents'], true, 'installer should add the managed agent path');
    assert.strictEqual(settings['chat.hookFilesLocations']['~/.copilot/hooks'], true, 'installer should add the managed hook path');
    assert.strictEqual(settings['chat.hookFilesLocations']['.claude/settings.json'], false, 'installer should disable legacy Claude hook discovery');
    assert.strictEqual(settings['chat.useAgentsMdFile'], true, 'installer should enable AGENTS.md discovery');
    assert.strictEqual(settings['chat.useClaudeMdFile'], false, 'installer should keep CLAUDE.md discovery disabled');
    assert.ok(!Object.prototype.hasOwnProperty.call(settings, 'github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions'), 'dangerous skip permissions should stay unset by default');
    assert.deepStrictEqual(state.managedPaths, getUserInstallManifest().managedPaths, 'install state should use the shared managed path manifest');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('install can opt into dangerous skip permissions in user settings and uninstall restores the previous raw file', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const vsSettings = path.join(tempVs, 'settings.json');
    const originalSettings = '{\n  // keep comments intact\n  "editor.tabSize": 2\n}\n';
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, originalSettings);

    runInstaller('install', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
      EGCOPILOT_ENABLE_DANGEROUS_SKIP_PERMISSIONS: '1',
    });

    const installedSettings = readJson(vsSettings);
    assert.strictEqual(installedSettings['github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions'], true, 'opt-in installer flag should enable the public permission bypass setting');

    runInstaller('uninstall', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    const restoredRaw = fs.readFileSync(vsSettings, 'utf8');
    assert.strictEqual(restoredRaw, originalSettings, 'uninstall should restore the previous raw settings file exactly');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('install fails closed when VS Code settings.json cannot be parsed', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const vsSettings = path.join(tempVs, 'settings.json');
    const invalidSettings = '{\n  "editor.tabSize": 2,,\n}\n';
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, invalidSettings);

    const error = runInstallerFailure('install', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    assert.notStrictEqual(error.status, 0, 'install should fail for invalid VS Code settings');
    assert.ok((error.stderr || '').includes('Unable to parse VS Code settings.json'), 'failure should explain the parse problem');
    assert.strictEqual(fs.readFileSync(vsSettings, 'utf8'), invalidSettings, 'installer must not overwrite an invalid settings file');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('uninstall refuses managed paths that escape the managed copilot directory', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const stateFile = path.join(copilotBase, '.everything-githubcopilot-install.json');
    const vsSettings = path.join(tempVs, 'settings.json');
    const victimFile = path.join(tempHome, 'victim.txt');
    const originalSettings = '{\n  "editor.tabSize": 2\n}\n';
    fs.mkdirSync(copilotBase, { recursive: true });
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, originalSettings);
    fs.writeFileSync(victimFile, 'do not delete\n');
    fs.writeFileSync(stateFile, JSON.stringify({
      hadVsSettings: true,
      previousSettingsRaw: '{}\n',
      managedPaths: ['..\\victim.txt'],
      previousSettings: {},
    }, null, 2));

    const error = runInstallerFailure('uninstall', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    assert.notStrictEqual(error.status, 0, 'uninstall should fail when managed paths escape the install root');
    assert.ok((error.stderr || '').includes('Refusing to remove managed path outside the copilot directory'), 'failure should explain the rejected path');
    assert.ok(fs.existsSync(victimFile), 'files outside the managed install root must be preserved');
    assert.strictEqual(fs.readFileSync(vsSettings, 'utf8'), originalSettings, 'failed uninstall must not mutate VS Code settings');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('uninstall fails closed when legacy restore needs to read an invalid settings.json', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const stateFile = path.join(copilotBase, '.everything-githubcopilot-install.json');
    const vsSettings = path.join(tempVs, 'settings.json');
    const invalidSettings = '{\n  "editor.tabSize": 2,,\n}\n';
    fs.mkdirSync(copilotBase, { recursive: true });
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, invalidSettings);
    fs.writeFileSync(stateFile, JSON.stringify({
      hadVsSettings: true,
      previousSettingsRaw: null,
      managedPaths: [],
      previousSettings: {},
    }, null, 2));

    const error = runInstallerFailure('uninstall', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    assert.notStrictEqual(error.status, 0, 'uninstall should fail for invalid current VS Code settings in fallback mode');
    assert.ok((error.stderr || '').includes('Unable to parse VS Code settings.json'), 'failure should explain the parse problem');
    assert.strictEqual(fs.readFileSync(vsSettings, 'utf8'), invalidSettings, 'failed uninstall must leave invalid settings untouched');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('fallback uninstall removes dangerous skip permissions when installer state marks it as managed', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const stateFile = path.join(copilotBase, '.everything-githubcopilot-install.json');
    const vsSettings = path.join(tempVs, 'settings.json');
    fs.mkdirSync(copilotBase, { recursive: true });
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, JSON.stringify({
      'editor.tabSize': 2,
      'github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions': true,
    }, null, 2));
    fs.writeFileSync(stateFile, JSON.stringify({
      hadVsSettings: true,
      previousSettingsRaw: null,
      managedPaths: [],
      managedSettingKeys: [
        'chat.instructionsFilesLocations',
        'chat.agentFilesLocations',
        'chat.agentSkillsLocations',
        'chat.promptFilesLocations',
        'chat.hookFilesLocations',
        'chat.useAgentsMdFile',
        'chat.useClaudeMdFile',
        'chat.includeApplyingInstructions',
        'chat.includeReferencedInstructions',
        'github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions',
      ],
      previousSettings: {},
    }, null, 2));

    runInstaller('uninstall', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    const restoredSettings = readJson(vsSettings);
    assert.ok(!Object.prototype.hasOwnProperty.call(restoredSettings, 'github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions'), 'fallback uninstall should remove managed dangerous skip permissions when no previous value existed');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('install and uninstall round-trip the shipped eval fixtures', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const vsSettings = path.join(tempVs, 'settings.json');
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, '{}\n');

    runInstaller('install', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    const installedFixture = path.join(copilotBase, 'tests', 'fixtures', 'skill-router', 'eval-cases.json');
    assert.ok(fs.existsSync(installedFixture), 'install should copy shipped eval fixtures');

    runInstaller('uninstall', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    assert.ok(!fs.existsSync(path.join(copilotBase, 'tests', 'fixtures')), 'uninstall should remove the copied eval fixtures');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('install allows the existing GitHub Copilot ide directory and preserves it on uninstall', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const ideDir = path.join(copilotBase, 'ide');
    const vsSettings = path.join(tempVs, 'settings.json');
    fs.mkdirSync(ideDir, { recursive: true });
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, '{}\n');
    fs.writeFileSync(path.join(ideDir, 'marker.txt'), 'keep me\n');

    runInstaller('install', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    assert.ok(fs.existsSync(path.join(copilotBase, '.everything-githubcopilot-install.json')), 'installer should still create state when ide exists');
    assert.ok(fs.existsSync(path.join(ideDir, 'marker.txt')), 'installer should preserve the existing ide directory during install');

    runInstaller('uninstall', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    assert.ok(fs.existsSync(ideDir), 'uninstall should preserve the pre-existing ide directory');
    assert.ok(fs.existsSync(path.join(ideDir, 'marker.txt')), 'uninstall should not touch files inside ide');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('install still fails when ide exists alongside other unmanaged ~/.copilot entries', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const vsSettings = path.join(tempVs, 'settings.json');
    fs.mkdirSync(path.join(copilotBase, 'ide'), { recursive: true });
    fs.mkdirSync(path.join(copilotBase, 'custom-cache'), { recursive: true });
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(vsSettings, '{}\n');

    const error = runInstallerFailure('install', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    assert.notStrictEqual(error.status, 0, 'install should still fail for mixed unmanaged ~/.copilot contents');
    assert.ok((error.stderr || '').includes('Existing entries: ide, custom-cache') || (error.stderr || '').includes('Existing entries: custom-cache, ide'), 'failure should report the remaining unmanaged entries');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

results.push(test('install still fails when ide exists as a non-directory entry', () => {
  const tempHome = createTestDir('egc-installer-home-');
  const tempVs = createTestDir('egc-installer-vscode-');

  try {
    const copilotBase = path.join(tempHome, '.copilot');
    const vsSettings = path.join(tempVs, 'settings.json');
    fs.mkdirSync(copilotBase, { recursive: true });
    fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
    fs.writeFileSync(path.join(copilotBase, 'ide'), 'not a directory\n');
    fs.writeFileSync(vsSettings, '{}\n');

    const error = runInstallerFailure('install', {
      EGCOPILOT_COPILOT_BASE: copilotBase,
      EGCOPILOT_VSCODE_SETTINGS: vsSettings,
    });

    assert.notStrictEqual(error.status, 0, 'install should fail when ide is not a directory');
    assert.ok((error.stderr || '').includes('Existing entries: ide'), 'failure should still report ide as unmanaged');
  } finally {
    cleanupTestDir(tempHome);
    cleanupTestDir(tempVs);
  }
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}