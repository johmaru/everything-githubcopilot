#!/usr/bin/env node
/**
 * Everything GitHub Copilot - User-Level Installer CLI
 *
 * Usage:
 *   node scripts/installer/cli.js [install|uninstall|reinstall] [--provider copilot|codex|all]
 *   npx everything-githubcopilot [install|uninstall|reinstall] [--provider copilot|codex|all]
 *
 * Manages user-level installation of Copilot customizations and optional Codex global assets.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
  getRuntimeDependencies,
  getUserCodexInstallManifest,
  getUserCopilotSettings,
  getUserInstallManifest,
} = require('./manifest');

const INSTALL_STATE_FILE = '.everything-githubcopilot-install.json';
const CODEX_INSTALL_STATE_FILE = '.everything-githubcopilot-codex-install.json';
const ALLOWED_PREEXISTING_COPILOT_ENTRIES = new Set(['ide']);
const USER_INSTALL_MANIFEST = getUserInstallManifest();
const USER_CODEX_INSTALL_MANIFEST = getUserCodexInstallManifest();
const DEFAULT_MANAGED_PATHS = USER_INSTALL_MANIFEST.managedPaths;
const RUNTIME_DEPENDENCIES = getRuntimeDependencies();

function getPaths() {
  const homeDir = os.homedir();
  const copilotBase = process.env.EGCOPILOT_COPILOT_BASE || path.join(homeDir, '.copilot');
  const codexBase = process.env.EGCOPILOT_CODEX_HOME || path.join(homeDir, '.codex');
  const stateFile = path.join(copilotBase, INSTALL_STATE_FILE);
  const codexStateFile = path.join(codexBase, CODEX_INSTALL_STATE_FILE);

  let vsSettings;
  if (process.env.EGCOPILOT_VSCODE_SETTINGS) {
    vsSettings = process.env.EGCOPILOT_VSCODE_SETTINGS;
  } else if (process.platform === 'win32') {
    vsSettings = path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
  } else if (process.platform === 'darwin') {
    vsSettings = path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  } else {
    vsSettings = path.join(homeDir, '.config', 'Code', 'User', 'settings.json');
  }

  return { homeDir, copilotBase, codexBase, codexStateFile, stateFile, vsSettings };
}

function loadInstallState(stateFile) {
  if (fs.existsSync(stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

function saveInstallState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function removeInstallState(stateFile) {
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }
}

function ensureSafeInstallTarget(copilotBase, stateFile) {
  if (!fs.existsSync(copilotBase) || fs.existsSync(stateFile)) {
    return;
  }

  const existingEntries = fs.readdirSync(copilotBase, { withFileTypes: true })
    .filter((entry) => entry.name !== INSTALL_STATE_FILE);
  const unmanagedEntries = existingEntries.filter((entry) => {
    if (!ALLOWED_PREEXISTING_COPILOT_ENTRIES.has(entry.name)) {
      return true;
    }

    return !entry.isDirectory() || entry.isSymbolicLink();
  });

  if (unmanagedEntries.length > 0) {
    throw new Error(
      `Refusing to install into an existing ~/.copilot directory without installer state. Existing entries: ${existingEntries.map((entry) => entry.name).join(', ')}`
    );
  }
}

function pruneEmptyParents(startPath, stopPath) {
  let currentPath = startPath;

  while (currentPath.startsWith(stopPath) && currentPath !== stopPath) {
    if (!fs.existsSync(currentPath)) {
      currentPath = path.dirname(currentPath);
      continue;
    }

    if (fs.readdirSync(currentPath).length > 0) {
      return;
    }

    fs.rmdirSync(currentPath);
    currentPath = path.dirname(currentPath);
  }
}

function stripJsonComments(source) {
  let result = '';
  let inString = false;
  let stringQuote = '';
  let escapeNext = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      result += char;

      if (escapeNext) {
        escapeNext = false;
      } else if (char === '\\') {
        escapeNext = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = '';
      }

      continue;
    }

    if ((char === '"' || char === "'")) {
      inString = true;
      stringQuote = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index++;
      continue;
    }

    result += char;
  }

  return result;
}

function parseJsonc(source) {
  const withoutBom = source.replace(/^\uFEFF/, '');
  const withoutComments = stripJsonComments(withoutBom);
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(withoutTrailingCommas);
}

function readVsSettingsFile(vsSettings) {
  if (!fs.existsSync(vsSettings)) {
    return {
      exists: false,
      rawText: null,
      settings: {},
      parseError: null,
    };
  }

  const rawText = fs.readFileSync(vsSettings, 'utf8');

  try {
    return {
      exists: true,
      rawText,
      settings: parseJsonc(rawText),
      parseError: null,
    };
  } catch (error) {
    return {
      exists: true,
      rawText,
      settings: {},
      parseError: error,
    };
  }
}

function writeVsSettings(vsSettings, settings) {
  fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
  fs.writeFileSync(vsSettings, JSON.stringify(settings, null, 2));
}

function writeRawVsSettings(vsSettings, rawText) {
  fs.mkdirSync(path.dirname(vsSettings), { recursive: true });
  fs.writeFileSync(vsSettings, rawText);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeCopilotSettings(existingSettings, copilotSettings) {
  const mergedSettings = { ...existingSettings };

  for (const [key, value] of Object.entries(copilotSettings)) {
    if (key.endsWith('FilesLocations') && isPlainObject(existingSettings[key]) && isPlainObject(value)) {
      mergedSettings[key] = {
        ...existingSettings[key],
        ...value,
      };
      continue;
    }

    mergedSettings[key] = value;
  }

  return mergedSettings;
}

function isTruthyEnv(value) {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function getOptionalUserSettings() {
  const settings = {};

  // Current public Copilot Chat settings do not expose repo-configurable
  // allowed-tools or default-approval lists. The only supported approval-adjacent
  // setting we manage is the explicit user-level opt-in for bypass permissions.
  if (isTruthyEnv(process.env.EGCOPILOT_ENABLE_DANGEROUS_SKIP_PERMISSIONS)) {
    settings['github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions'] = true;
  }

  return settings;
}

function getCopilotSettings() {
  return {
    ...getUserCopilotSettings(),
    ...getOptionalUserSettings(),
  };
}

function resolveManagedPath(copilotBase, relativePath) {
  const resolvedPath = path.resolve(copilotBase, relativePath);
  const relativeToBase = path.relative(copilotBase, resolvedPath);

  if (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
    throw new Error(`Refusing to remove managed path outside the copilot directory: ${relativePath}`);
  }

  return resolvedPath;
}

function resolveManagedPathInBase(basePath, relativePath, label) {
  const resolvedPath = path.resolve(basePath, relativePath);
  const relativeToBase = path.relative(basePath, resolvedPath);

  if (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
    throw new Error(`Refusing to remove managed path outside the ${label} directory: ${relativePath}`);
  }

  return resolvedPath;
}

function copyManifestOperations(repoRoot, targetBase, copyOperations) {
  let totalCopied = 0;

  for (const op of copyOperations) {
    const srcPath = path.join(repoRoot, op.src);
    const dstPath = path.join(targetBase, op.dst);

    if (!fs.existsSync(srcPath)) {
      console.log(`  Skipping ${op.src} (not found)`);
      continue;
    }

    if (op.single) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      console.log(`  Copied ${op.src} -> ${op.dst}`);
      totalCopied++;
    } else if (op.recursive) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyRecursive(srcPath, dstPath, op.excludeRelativePaths || []);
      const count = countFiles(dstPath);
      console.log(`  Copied ${op.src} -> ${op.dst} (${count} items)`);
      totalCopied += count;
    } else if (op.pattern) {
      fs.mkdirSync(dstPath, { recursive: true });
      const files = fs.readdirSync(srcPath).filter(f => f.match(op.pattern.replace('*', '.*')));
      for (const file of files) {
        fs.copyFileSync(path.join(srcPath, file), path.join(dstPath, file));
      }
      console.log(`  Copied ${files.length} files from ${op.src} -> ${op.dst}`);
      totalCopied += files.length;
    }
  }

  return totalCopied;
}

function getCodexPayloadRoot(codexBase) {
  return path.join(codexBase, 'everything-githubcopilot');
}

function createCodexDependencyPackage(payloadRoot) {
  const packageJson = path.join(payloadRoot, 'package.json');
  fs.mkdirSync(payloadRoot, { recursive: true });
  fs.writeFileSync(packageJson, JSON.stringify({
    name: 'everything-githubcopilot-codex-runtime',
    version: '1.0.0',
    private: true,
    description: 'Runtime dependencies for Everything GitHub Copilot Codex hooks'
  }, null, 2));
}

function transformCodexGlobalConfig(sourceText) {
  return sourceText.replace(/config_file = "agents\//g, 'config_file = "everything-githubcopilot/agents/');
}

function buildGlobalHookCommand(codexBase, scriptName) {
  const absoluteScriptPath = path
    .join(getCodexPayloadRoot(codexBase), 'scripts', 'hooks', scriptName)
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'");

  return `node -e "require('${absoluteScriptPath}')"`;
}

function transformCodexGlobalHooks(sourceText, codexBase) {
  const hooksConfig = JSON.parse(sourceText);

  for (const eventHooks of Object.values(hooksConfig.hooks || {})) {
    if (!Array.isArray(eventHooks)) {
      continue;
    }

    for (const entry of eventHooks) {
      for (const hook of entry.hooks || []) {
        if (hook.type !== 'command' || typeof hook.command !== 'string') {
          continue;
        }

        const match = hook.command.match(/rel='scripts\/hooks\/([^']+)'/u);
        if (match) {
          hook.command = buildGlobalHookCommand(codexBase, match[1]);
        }
      }
    }
  }

  return `${JSON.stringify(hooksConfig, null, 2)}\n`;
}

function renderCodexActiveFile(repoRoot, codexBase, operation) {
  const sourceText = fs.readFileSync(path.join(repoRoot, operation.src), 'utf8');

  switch (operation.transform) {
    case 'codex-global-config':
      return transformCodexGlobalConfig(sourceText);
    case 'codex-global-hooks':
      return transformCodexGlobalHooks(sourceText, codexBase);
    default:
      return sourceText;
  }
}

function ensureSafeCodexInstallTarget(codexBase, stateFile) {
  if (fs.existsSync(stateFile)) {
    return;
  }

  const managedPaths = USER_CODEX_INSTALL_MANIFEST.managedPaths;
  const existingManagedPaths = managedPaths.filter(relativePath => fs.existsSync(path.join(codexBase, relativePath)));
  if (existingManagedPaths.length > 0) {
    throw new Error(
      `Refusing to install Codex assets over unmanaged ~/.codex paths. Existing entries: ${existingManagedPaths.join(', ')}`
    );
  }
}

function writeCodexActiveFiles(repoRoot, codexBase, state) {
  const warnings = [];

  for (const operation of USER_CODEX_INSTALL_MANIFEST.activeFiles) {
    const targetPath = path.join(codexBase, operation.dst);
    const hasExistingFile = fs.existsSync(targetPath);

    if (hasExistingFile && !state.managedPaths.includes(operation.dst)) {
      warnings.push(
        `Warning: ~/.codex/${operation.dst} already exists; leaving it untouched. A managed template was installed under ~/.codex/everything-githubcopilot/.`
      );
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, renderCodexActiveFile(repoRoot, codexBase, operation));
    if (!state.managedPaths.includes(operation.dst)) {
      state.managedPaths.push(operation.dst);
    }
    console.log(`  Installed active Codex ${operation.dst}`);
  }

  return warnings;
}

function installCodexDependencies(codexBase) {
  const payloadRoot = getCodexPayloadRoot(codexBase);
  createCodexDependencyPackage(payloadRoot);

  if (process.env.EGCOPILOT_SKIP_DEP_INSTALL === '1') {
    console.log('  Codex dependency installation skipped by EGCOPILOT_SKIP_DEP_INSTALL=1');
    return;
  }

  try {
    execSync(`npm install --no-audit --no-fund ${RUNTIME_DEPENDENCIES.join(' ')}`, {
      cwd: payloadRoot,
      stdio: 'pipe'
    });
    console.log('  Codex dependencies installed successfully');
  } catch {
    console.log('  Warning: Failed to install Codex dependencies. You can install manually:');
    console.log(`    cd ${payloadRoot} && npm install ${RUNTIME_DEPENDENCIES.join(' ')}`);
  }
}

function installCodex() {
  console.log('Installing Everything GitHub Copilot Codex assets (user-level)...\n');

  const { codexBase, codexStateFile } = getPaths();
  const repoRoot = path.join(__dirname, '..', '..');

  ensureSafeCodexInstallTarget(codexBase, codexStateFile);
  fs.mkdirSync(codexBase, { recursive: true });

  const state = loadInstallState(codexStateFile) || {
    installedAt: new Date().toISOString(),
    version: require(path.join(repoRoot, 'package.json')).version,
    managedPaths: [...USER_CODEX_INSTALL_MANIFEST.managedPaths],
  };

  const totalCopied = copyManifestOperations(repoRoot, codexBase, USER_CODEX_INSTALL_MANIFEST.copyOperations);
  const warnings = writeCodexActiveFiles(repoRoot, codexBase, state);

  console.log('\n  Installing Codex hook dependencies...');
  installCodexDependencies(codexBase);

  saveInstallState(codexStateFile, state);

  for (const warning of warnings) {
    console.log(warning);
  }

  console.log(`\n✅ Codex user-level installation complete!`);
  console.log(`   Location: ${codexBase}`);
  console.log(`   State file: ${codexStateFile}`);
  console.log(`   Copied items: ${totalCopied}`);
  console.log('   Skills namespace: ~/.codex/skills/everything-githubcopilot');
}

function install() {
  console.log('Installing Everything GitHub Copilot (user-level)...\n');

  const { copilotBase, stateFile, vsSettings } = getPaths();
  const repoRoot = path.join(__dirname, '..', '..');

  ensureSafeInstallTarget(copilotBase, stateFile);

  // Save current state before installing
  const settingsFile = readVsSettingsFile(vsSettings);
  if (settingsFile.parseError) {
    throw new Error(`Unable to parse VS Code settings.json: ${settingsFile.parseError.message}`);
  }

  const previousSettings = settingsFile.settings;
  const state = {
    installedAt: new Date().toISOString(),
    version: require(path.join(repoRoot, 'package.json')).version,
    hadVsSettings: settingsFile.exists,
    previousSettingsRaw: settingsFile.rawText,
    managedPaths: [...DEFAULT_MANAGED_PATHS],
    managedSettingKeys: [],
    createdDependencyPackage: false,
    previousSettings: {}
  };

  // Track which settings we're modifying
  const copilotSettings = getCopilotSettings();
  state.managedSettingKeys = Object.keys(copilotSettings);
  for (const key of Object.keys(copilotSettings)) {
    if (previousSettings[key] !== undefined) {
      state.previousSettings[key] = previousSettings[key];
    }
  }

  // Copy files
  const totalCopied = copyManifestOperations(repoRoot, copilotBase, USER_INSTALL_MANIFEST.copyOperations);

  // Rewrite hook paths
  const hooksDir = path.join(copilotBase, 'hooks');
  if (fs.existsSync(hooksDir)) {
    const hookFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.json'));
    const absScriptsHooks = path.join(copilotBase, 'scripts', 'hooks').replace(/\\/g, '/');

    for (const hookFile of hookFiles) {
      const hookPath = path.join(hooksDir, hookFile);
      let content = fs.readFileSync(hookPath, 'utf8');
      content = content.replace(/\.\.\/\.\.\/schemas\/hooks\.schema\.json/g, '../schemas/hooks.schema.json');
      content = content.replace(/\.\.?\/scripts\/hooks\//g, `${absScriptsHooks}/`);
      fs.writeFileSync(hookPath, content);
    }
    console.log(`  Rewrote paths in ${hookFiles.length} hook files`);
  }

  // Install dependencies
  console.log('\n  Installing native dependencies...');
  const pkgJson = path.join(copilotBase, 'package.json');
  if (!fs.existsSync(pkgJson)) {
    state.createdDependencyPackage = true;
    fs.writeFileSync(pkgJson, JSON.stringify({
      name: 'copilot-hooks-deps',
      version: '1.0.0',
      private: true,
      description: 'Native dependencies for Copilot hook scripts'
    }, null, 2));
  }

  if (process.env.EGCOPILOT_SKIP_DEP_INSTALL === '1') {
    console.log('  Dependency installation skipped by EGCOPILOT_SKIP_DEP_INSTALL=1');
  } else {
    try {
      execSync(`npm install --no-audit --no-fund ${RUNTIME_DEPENDENCIES.join(' ')}`, {
        cwd: copilotBase,
        stdio: 'pipe'
      });
      console.log('  Dependencies installed successfully');
    } catch {
      console.log('  Warning: Failed to install dependencies. You can install manually:');
      console.log(`    cd ${copilotBase} && npm install ${RUNTIME_DEPENDENCIES.join(' ')}`);
    }
  }

  // Update VS Code settings
  console.log('\n  Updating VS Code settings...');
  const settings = mergeCopilotSettings(previousSettings, copilotSettings);
  writeVsSettings(vsSettings, settings);
  console.log('  VS Code settings updated');

  // Save install state
  saveInstallState(stateFile, state);

  console.log(`\n✅ Installation complete!`);
  console.log(`   Location: ${copilotBase}`);
  console.log(`   State file: ${stateFile}`);
  console.log(`   Copied items: ${totalCopied}`);
  console.log(`\nTo uninstall: everything-githubcopilot uninstall`);
}

function uninstall() {
  console.log('Uninstalling Everything GitHub Copilot (user-level)...\n');

  const { copilotBase, stateFile, vsSettings } = getPaths();

  if (!fs.existsSync(copilotBase)) {
    console.log('  Nothing to uninstall ( ~/.copilot/ not found )');
    return;
  }

  // Load state to restore previous settings
  const state = loadInstallState(stateFile);
  if (!state) {
    throw new Error('No installer state file found. Refusing to uninstall because ~/.copilot may contain unmanaged files.');
  }

  const managedPaths = Array.isArray(state.managedPaths) && state.managedPaths.length > 0
    ? state.managedPaths
    : DEFAULT_MANAGED_PATHS;
  const sortedManagedPaths = [...managedPaths].sort((left, right) => right.length - left.length);

  for (const relativePath of sortedManagedPaths) {
    resolveManagedPath(copilotBase, relativePath);
  }

  // Restore VS Code settings
  console.log('  Restoring VS Code settings...');
  const copilotSettings = getCopilotSettings();

  if (state && state.previousSettingsRaw !== null) {
    writeRawVsSettings(vsSettings, state.previousSettingsRaw);
    console.log('  VS Code settings restored from backup');
  } else if (state && state.hadVsSettings === false) {
    if (fs.existsSync(vsSettings)) {
      fs.rmSync(vsSettings, { force: true });
    }
    console.log('  VS Code settings file removed (none existed before install)');
  } else {
    const settingsFile = readVsSettingsFile(vsSettings);
    if (settingsFile.parseError) {
      throw new Error(`Unable to parse VS Code settings.json: ${settingsFile.parseError.message}`);
    }

    const settings = settingsFile.settings;
    const managedSettingKeys = Array.isArray(state.managedSettingKeys) && state.managedSettingKeys.length > 0
      ? state.managedSettingKeys
      : Object.keys(copilotSettings);

    for (const key of managedSettingKeys) {
      if (state && state.previousSettings && state.previousSettings[key] !== undefined) {
        settings[key] = state.previousSettings[key];
      } else {
        delete settings[key];
      }
    }

    writeVsSettings(vsSettings, settings);
    console.log('  VS Code settings restored');
  }

  // Remove only managed install artifacts
  console.log('  Removing managed ~/.copilot contents...');
  for (const relativePath of sortedManagedPaths) {
    const absolutePath = resolveManagedPath(copilotBase, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    fs.rmSync(absolutePath, { recursive: true, force: true });
    pruneEmptyParents(path.dirname(absolutePath), copilotBase);
  }

  removeInstallState(stateFile);
  if (fs.existsSync(copilotBase) && fs.readdirSync(copilotBase).length === 0) {
    fs.rmdirSync(copilotBase);
  }
  console.log('  Managed contents removed');

  console.log('\n✅ Uninstallation complete!');
}

function uninstallCodex() {
  console.log('Uninstalling Everything GitHub Copilot Codex assets (user-level)...\n');

  const { codexBase, codexStateFile } = getPaths();

  if (!fs.existsSync(codexBase)) {
    console.log('  Nothing to uninstall ( ~/.codex/ not found )');
    return;
  }

  const state = loadInstallState(codexStateFile);
  if (!state) {
    throw new Error('No Codex installer state file found. Refusing to uninstall because ~/.codex may contain unmanaged files.');
  }

  const managedPaths = Array.isArray(state.managedPaths) && state.managedPaths.length > 0
    ? state.managedPaths
    : USER_CODEX_INSTALL_MANIFEST.managedPaths;
  const sortedManagedPaths = [...managedPaths].sort((left, right) => right.length - left.length);

  for (const relativePath of sortedManagedPaths) {
    resolveManagedPathInBase(codexBase, relativePath, 'codex');
  }

  console.log('  Removing managed ~/.codex contents...');
  for (const relativePath of sortedManagedPaths) {
    const absolutePath = resolveManagedPathInBase(codexBase, relativePath, 'codex');
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    fs.rmSync(absolutePath, { recursive: true, force: true });
    pruneEmptyParents(path.dirname(absolutePath), codexBase);
  }

  removeInstallState(codexStateFile);
  if (fs.existsSync(codexBase) && fs.readdirSync(codexBase).length === 0) {
    fs.rmdirSync(codexBase);
  }

  console.log('\n✅ Codex user-level uninstallation complete!');
}

function reinstall() {
  console.log('Reinstalling Everything GitHub Copilot (user-level)...\n');

  const { copilotBase, stateFile } = getPaths();

  // Check if installed
  const isInstalled = fs.existsSync(copilotBase) && fs.existsSync(stateFile);

  if (isInstalled) {
    console.log('  Existing installation detected. Running uninstall first...\n');
    uninstall();
    console.log('');
  }

  console.log('  Running fresh install...\n');
  install();
}

function reinstallCodex() {
  console.log('Reinstalling Everything GitHub Copilot Codex assets (user-level)...\n');

  const { codexBase, codexStateFile } = getPaths();
  const isInstalled = fs.existsSync(codexBase) && fs.existsSync(codexStateFile);

  if (isInstalled) {
    console.log('  Existing Codex installation detected. Running uninstall first...\n');
    uninstallCodex();
    console.log('');
  }

  console.log('  Running fresh Codex install...\n');
  installCodex();
}

function copyRecursive(src, dst, excludeRelativePaths = [], currentRelativePath = '') {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    const entryRelativePath = currentRelativePath ? path.join(currentRelativePath, entry.name) : entry.name;

    if (excludeRelativePaths.includes(entryRelativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyRecursive(srcPath, dstPath, excludeRelativePaths, entryRelativePath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function countFiles(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

function printUsage() {
  console.log('Usage: everything-githubcopilot [install|uninstall|reinstall] [--provider copilot|codex|all]');
  console.log('\nCommands:');
  console.log('  install     Install user-level assets');
  console.log('  uninstall   Remove user-level installation');
  console.log('  reinstall   Uninstall then install fresh');
  console.log('\nProviders:');
  console.log('  copilot     Manage ~/.copilot/ and VS Code Copilot settings (default)');
  console.log('  codex       Manage ~/.codex/everything-githubcopilot and Codex global templates');
  console.log('  all         Run both provider installers');
}

function parseArgs(argv = process.argv) {
  const args = argv.slice(2);
  const command = args.shift() || 'install';
  let provider = 'copilot';

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--provider' || arg === '-p') {
      provider = args.shift();
      if (!provider) {
        throw new Error('--provider requires one of: copilot, codex, all');
      }
      continue;
    }

    if (arg.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!['install', 'uninstall', 'reinstall'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  if (!['copilot', 'codex', 'all'].includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return { command, provider };
}

function runCommand(command, provider) {
  const providers = provider === 'all' ? ['copilot', 'codex'] : [provider];

  for (const currentProvider of providers) {
    if (currentProvider === 'copilot') {
      if (command === 'install') {
        install();
      } else if (command === 'uninstall') {
        uninstall();
      } else {
        reinstall();
      }
      continue;
    }

    if (command === 'install') {
      installCodex();
    } else if (command === 'uninstall') {
      uninstallCodex();
    } else {
      reinstallCodex();
    }
  }
}

try {
  const { command, provider } = parseArgs();
  runCommand(command, provider);
} catch (error) {
  console.error(error.message);
  printUsage();
  process.exit(1);
}
