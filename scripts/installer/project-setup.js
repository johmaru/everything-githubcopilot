#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { getProjectInstallManifest, getRuntimeDependencies } = require('./manifest');
const LAUNCHER_ARTIFACTS_RELATIVE_PATH = '.github/sessions/codex-flow';
const LAUNCHER_CHECKPOINT_RELATIVE_PATH = '.github/sessions/checkpoint.md';
const LAUNCHER_CHECKPOINT_MARKER = 'X-Codex-Flow-Checkpoint: 1';

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

function stripWindowsLongPathPrefix(targetPath) {
  if (process.platform !== 'win32' || typeof targetPath !== 'string') {
    return targetPath;
  }

  return targetPath.replace(/^\\\\\?\\/, '');
}

function normalizeComparableAbsolutePath(targetPath) {
  const sanitizedPath = stripWindowsLongPathPrefix(targetPath);
  const resolvedPath = path.normalize(path.isAbsolute(sanitizedPath) ? sanitizedPath : path.resolve(sanitizedPath));
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function absolutePathsMatch(leftPath, rightPath) {
  return normalizeComparableAbsolutePath(leftPath) === normalizeComparableAbsolutePath(rightPath);
}

function getAllowedManagedRedirectTargets(targetRoot, relativePath) {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (normalizedRelativePath === '.agents/skills') {
    return [path.join(targetRoot, '.github', 'skills')];
  }

  if (normalizedRelativePath === '.codex/skills') {
    return [
      path.join(targetRoot, '.agents', 'skills'),
      path.join(targetRoot, '.github', 'skills'),
    ];
  }

  return [];
}

function getLinkTargetPath(targetPath) {
  try {
    const rawTarget = stripWindowsLongPathPrefix(fs.readlinkSync(targetPath));
    return path.isAbsolute(rawTarget)
      ? path.normalize(rawTarget)
      : path.resolve(path.dirname(targetPath), rawTarget);
  } catch {
    return null;
  }
}

function pathEntryExists(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function ensureManagedPathUsesCanonicalLocation(targetRoot, targetPath) {
  const resolvedTargetRoot = path.resolve(targetRoot);
  const resolvedTargetPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedTargetRoot, resolvedTargetPath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return;
  }

  let currentPath = resolvedTargetRoot;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);

    if (!pathEntryExists(currentPath)) {
      continue;
    }

    const currentRelativePath = normalizeRelativePath(path.relative(resolvedTargetRoot, currentPath));
    const allowedRedirectTargets = getAllowedManagedRedirectTargets(targetRoot, currentRelativePath);
    const explicitLinkTarget = getLinkTargetPath(currentPath);
    if (explicitLinkTarget) {
      if (absolutePathsMatch(explicitLinkTarget, currentPath)) {
        continue;
      }

      if (allowedRedirectTargets.some((allowedTarget) => absolutePathsMatch(explicitLinkTarget, allowedTarget))) {
        continue;
      }

      throw new Error(`refusing to access redirected managed path: ${currentPath}`);
    }

    const realCurrentPath = fs.realpathSync.native(currentPath);
    if (absolutePathsMatch(realCurrentPath, currentPath)) {
      continue;
    }

    if (allowedRedirectTargets.some((allowedTarget) => absolutePathsMatch(realCurrentPath, allowedTarget))) {
      continue;
    }

    throw new Error(`refusing to access redirected managed path: ${currentPath}`);
  }
}

function resolveRelativePath(targetRoot, relativePath, options = {}) {
  const targetPath = path.join(targetRoot, relativePath);
  ensurePathInsideTargetRoot(targetRoot, targetPath, options);
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

function removeGeneratedLauncherArtifacts(targetRoot, options = {}) {
  const launcherArtifactsPath = resolveRelativePath(targetRoot, LAUNCHER_ARTIFACTS_RELATIVE_PATH, options);
  ensureExistingPathResolvesInsideTargetRoot(targetRoot, launcherArtifactsPath);
  fs.rmSync(launcherArtifactsPath, { recursive: true, force: true });
  pruneEmptyParents(path.dirname(launcherArtifactsPath), targetRoot);
}

function removeGeneratedLauncherCheckpoint(targetRoot, options = {}) {
  const checkpointPath = resolveRelativePath(targetRoot, LAUNCHER_CHECKPOINT_RELATIVE_PATH, options);
  ensureExistingPathResolvesInsideTargetRoot(targetRoot, checkpointPath);

  if (!fs.existsSync(checkpointPath)) {
    return;
  }

  try {
    const checkpointContent = fs.readFileSync(checkpointPath, 'utf8');
    if (!(checkpointContent.includes(LAUNCHER_CHECKPOINT_MARKER) && /^Owner: codex-flow\//mu.test(checkpointContent))) {
      return;
    }
  } catch {
    return;
  }

  fs.rmSync(checkpointPath, { force: true });
  pruneEmptyParents(path.dirname(checkpointPath), targetRoot);
}

function restoreLauncherCheckpoint(targetRoot, backupRoot, launcherCheckpointState, options = {}) {
  if (launcherCheckpointState === undefined) {
    return null;
  }

  if (!launcherCheckpointState || launcherCheckpointState.hadPreexistingCheckpoint !== true) {
    removeGeneratedLauncherCheckpoint(targetRoot, options);
    return null;
  }

  const backupPath = getBackupPath(targetRoot, backupRoot, LAUNCHER_CHECKPOINT_RELATIVE_PATH);
  if (!fs.existsSync(backupPath)) {
    return LAUNCHER_CHECKPOINT_RELATIVE_PATH;
  }

  removeManagedFile(targetRoot, LAUNCHER_CHECKPOINT_RELATIVE_PATH, options);
  if (!restoreFileFromBackup(targetRoot, backupRoot, LAUNCHER_CHECKPOINT_RELATIVE_PATH, options)) {
    return LAUNCHER_CHECKPOINT_RELATIVE_PATH;
  }

  return null;
}

function restoreLauncherArtifacts(targetRoot, backupRoot, launcherArtifactState, options = {}) {
  if (launcherArtifactState === undefined) {
    return null;
  }

  if (!launcherArtifactState || launcherArtifactState.hadPreexistingArtifacts !== true) {
    removeGeneratedLauncherArtifacts(targetRoot, options);
    return null;
  }

  const backupPath = getBackupPath(targetRoot, backupRoot, LAUNCHER_ARTIFACTS_RELATIVE_PATH);
  if (!fs.existsSync(backupPath)) {
    return LAUNCHER_ARTIFACTS_RELATIVE_PATH;
  }

  const launcherArtifactsPath = resolveRelativePath(targetRoot, LAUNCHER_ARTIFACTS_RELATIVE_PATH, options);
  ensureExistingPathResolvesInsideTargetRoot(targetRoot, launcherArtifactsPath);
  fs.rmSync(launcherArtifactsPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(launcherArtifactsPath), { recursive: true });
  fs.cpSync(backupPath, launcherArtifactsPath, { recursive: true, force: true });
  return null;
}

function getRealPath(targetPath) {
  return fs.realpathSync.native(targetPath);
}

function pathsReferToSameLocation(leftPath, rightPath) {
  const resolvedLeftPath = getRealPath(leftPath);
  const resolvedRightPath = getRealPath(rightPath);

  if (process.platform === 'win32') {
    return resolvedLeftPath.toLowerCase() === resolvedRightPath.toLowerCase();
  }

  return resolvedLeftPath === resolvedRightPath;
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
  if (copiedFiles.includes(relativePath)) {
    return;
  }

  copiedFiles.push(relativePath);
}

function addPreservedDirectory(preservedDirectories, relativePath, stateRef = null) {
  if (preservedDirectories.includes(relativePath)) {
    return;
  }

  preservedDirectories.push(relativePath);
  if (stateRef) {
    stateRef.preservedDirectories = [...preservedDirectories];
  }
}

function collectPreexistingDirectories(targetRoot, relativePaths) {
  const existingDirectories = new Set();

  for (const relativePath of relativePaths) {
    const targetPath = path.join(targetRoot, relativePath);
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    const stats = fs.lstatSync(targetPath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      existingDirectories.add(normalizeRelativePath(relativePath));
    }
  }

  return existingDirectories;
}

function ensureBackupOfFile(targetRoot, backupRoot, targetPath, backupFiles, stateRef = null) {
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return;
  }

  ensurePathInsideTargetRoot(targetRoot, targetPath);

  const relativePath = normalizeRelativePath(path.relative(targetRoot, targetPath));
  if (backupFiles.has(relativePath)) {
    return;
  }

  const backupPath = getBackupPath(targetRoot, backupRoot, relativePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(targetPath, backupPath);
  addBackupFile(backupFiles, relativePath, stateRef);
}

function ensureBackupOfDirectory(targetRoot, backupRoot, relativePath) {
  const targetPath = resolveRelativePath(targetRoot, relativePath);

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    return false;
  }

  ensureExistingPathResolvesInsideTargetRoot(targetRoot, targetPath);

  const backupPath = getBackupPath(targetRoot, backupRoot, relativePath);
  if (fs.existsSync(backupPath)) {
    return true;
  }

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.cpSync(targetPath, backupPath, { recursive: true, force: true });
  return true;
}

function collectLauncherArtifactState(targetRoot, backupRoot) {
  const launcherArtifactsPath = resolveRelativePath(targetRoot, LAUNCHER_ARTIFACTS_RELATIVE_PATH);

  if (!fs.existsSync(launcherArtifactsPath)) {
    return {
      hadPreexistingArtifacts: false,
    };
  }

  ensureExistingPathResolvesInsideTargetRoot(targetRoot, launcherArtifactsPath);

  if (!fs.statSync(launcherArtifactsPath).isDirectory()) {
    throw new Error(`launcher artifact root must be a directory: ${launcherArtifactsPath}`);
  }

  return {
    hadPreexistingArtifacts: ensureBackupOfDirectory(targetRoot, backupRoot, LAUNCHER_ARTIFACTS_RELATIVE_PATH),
  };
}

function collectLauncherCheckpointState(targetRoot, backupRoot, backupFiles, stateRef = null) {
  const checkpointPath = resolveRelativePath(targetRoot, LAUNCHER_CHECKPOINT_RELATIVE_PATH);

  if (!fs.existsSync(checkpointPath)) {
    return {
      hadPreexistingCheckpoint: false,
    };
  }

  ensureExistingPathResolvesInsideTargetRoot(targetRoot, checkpointPath);

  if (!fs.statSync(checkpointPath).isFile()) {
    return {
      hadPreexistingCheckpoint: false,
    };
  }

  ensureBackupOfFile(targetRoot, backupRoot, checkpointPath, backupFiles, stateRef);
  return {
    hadPreexistingCheckpoint: true,
  };
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

function ensurePathInsideTargetRoot(targetRoot, targetPath, options = {}) {
  const resolvedTargetRoot = path.resolve(targetRoot);
  const resolvedTargetPath = path.resolve(targetPath);
  const realTargetRoot = fs.realpathSync.native(targetRoot);

  if (resolvedTargetPath !== resolvedTargetRoot && !resolvedTargetPath.startsWith(`${resolvedTargetRoot}${path.sep}`)) {
    throw new Error(`refusing to write outside the target root: ${targetPath}`);
  }

  let probePath = resolvedTargetPath;
  while (!pathEntryExists(probePath)) {
    const parentPath = path.dirname(probePath);
    if (parentPath === probePath) {
      break;
    }
    probePath = parentPath;
  }

  if (!options.allowManagedRedirects) {
    ensureManagedPathUsesCanonicalLocation(targetRoot, resolvedTargetPath);
  }

  const probeLinkTarget = getLinkTargetPath(probePath);
  if (probeLinkTarget) {
    const resolvedLinkTarget = path.resolve(probeLinkTarget);
    if (resolvedLinkTarget !== resolvedTargetRoot && !resolvedLinkTarget.startsWith(`${resolvedTargetRoot}${path.sep}`)) {
      throw new Error(`refusing to write outside the target root: ${targetPath}`);
    }

    return;
  }

  let realProbePath = null;
  try {
    realProbePath = fs.realpathSync.native(probePath);
  } catch {
    throw new Error(`refusing to access redirected managed path: ${targetPath}`);
  }

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

  if (getLinkTargetPath(packageJsonPath)) {
    throw new Error(`refusing to create package.json through redirected managed path: ${packageJsonPath}`);
  }

  ensurePathInsideTargetRoot(targetRoot, packageJsonPath);

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
    ensurePathInsideTargetRoot(targetRoot, packageJsonPath);
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
  const configuredManagedPaths = Array.isArray(manifest.managedPaths)
    ? manifest.managedPaths.map((managedPath) => normalizeRelativePath(managedPath))
    : [];

  return [
    ...manifest.copyOperations.map((operation) => normalizeRelativePath(operation.dst)),
    ...configuredManagedPaths,
  ];
}

function isManagedInstallPath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (normalizedPath === 'package.json'
    || normalizedPath === 'node_modules'
    || normalizedPath === LAUNCHER_CHECKPOINT_RELATIVE_PATH
    || LOCKFILE_NAMES.includes(normalizedPath)) {
    return true;
  }

  for (const destination of getAllowedManagedPrefixes()) {
    if (normalizedPath === destination || normalizedPath.startsWith(`${destination}/`)) {
      return true;
    }
  }

  return false;
}

function isManagedInstallPathOrAncestor(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (isManagedInstallPath(normalizedPath)) {
    return true;
  }

  return getAllowedManagedPrefixes().some((destination) => destination.startsWith(`${normalizedPath}/`));
}

function isLegacyInstallState(state) {
  return !Number.isInteger(state.version) || state.version < 2;
}

function validateInstallState(state) {
  if (!state || !Array.isArray(state.copiedFiles) || !Array.isArray(state.backupFiles)) {
    return false;
  }

  if (state.version !== undefined && (!Number.isInteger(state.version) || state.version < 1)) {
    return false;
  }

  if (state.preservedDirectories !== undefined && !Array.isArray(state.preservedDirectories)) {
    return false;
  }

  if (state.launcherArtifactState !== undefined) {
    if (!state.launcherArtifactState || typeof state.launcherArtifactState !== 'object') {
      return false;
    }

    if (typeof state.launcherArtifactState.hadPreexistingArtifacts !== 'boolean') {
      return false;
    }
  }

  if (state.launcherCheckpointState !== undefined) {
    if (!state.launcherCheckpointState || typeof state.launcherCheckpointState !== 'object') {
      return false;
    }

    if (typeof state.launcherCheckpointState.hadPreexistingCheckpoint !== 'boolean') {
      return false;
    }
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

  const managedPathsAreValid = [...state.copiedFiles, ...state.backupFiles].every((relativePath) => {
    return typeof relativePath === 'string' && relativePath.length > 0 && isManagedInstallPath(relativePath);
  });

  if (!managedPathsAreValid) {
    return false;
  }

  return (state.preservedDirectories || []).every((relativePath) => {
    return typeof relativePath === 'string' && relativePath.length > 0 && isManagedInstallPathOrAncestor(relativePath);
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

function ensureCanonicalDependencyArtifact(targetRoot, filePath) {
  if (getLinkTargetPath(filePath)) {
    throw new Error(`refusing to access redirected managed path: ${filePath}`);
  }

  if (fs.existsSync(filePath)) {
    ensurePathInsideTargetRoot(targetRoot, filePath);
  }
}

function validateDependencyArtifactsForUninstall(targetRoot, dependencyState) {
  if (!dependencyState) {
    return;
  }

  ensureCanonicalDependencyArtifact(targetRoot, path.join(targetRoot, 'package.json'));

  const lockfileNames = new Set([
    ...(dependencyState.preexistingLockfiles || []),
    ...(dependencyState.generatedLockfiles || []),
  ]);

  for (const lockfileName of lockfileNames) {
    ensureCanonicalDependencyArtifact(targetRoot, path.join(targetRoot, lockfileName));
  }
}

function uninstallDependencies(targetRoot, dependencyState, warnings) {
  if (!dependencyState || dependencyState.skippedDependencyInstall || !dependencyState.hadPackageJson) {
    return null;
  }

  validateDependencyArtifactsForUninstall(targetRoot, dependencyState);

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

function restoreFileFromBackup(targetRoot, backupRoot, relativePath, options = {}) {
  const backupPath = getBackupPath(targetRoot, backupRoot, relativePath);
  const targetPath = resolveRelativePath(targetRoot, relativePath, options);
  if (!fs.existsSync(backupPath)) {
    return false;
  }

  if (pathEntryExists(targetPath)) {
    const targetStats = fs.lstatSync(targetPath);
    if (targetStats.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    } else if (targetStats.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.rmSync(targetPath, { force: true });
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(backupPath, targetPath);
  return true;
}

function removeManagedFile(targetRoot, relativePath, options = {}) {
  const targetPath = resolveRelativePath(targetRoot, relativePath, options);
  if (!pathEntryExists(targetPath)) {
    return;
  }

  const targetStats = fs.lstatSync(targetPath);
  if (targetStats.isSymbolicLink()) {
    fs.unlinkSync(targetPath);
  } else if (targetStats.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.rmSync(targetPath, { force: true });
  }
  pruneEmptyParents(path.dirname(targetPath), targetRoot);
}

function restoreDependencyArtifacts(targetRoot, backupRoot, dependencyState, options = {}) {
  if (!dependencyState) {
    return [];
  }

  const restoreErrors = [];

  for (const lockfileName of dependencyState.generatedLockfiles || []) {
    removeManagedFile(targetRoot, lockfileName, options);
  }

  if (dependencyState.hadPackageJson) {
    if (!restoreFileFromBackup(targetRoot, backupRoot, 'package.json', options)) {
      restoreErrors.push('package.json');
    }
  } else if (dependencyState.createdPackageJson) {
    removeManagedFile(targetRoot, 'package.json', options);
  }

  for (const lockfileName of dependencyState.preexistingLockfiles || []) {
    if (!restoreFileFromBackup(targetRoot, backupRoot, lockfileName, options)) {
      restoreErrors.push(lockfileName);
    }
  }

  if (dependencyState.createdNodeModules) {
    removeManagedFile(targetRoot, 'node_modules', options);
  }

  return restoreErrors;
}

function restorePreservedDirectories(targetRoot, preservedDirectories, options = {}) {
  for (const relativePath of [...preservedDirectories].sort((left, right) => left.length - right.length)) {
    const targetPath = resolveRelativePath(targetRoot, relativePath, options);
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

function restoreProjectFromState(targetRoot, state, options = {}) {
  const { stateFile, backupRoot } = getProjectInstallPaths(targetRoot);
  const warnings = [];
  const restoreErrors = [];
  const restorePathOptions = { allowManagedRedirects: options.allowManagedRedirects === true };
  const dependencyRemovalError = uninstallDependencies(targetRoot, state.dependencyState, warnings);
  if (dependencyRemovalError) {
    restoreErrors.push(dependencyRemovalError);
  }

  const backupFiles = new Set(state.backupFiles || []);
  const copiedFiles = [...(state.copiedFiles || [])].sort((left, right) => right.length - left.length);
  const preservedDirectories = state.preservedDirectories || [];

  for (const relativePath of copiedFiles) {
    if (backupFiles.has(relativePath)) {
      if (!restoreFileFromBackup(targetRoot, backupRoot, relativePath, restorePathOptions)) {
        restoreErrors.push(relativePath);
      }
      continue;
    }

    removeManagedFile(targetRoot, relativePath, restorePathOptions);
  }

  restoreErrors.push(...restoreDependencyArtifacts(targetRoot, backupRoot, state.dependencyState, restorePathOptions));
  const launcherArtifactRestoreError = restoreLauncherArtifacts(
    targetRoot,
    backupRoot,
    state.launcherArtifactState,
    restorePathOptions
  );
  if (launcherArtifactRestoreError) {
    restoreErrors.push(launcherArtifactRestoreError);
  }
  const launcherCheckpointRestoreError = restoreLauncherCheckpoint(
    targetRoot,
    backupRoot,
    state.launcherCheckpointState,
    restorePathOptions
  );
  if (launcherCheckpointRestoreError) {
    restoreErrors.push(launcherCheckpointRestoreError);
  }

  if (restoreErrors.length > 0) {
    throw new Error(`Missing installer backups for: ${restoreErrors.join(', ')}`);
  }

  restorePreservedDirectories(targetRoot, preservedDirectories, restorePathOptions);

  if (!options.preserveArtifacts) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
    removeInstallState(stateFile);
  }

  return warnings;
}

function ensureSkillsJunction(targetRoot, backupRoot, stateRef = null, preexistingDirectories = new Set()) {
  const agentsDir = path.join(targetRoot, '.agents');
  const junctionPath = path.join(agentsDir, 'skills');
  const skillsSource = path.join(targetRoot, '.github', 'skills');
  const copiedFiles = stateRef ? stateRef.copiedFiles : [];
  const backupFiles = new Set(stateRef ? stateRef.backupFiles : []);
  const bridgeRelativePath = ' .agents/skills'.trim();
  const preservedDirectories = stateRef ? (stateRef.preservedDirectories || []) : [];
  const warnings = [];

  if (!fs.existsSync(skillsSource)) {
    return { warnings };
  }

  const liveLinkTarget = getLinkTargetPath(junctionPath);
  if (liveLinkTarget) {
    ensureExistingPathResolvesInsideTargetRoot(targetRoot, junctionPath);
    if (!absolutePathsMatch(liveLinkTarget, skillsSource)) {
      throw new Error('Existing .agents/skills link points to an unexpected target. Remove it and rerun project setup.');
    }

    if (preexistingDirectories.has('.github')) {
      addPreservedDirectory(preservedDirectories, '.github', stateRef);
    }
    if (preexistingDirectories.has('.github/skills')) {
      addPreservedDirectory(preservedDirectories, '.github/skills', stateRef);
    }

    return { warnings };
  }

  ensurePathInsideTargetRoot(targetRoot, agentsDir);
  ensurePathInsideTargetRoot(targetRoot, junctionPath);

  fs.mkdirSync(agentsDir, { recursive: true });

  let junctionStats = null;
  try {
    junctionStats = fs.lstatSync(junctionPath);
  } catch {
    junctionStats = null;
  }

  let hadExistingDirectory = false;
  if (junctionStats) {
    if (junctionStats.isSymbolicLink()) {
      if (fs.existsSync(junctionPath)) {
        ensureExistingPathResolvesInsideTargetRoot(targetRoot, junctionPath);
        if (!pathsReferToSameLocation(junctionPath, skillsSource)) {
          throw new Error('Existing .agents/skills link points to an unexpected target. Remove it and rerun project setup.');
        }

        return { warnings };
      }

      throw new Error('Cannot replace a broken .agents/skills symlink automatically. Remove it and rerun project setup.');
    } else if (junctionStats.isDirectory()) {
      hadExistingDirectory = true;
    } else {
      ensureBackupOfFile(targetRoot, backupRoot, junctionPath, backupFiles, stateRef);
      fs.rmSync(junctionPath, { force: true });
      addCopiedFile(copiedFiles, bridgeRelativePath);
      junctionStats = null;
    }
  }

  if (!junctionStats) {
    try {
      fs.symlinkSync(skillsSource, junctionPath, 'junction');
      addCopiedFile(copiedFiles, bridgeRelativePath);
      if (preexistingDirectories.has('.agents')) {
        addPreservedDirectory(preservedDirectories, '.agents', stateRef);
      }
      return {
        warnings,
        backupFiles: [...backupFiles],
      };
    } catch {
      warnings.push('Warning: .agents/skills junction could not be created - installed a copied skills bridge instead.');
    }
  }

  copyRecursive(skillsSource, junctionPath, {
    targetRoot,
    backupRoot,
    backupFiles,
    copiedFiles,
    stateRef,
  });

  if (!hadExistingDirectory) {
    addCopiedFile(copiedFiles, bridgeRelativePath);
  }

  if (preexistingDirectories.has('.agents')) {
    addPreservedDirectory(preservedDirectories, '.agents', stateRef);
  }
  if (preexistingDirectories.has('.agents/skills')) {
    addPreservedDirectory(preservedDirectories, '.agents/skills', stateRef);
  }

  if (stateRef) {
    stateRef.backupFiles = [...backupFiles];
  }

  return {
    warnings,
    backupFiles: [...backupFiles],
  };
}

function ensureCodexSkillsCompatibilityAlias(targetRoot, backupRoot, stateRef = null, preexistingDirectories = new Set()) {
  const codexDir = path.join(targetRoot, '.codex');
  const aliasPath = path.join(codexDir, 'skills');
  const primarySource = path.join(targetRoot, '.agents', 'skills');
  const allowedSources = [
    primarySource,
    path.join(targetRoot, '.github', 'skills'),
  ];
  const copiedFiles = stateRef ? stateRef.copiedFiles : [];
  const backupFiles = new Set(stateRef ? stateRef.backupFiles : []);
  const bridgeRelativePath = '.codex/skills';
  const preservedDirectories = stateRef ? (stateRef.preservedDirectories || []) : [];
  const warnings = [];

  if (!fs.existsSync(primarySource)) {
    return { warnings };
  }

  const liveLinkTarget = getLinkTargetPath(aliasPath);
  if (liveLinkTarget) {
    ensureExistingPathResolvesInsideTargetRoot(targetRoot, aliasPath);
    if (!allowedSources.some((sourcePath) => absolutePathsMatch(liveLinkTarget, sourcePath))) {
      throw new Error('Existing .codex/skills link points to an unexpected target. Remove it and rerun project setup.');
    }

    if (preexistingDirectories.has('.codex')) {
      addPreservedDirectory(preservedDirectories, '.codex', stateRef);
    }
    if (preexistingDirectories.has('.codex/skills')) {
      addPreservedDirectory(preservedDirectories, '.codex/skills', stateRef);
    }

    return { warnings };
  }

  ensurePathInsideTargetRoot(targetRoot, codexDir);
  ensurePathInsideTargetRoot(targetRoot, aliasPath);

  fs.mkdirSync(codexDir, { recursive: true });

  let aliasStats = null;
  try {
    aliasStats = fs.lstatSync(aliasPath);
  } catch {
    aliasStats = null;
  }

  let hadExistingDirectory = false;
  if (aliasStats) {
    if (aliasStats.isSymbolicLink()) {
      if (fs.existsSync(aliasPath)) {
        ensureExistingPathResolvesInsideTargetRoot(targetRoot, aliasPath);
        if (!allowedSources.some((sourcePath) => pathsReferToSameLocation(aliasPath, sourcePath))) {
          throw new Error('Existing .codex/skills link points to an unexpected target. Remove it and rerun project setup.');
        }

        return { warnings };
      }

      throw new Error('Cannot replace a broken .codex/skills symlink automatically. Remove it and rerun project setup.');
    } else if (aliasStats.isDirectory()) {
      hadExistingDirectory = true;
      if (fs.readdirSync(aliasPath).length > 0) {
        throw new Error('Existing .codex/skills directory must be empty. Remove it and rerun project setup.');
      }
    } else {
      ensureBackupOfFile(targetRoot, backupRoot, aliasPath, backupFiles, stateRef);
      fs.rmSync(aliasPath, { force: true });
      addCopiedFile(copiedFiles, bridgeRelativePath);
      aliasStats = null;
    }
  }

  if (!aliasStats) {
    try {
      fs.symlinkSync(primarySource, aliasPath, 'junction');
      addCopiedFile(copiedFiles, bridgeRelativePath);
      if (preexistingDirectories.has('.codex')) {
        addPreservedDirectory(preservedDirectories, '.codex', stateRef);
      }
      return {
        warnings,
        backupFiles: [...backupFiles],
      };
    } catch {
      warnings.push('Warning: .codex/skills compatibility alias could not be created - installed a copied Codex skills mirror instead.');
    }
  }

  copyRecursive(primarySource, aliasPath, {
    targetRoot,
    backupRoot,
    backupFiles,
    copiedFiles,
    stateRef,
  });

  if (!hadExistingDirectory) {
    addCopiedFile(copiedFiles, bridgeRelativePath);
  }

  if (preexistingDirectories.has('.codex')) {
    addPreservedDirectory(preservedDirectories, '.codex', stateRef);
  }
  if (preexistingDirectories.has('.codex/skills')) {
    addPreservedDirectory(preservedDirectories, '.codex/skills', stateRef);
  }

  if (stateRef) {
    stateRef.backupFiles = [...backupFiles];
  }

  return {
    warnings,
    backupFiles: [...backupFiles],
  };
}

function installProject(targetRoot) {
  const repoRoot = path.join(__dirname, '..', '..');
  const { stateFile, backupRoot } = getProjectInstallPaths(targetRoot);
  const preexistingDirectories = collectPreexistingDirectories(targetRoot, ['.github', '.github/skills', '.agents', '.agents/skills', '.codex', '.codex/skills']);

  if (fs.existsSync(stateFile)) {
    throw new Error('Existing project installer state found. Use reinstall or uninstall first.');
  }

  const transientState = {
    version: 2,
    installedAt: new Date().toISOString(),
    copiedFiles: [],
    backupFiles: [],
    preservedDirectories: [],
    launcherArtifactState: undefined,
    launcherCheckpointState: undefined,
    dependencyState: null,
  };

  if (preexistingDirectories.has('.github')) {
    addPreservedDirectory(transientState.preservedDirectories, '.github', transientState);
  }
  if (preexistingDirectories.has('.github/skills')) {
    addPreservedDirectory(transientState.preservedDirectories, '.github/skills', transientState);
  }
  if (preexistingDirectories.has('.codex')) {
    addPreservedDirectory(transientState.preservedDirectories, '.codex', transientState);
  }

  try {
    const dependencyPlan = getDependencyInstallPlan(targetRoot);
    if (process.env.EGCOPILOT_SKIP_DEP_INSTALL !== '1' && !dependencyPlan.canInstall) {
      throw new Error(dependencyPlan.packageJsonParseError);
    }

    transientState.launcherArtifactState = collectLauncherArtifactState(targetRoot, backupRoot);

    const launcherCheckpointBackupFiles = new Set(transientState.backupFiles);
    transientState.launcherCheckpointState = collectLauncherCheckpointState(
      targetRoot,
      backupRoot,
      launcherCheckpointBackupFiles,
      transientState
    );

    const payload = copyProjectPayload(repoRoot, targetRoot, backupRoot, transientState);
    const skillsBridge = ensureSkillsJunction(targetRoot, backupRoot, transientState, preexistingDirectories);
    const codexSkillsAlias = ensureCodexSkillsCompatibilityAlias(targetRoot, backupRoot, transientState, preexistingDirectories);

    if (skillsBridge.backupFiles) {
      transientState.backupFiles = skillsBridge.backupFiles;
    }
    if (codexSkillsAlias.backupFiles) {
      transientState.backupFiles = codexSkillsAlias.backupFiles;
    }

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

    for (const warning of skillsBridge.warnings || []) {
      console.log(warning);
    }
    for (const warning of codexSkillsAlias.warnings || []) {
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

  const warnings = restoreProjectFromState(targetRoot, state, {
    preserveArtifacts: false,
    allowManagedRedirects: isLegacyInstallState(state),
  });
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