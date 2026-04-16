#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { getProjectInstallManifest, getRuntimeDependencies } = require('./manifest');

const PROJECT_INSTALL_STATE_FILE = '.everything-githubcopilot-project-install.json';
const PROJECT_INSTALL_BACKUP_DIR = '.everything-githubcopilot-project-install-backup';
const LOCKFILE_NAMES = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'];

const PACKAGE_MANAGER_INSTALL_COMMANDS = {
  bun: (dependencies) => `bun add ${dependencies.join(' ')}`,
  npm: (dependencies) => `npm install --no-audit --no-fund ${dependencies.join(' ')}`,
  pnpm: (dependencies) => `pnpm add ${dependencies.join(' ')}`,
  yarn: (dependencies) => `yarn add ${dependencies.join(' ')}`,
};

const PACKAGE_MANAGER_UNINSTALL_COMMANDS = {
  bun: (dependencies) => `bun remove ${dependencies.join(' ')}`,
  npm: (dependencies) => `npm uninstall --no-audit --no-fund ${dependencies.join(' ')}`,
  pnpm: (dependencies) => `pnpm remove ${dependencies.join(' ')}`,
  yarn: (dependencies) => `yarn remove ${dependencies.join(' ')}`,
};

function getProjectInstallPaths(targetRoot) {
  return {
    stateFile: path.join(targetRoot, PROJECT_INSTALL_STATE_FILE),
    backupRoot: path.join(targetRoot, PROJECT_INSTALL_BACKUP_DIR),
  };
}

function loadInstallState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function saveInstallState(stateFile, state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function removeInstallState(stateFile) {
  fs.rmSync(stateFile, { force: true });
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function resolveRelativePath(targetRoot, relativePath) {
  const targetPath = path.join(targetRoot, relativePath);
  ensurePathInsideTargetRoot(targetRoot, targetPath);
  return targetPath;
}

function getBackupPath(targetRoot, backupRoot, relativePath) {
  const backupPath = path.join(backupRoot, relativePath);
  ensurePathInsideTargetRoot(targetRoot, backupPath);
  return backupPath;
}

function ensureExistingPathResolvesInsideTargetRoot(targetRoot, targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const realTargetRoot = fs.realpathSync.native(targetRoot);
  const realTargetPath = fs.realpathSync.native(targetPath);
  if (realTargetPath !== realTargetRoot && !realTargetPath.startsWith(`${realTargetRoot}${path.sep}`)) {
    throw new Error(`refusing to access symlinked content outside the target root: ${targetPath}`);
  }
}

function addBackupFile(backupFiles, relativePath, stateRef) {
  if (backupFiles.has(relativePath)) {
    return;
  }

  backupFiles.add(relativePath);
  if (stateRef) {
    stateRef.backupFiles = [...backupFiles];
  }
}

function addCopiedFile(copiedFiles, relativePath) {
  copiedFiles.push(relativePath);
}

function ensureBackupOfFile(targetRoot, backupRoot, targetPath, backupFiles, stateRef = null) {
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return;
  }

  ensureExistingPathResolvesInsideTargetRoot(targetRoot, targetPath);

  const relativePath = normalizeRelativePath(path.relative(targetRoot, targetPath));
  if (backupFiles.has(relativePath)) {
    return;
  }

  const backupPath = getBackupPath(targetRoot, backupRoot, relativePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(targetPath, backupPath);
  addBackupFile(backupFiles, relativePath, stateRef);
}

function resolveTarget(repoRoot, rawTarget) {
  if (!rawTarget) {
    throw new Error('target argument is required');
  }

  const target = path.resolve(rawTarget);
  const resolvedRepoRoot = path.resolve(repoRoot);

  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`Target directory does not exist: ${target}`);
  }

  if (target.startsWith(`${resolvedRepoRoot}${path.sep}`)) {
    throw new Error('target must be outside the source repository');
  }

  if (fs.realpathSync.native(target) === fs.realpathSync.native(repoRoot)) {
    throw new Error('target is the same as the source repository');
  }

  if (fs.realpathSync.native(target).startsWith(`${fs.realpathSync.native(repoRoot)}${path.sep}`)) {
    throw new Error('target must be outside the source repository');
  }

  return target;
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

function ensurePathInsideTargetRoot(targetRoot, targetPath) {
  const resolvedTargetRoot = path.resolve(targetRoot);
  const resolvedTargetPath = path.resolve(targetPath);
  const realTargetRoot = fs.realpathSync.native(targetRoot);

  if (resolvedTargetPath !== resolvedTargetRoot && !resolvedTargetPath.startsWith(`${resolvedTargetRoot}${path.sep}`)) {
    throw new Error(`refusing to write outside the target root: ${targetPath}`);
  }

  let probePath = resolvedTargetPath;
  while (!fs.existsSync(probePath)) {
    const parentPath = path.dirname(probePath);
    if (parentPath === probePath) {
      break;
    }
    probePath = parentPath;
  }

  const realProbePath = fs.realpathSync.native(probePath);
  if (realProbePath !== realTargetRoot && !realProbePath.startsWith(`${realTargetRoot}${path.sep}`)) {
    throw new Error(`refusing to write outside the target root: ${targetPath}`);
  }
}

function copyRecursive(sourceDir, targetDir, options = {}, currentRelativePath = '') {
  ensurePathInsideTargetRoot(options.targetRoot, targetDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const copiedFiles = options.copiedFiles || [];

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const entryRelativePath = currentRelativePath ? path.join(currentRelativePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (Array.isArray(options.excludeRelativePaths) && options.excludeRelativePaths.includes(entryRelativePath)) {
        continue;
      }

      copyRecursive(sourcePath, targetPath, options, entryRelativePath);
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    ensurePathInsideTargetRoot(options.targetRoot, targetPath);
    ensureBackupOfFile(options.targetRoot, options.backupRoot, targetPath, options.backupFiles, options.stateRef);
    fs.copyFileSync(sourcePath, targetPath);
    addCopiedFile(copiedFiles, normalizeRelativePath(path.relative(options.targetRoot, targetPath)));
  }

  return copiedFiles;
}

function copyPattern(sourceDir, targetDir, pattern, options = {}) {
  const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
  ensurePathInsideTargetRoot(options.targetRoot, targetDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const copiedFiles = options.copiedFiles || [];

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !regex.test(entry.name)) {
      continue;
    }

    const targetPath = path.join(targetDir, entry.name);
    if (options.copyMissingOnly && fs.existsSync(targetPath)) {
      continue;
    }

    ensurePathInsideTargetRoot(options.targetRoot, targetPath);
    ensureBackupOfFile(options.targetRoot, options.backupRoot, targetPath, options.backupFiles, options.stateRef);
    fs.copyFileSync(path.join(sourceDir, entry.name), targetPath);
    addCopiedFile(copiedFiles, normalizeRelativePath(path.relative(options.targetRoot, targetPath)));
  }

  return copiedFiles;
}

function copyProjectPayload(repoRoot, targetRoot, backupRoot, stateRef = null) {
  const manifest = getProjectInstallManifest();
  const warnings = [];
  const copiedFiles = stateRef ? stateRef.copiedFiles : [];
  const backupFiles = new Set(stateRef ? stateRef.backupFiles : []);

  for (const operation of manifest.copyOperations) {
    const sourcePath = path.join(repoRoot, operation.src);
    const targetPath = path.join(targetRoot, operation.dst);

    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    if (operation.skipIfExists && fs.existsSync(targetPath)) {
      warnings.push(`Warning: ${operation.dst} already exists - not overwritten.`);
      continue;
    }

    if (operation.single) {
      ensurePathInsideTargetRoot(targetRoot, targetPath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      ensureBackupOfFile(targetRoot, backupRoot, targetPath, backupFiles, stateRef);
      fs.copyFileSync(sourcePath, targetPath);
      addCopiedFile(copiedFiles, normalizeRelativePath(path.relative(targetRoot, targetPath)));
      continue;
    }

    if (operation.recursive) {
      copyRecursive(sourcePath, targetPath, {
        ...operation,
        targetRoot,
        backupRoot,
        backupFiles,
        copiedFiles,
        stateRef,
      });
      continue;
    }

    if (operation.pattern) {
      copyPattern(sourcePath, targetPath, operation.pattern, {
        ...operation,
        targetRoot,
        backupRoot,
        backupFiles,
        copiedFiles,
        stateRef,
      });
    }
  }

  return {
    warnings,
    copiedFiles,
    backupFiles: [...backupFiles],
  };
}

function ensureDependencyPackage(targetRoot) {
  const packageJsonPath = path.join(targetRoot, 'package.json');

  if (fs.existsSync(packageJsonPath)) {
    return false;
  }

  fs.writeFileSync(packageJsonPath, JSON.stringify({ private: true }, null, 2));
  return true;
}

function readPackageJson(targetRoot) {
  const packageJsonPath = path.join(targetRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return {
      exists: false,
      packageJson: null,
      packageJsonParseError: null,
    };
  }

  try {
    const rawPackageJson = fs.readFileSync(packageJsonPath, 'utf8').replace(/^\uFEFF/, '');
    return {
      exists: true,
      packageJson: JSON.parse(rawPackageJson),
      packageJsonParseError: null,
    };
  } catch (error) {
    return {
      exists: true,
      packageJson: null,
      packageJsonParseError: `Unable to parse target package.json: ${error.message}`,
    };
  }
}

function normalizePackageManager(packageManager) {
  if (typeof packageManager !== 'string') {
    return null;
  }

  const normalized = packageManager.trim().toLowerCase();

  if (normalized.startsWith('bun@')) {
    return 'bun';
  }

  if (normalized.startsWith('npm@')) {
    return 'npm';
  }

  if (normalized.startsWith('pnpm@')) {
    return 'pnpm';
  }

  if (normalized.startsWith('yarn@')) {
    return 'yarn';
  }

  return null;
}

function detectPackageManager(targetRoot) {
  const packageJsonState = readPackageJson(targetRoot);
  if (packageJsonState.packageJson) {
    const packageManager = normalizePackageManager(packageJsonState.packageJson.packageManager);

    if (packageManager) {
      return packageManager;
    }
  }

  if (fs.existsSync(path.join(targetRoot, 'bun.lockb')) || fs.existsSync(path.join(targetRoot, 'bun.lock'))) {
    return 'bun';
  }

  if (fs.existsSync(path.join(targetRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  if (fs.existsSync(path.join(targetRoot, 'yarn.lock'))) {
    return 'yarn';
  }

  if (fs.existsSync(path.join(targetRoot, 'package-lock.json')) || fs.existsSync(path.join(targetRoot, 'npm-shrinkwrap.json'))) {
    return 'npm';
  }

  return 'npm';
}

function getDependencyInstallPlan(targetRoot) {
  const dependencies = getRuntimeDependencies();
  const packageJsonState = readPackageJson(targetRoot);
  const packageManager = detectPackageManager(targetRoot);
  const isPnpmWorkspaceRoot = packageManager === 'pnpm' && fs.existsSync(path.join(targetRoot, 'pnpm-workspace.yaml'));
  const commandFactory = isPnpmWorkspaceRoot
    ? (dependencyList) => `pnpm add -w ${dependencyList.join(' ')}`
    : (PACKAGE_MANAGER_INSTALL_COMMANDS[packageManager] || PACKAGE_MANAGER_INSTALL_COMMANDS.npm);

  return {
    packageManager,
    command: commandFactory(dependencies),
    dependencies,
    needsPackageJson: !packageJsonState.exists,
    canInstall: !packageJsonState.packageJsonParseError,
    packageJsonParseError: packageJsonState.packageJsonParseError,
  };
}

function getDependencyUninstallPlan(targetRoot, packageManagerOverride = null) {
  const dependencies = getRuntimeDependencies();
  const packageManager = packageManagerOverride || detectPackageManager(targetRoot);
  const isPnpmWorkspaceRoot = packageManager === 'pnpm' && fs.existsSync(path.join(targetRoot, 'pnpm-workspace.yaml'));
  const commandFactory = isPnpmWorkspaceRoot
    ? (dependencyList) => `pnpm remove -w ${dependencyList.join(' ')}`
    : (PACKAGE_MANAGER_UNINSTALL_COMMANDS[packageManager] || PACKAGE_MANAGER_UNINSTALL_COMMANDS.npm);

  return {
    packageManager,
    command: commandFactory(dependencies),
    dependencies,
  };
}

function collectDependencyState(targetRoot, backupRoot, backupFiles) {
  const packageJsonPath = path.join(targetRoot, 'package.json');
  const hadPackageJson = fs.existsSync(packageJsonPath);
  if (hadPackageJson) {
    ensureBackupOfFile(targetRoot, backupRoot, packageJsonPath, backupFiles);
  }

  const preexistingLockfiles = LOCKFILE_NAMES.filter((lockfileName) => {
    const lockfilePath = path.join(targetRoot, lockfileName);
    if (!fs.existsSync(lockfilePath)) {
      return false;
    }

    ensureBackupOfFile(targetRoot, backupRoot, lockfilePath, backupFiles);
    return true;
  });

  return {
    skippedDependencyInstall: process.env.EGCOPILOT_SKIP_DEP_INSTALL === '1',
    packageManager: detectPackageManager(targetRoot),
    hadPackageJson,
    createdPackageJson: false,
    preexistingLockfiles,
    generatedLockfiles: [],
    hadNodeModules: fs.existsSync(path.join(targetRoot, 'node_modules')),
    createdNodeModules: false,
  };
}

function getAllowedManagedPrefixes() {
  const manifest = getProjectInstallManifest();
  return manifest.copyOperations.map((operation) => normalizeRelativePath(operation.dst));
}

function isManagedInstallPath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (normalizedPath === 'package.json' || normalizedPath === 'node_modules' || LOCKFILE_NAMES.includes(normalizedPath)) {
    return true;
  }

  for (const destination of getAllowedManagedPrefixes()) {
    if (normalizedPath === destination || normalizedPath.startsWith(`${destination}/`)) {
      return true;
    }
  }

  return false;
}

function validateInstallState(state) {
  if (!state || !Array.isArray(state.copiedFiles) || !Array.isArray(state.backupFiles)) {
    return false;
  }

  if (state.dependencyState !== null && state.dependencyState !== undefined) {
    const dependencyState = state.dependencyState;
    const validPackageManagers = new Set(['bun', 'npm', 'pnpm', 'yarn']);
    if (!dependencyState || typeof dependencyState !== 'object') {
      return false;
    }

    if (!validPackageManagers.has(dependencyState.packageManager)
      || typeof dependencyState.skippedDependencyInstall !== 'boolean'
      || typeof dependencyState.hadPackageJson !== 'boolean'
      || typeof dependencyState.createdPackageJson !== 'boolean'
      || typeof dependencyState.hadNodeModules !== 'boolean'
      || typeof dependencyState.createdNodeModules !== 'boolean'
      || !Array.isArray(dependencyState.preexistingLockfiles)
      || !Array.isArray(dependencyState.generatedLockfiles)
      || !dependencyState.preexistingLockfiles.every((name) => LOCKFILE_NAMES.includes(name))
      || !dependencyState.generatedLockfiles.every((name) => LOCKFILE_NAMES.includes(name))) {
      return false;
    }
  }

  return [...state.copiedFiles, ...state.backupFiles].every((relativePath) => {
    return typeof relativePath === 'string' && relativePath.length > 0 && isManagedInstallPath(relativePath);
  });
}

function finalizeDependencyState(targetRoot, dependencyState) {
  dependencyState.generatedLockfiles = LOCKFILE_NAMES.filter((lockfileName) => {
    return fs.existsSync(path.join(targetRoot, lockfileName)) && !dependencyState.preexistingLockfiles.includes(lockfileName);
  });
  dependencyState.createdNodeModules = !dependencyState.hadNodeModules && fs.existsSync(path.join(targetRoot, 'node_modules'));
}

function installDependencies(targetRoot) {
  if (process.env.EGCOPILOT_SKIP_DEP_INSTALL === '1') {
    return;
  }

  const plan = getDependencyInstallPlan(targetRoot);

  if (!plan.canInstall) {
    throw new Error(plan.packageJsonParseError);
  }

  execSync(plan.command, {
    cwd: targetRoot,
    stdio: 'pipe',
  });
}

function uninstallDependencies(targetRoot, dependencyState, warnings) {
  if (!dependencyState || dependencyState.skippedDependencyInstall || !dependencyState.hadPackageJson) {
    return null;
  }

  const plan = getDependencyUninstallPlan(targetRoot, dependencyState.packageManager);

  try {
    execSync(plan.command, {
      cwd: targetRoot,
      stdio: 'pipe',
    });
  } catch (error) {
    const message = `Warning: Failed to remove runtime dependencies automatically (${error.message.split(/\r?\n/)[0]}).`;
    if (dependencyState.hadNodeModules) {
      return message;
    }

    warnings.push(`${message} Continuing because the install created its own dependency tree.`);
  }

  return null;
}

function restoreFileFromBackup(targetRoot, backupRoot, relativePath) {
  const backupPath = getBackupPath(targetRoot, backupRoot, relativePath);
  const targetPath = resolveRelativePath(targetRoot, relativePath);
  if (!fs.existsSync(backupPath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(backupPath, targetPath);
  return true;
}

function removeManagedFile(targetRoot, relativePath) {
  const targetPath = resolveRelativePath(targetRoot, relativePath);
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  pruneEmptyParents(path.dirname(targetPath), targetRoot);
}

function restoreDependencyArtifacts(targetRoot, backupRoot, dependencyState) {
  if (!dependencyState) {
    return [];
  }

  const restoreErrors = [];

  for (const lockfileName of dependencyState.generatedLockfiles || []) {
    removeManagedFile(targetRoot, lockfileName);
  }

  if (dependencyState.hadPackageJson) {
    if (!restoreFileFromBackup(targetRoot, backupRoot, 'package.json')) {
      restoreErrors.push('package.json');
    }
  } else if (dependencyState.createdPackageJson) {
    removeManagedFile(targetRoot, 'package.json');
  }

  for (const lockfileName of dependencyState.preexistingLockfiles || []) {
    if (!restoreFileFromBackup(targetRoot, backupRoot, lockfileName)) {
      restoreErrors.push(lockfileName);
    }
  }

  if (dependencyState.createdNodeModules) {
    removeManagedFile(targetRoot, 'node_modules');
  }

  return restoreErrors;
}

function restoreProjectFromState(targetRoot, state, options = {}) {
  const { stateFile, backupRoot } = getProjectInstallPaths(targetRoot);
  const warnings = [];
  const restoreErrors = [];
  const dependencyRemovalError = uninstallDependencies(targetRoot, state.dependencyState, warnings);
  if (dependencyRemovalError) {
    restoreErrors.push(dependencyRemovalError);
  }

  const backupFiles = new Set(state.backupFiles || []);
  const copiedFiles = [...(state.copiedFiles || [])].sort((left, right) => right.length - left.length);

  for (const relativePath of copiedFiles) {
    if (backupFiles.has(relativePath)) {
      if (!restoreFileFromBackup(targetRoot, backupRoot, relativePath)) {
        restoreErrors.push(relativePath);
      }
      continue;
    }

    removeManagedFile(targetRoot, relativePath);
  }

  restoreErrors.push(...restoreDependencyArtifacts(targetRoot, backupRoot, state.dependencyState));

  if (restoreErrors.length > 0) {
    throw new Error(`Missing installer backups for: ${restoreErrors.join(', ')}`);
  }

  if (!options.preserveArtifacts) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
    removeInstallState(stateFile);
  }

  return warnings;
}

function ensureSkillsJunction(targetRoot) {
  const agentsDir = path.join(targetRoot, '.agents');
  const junctionPath = path.join(agentsDir, 'skills');
  const skillsSource = path.join(targetRoot, '.github', 'skills');

  if (!fs.existsSync(skillsSource)) {
    return;
  }

  fs.mkdirSync(agentsDir, { recursive: true });

  if (fs.existsSync(junctionPath)) {
    const stat = fs.lstatSync(junctionPath);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      return;
    }
  }

  try {
    fs.symlinkSync(skillsSource, junctionPath, 'junction');
  } catch {
    // junction creation may fail on some systems; not fatal
  }
}

function installProject(targetRoot) {
  const repoRoot = path.join(__dirname, '..', '..');
  const { stateFile, backupRoot } = getProjectInstallPaths(targetRoot);

  if (fs.existsSync(stateFile)) {
    throw new Error('Existing project installer state found. Use reinstall or uninstall first.');
  }

  const transientState = {
    version: 1,
    installedAt: new Date().toISOString(),
    copiedFiles: [],
    backupFiles: [],
    dependencyState: null,
  };

  try {
    const dependencyPlan = getDependencyInstallPlan(targetRoot);
    if (process.env.EGCOPILOT_SKIP_DEP_INSTALL !== '1' && !dependencyPlan.canInstall) {
      throw new Error(dependencyPlan.packageJsonParseError);
    }

    const payload = copyProjectPayload(repoRoot, targetRoot, backupRoot, transientState);

    ensureSkillsJunction(targetRoot);

    const backupFiles = new Set(transientState.backupFiles);
    const dependencyState = collectDependencyState(targetRoot, backupRoot, backupFiles);
    transientState.backupFiles = [...backupFiles];
    transientState.dependencyState = dependencyState;

    dependencyState.createdPackageJson = ensureDependencyPackage(targetRoot);
    installDependencies(targetRoot);
    finalizeDependencyState(targetRoot, dependencyState);

    transientState.backupFiles = [...backupFiles];
    transientState.dependencyState = dependencyState;

    saveInstallState(stateFile, transientState);

    for (const warning of payload.warnings) {
      console.log(warning);
    }

    console.log(`Project setup complete: ${targetRoot}`);
  } catch (error) {
    try {
      if (transientState.dependencyState) {
        finalizeDependencyState(targetRoot, transientState.dependencyState);
      }
      restoreProjectFromState(targetRoot, transientState, { preserveArtifacts: false });
    } catch {
      // best effort rollback after failed install
    }

    throw error;
  }
}

function uninstallProject(targetRoot) {
  const { stateFile } = getProjectInstallPaths(targetRoot);
  const state = loadInstallState(stateFile);

  if (!state) {
    throw new Error('No installer state file found. Refusing to uninstall because target may contain unmanaged files.');
  }

  if (!validateInstallState(state)) {
    throw new Error('Installer state file is invalid or references unmanaged paths. Refusing to uninstall.');
  }

  const warnings = restoreProjectFromState(targetRoot, state, { preserveArtifacts: false });
  for (const warning of warnings) {
    console.log(warning);
  }

  console.log(`Project uninstall complete: ${targetRoot}`);
}

function reinstallProject(targetRoot) {
  const { stateFile } = getProjectInstallPaths(targetRoot);

  if (fs.existsSync(stateFile)) {
    console.log('Existing installation detected. Running uninstall first...');
    uninstallProject(targetRoot);
  }

  installProject(targetRoot);
}

function parseCommand(argv) {
  const explicitCommand = argv[2];
  if (['install', 'uninstall', 'reinstall'].includes(explicitCommand)) {
    return {
      command: explicitCommand,
      targetArg: argv[3],
    };
  }

  if (argv[3] !== undefined) {
    throw new Error('Usage: node scripts/installer/project-setup.js [install|uninstall|reinstall] <target>');
  }

  return {
    command: 'install',
    targetArg: explicitCommand,
  };
}

function main() {
  const repoRoot = path.join(__dirname, '..', '..');
  const { command, targetArg } = parseCommand(process.argv);
  const targetRoot = resolveTarget(repoRoot, targetArg);

  switch (command) {
    case 'install':
      installProject(targetRoot);
      break;
    case 'uninstall':
      uninstallProject(targetRoot);
      break;
    case 'reinstall':
      reinstallProject(targetRoot);
      break;
    default:
      throw new Error('Usage: node scripts/installer/project-setup.js [install|uninstall|reinstall] <target>');
  }
}

try {
  if (require.main === module) {
    main();
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

module.exports = {
  copyProjectPayload,
  detectPackageManager,
  getDependencyInstallPlan,
  getDependencyUninstallPlan,
  installDependencies,
  installProject,
  main,
  resolveTarget,
  uninstallProject,
};