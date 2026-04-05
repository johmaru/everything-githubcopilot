#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { getProjectInstallManifest, getRuntimeDependencies } = require('./manifest');

const PACKAGE_MANAGER_COMMANDS = {
  bun: (dependencies) => `bun add ${dependencies.join(' ')}`,
  npm: (dependencies) => `npm install --no-audit --no-fund ${dependencies.join(' ')}`,
  pnpm: (dependencies) => `pnpm add ${dependencies.join(' ')}`,
  yarn: (dependencies) => `yarn add ${dependencies.join(' ')}`,
};

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
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function copyPattern(sourceDir, targetDir, pattern, options = {}) {
  const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
  ensurePathInsideTargetRoot(options.targetRoot, targetDir);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !regex.test(entry.name)) {
      continue;
    }

    const targetPath = path.join(targetDir, entry.name);
    if (options.copyMissingOnly && fs.existsSync(targetPath)) {
      continue;
    }

    ensurePathInsideTargetRoot(options.targetRoot, targetPath);
    fs.copyFileSync(path.join(sourceDir, entry.name), targetPath);
  }
}

function copyProjectPayload(repoRoot, targetRoot) {
  const manifest = getProjectInstallManifest();
  const warnings = [];

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
      fs.copyFileSync(sourcePath, targetPath);
      continue;
    }

    if (operation.recursive) {
      copyRecursive(sourcePath, targetPath, { ...operation, targetRoot });
      continue;
    }

    if (operation.pattern) {
      copyPattern(sourcePath, targetPath, operation.pattern, { ...operation, targetRoot });
    }
  }

  return warnings;
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
    : (PACKAGE_MANAGER_COMMANDS[packageManager] || PACKAGE_MANAGER_COMMANDS.npm);

  return {
    packageManager,
    command: commandFactory(dependencies),
    dependencies,
    needsPackageJson: !packageJsonState.exists,
    canInstall: !packageJsonState.packageJsonParseError,
    packageJsonParseError: packageJsonState.packageJsonParseError,
  };
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

function main() {
  const repoRoot = path.join(__dirname, '..', '..');
  const targetRoot = resolveTarget(repoRoot, process.argv[2]);
  const dependencyPlan = getDependencyInstallPlan(targetRoot);

  if (process.env.EGCOPILOT_SKIP_DEP_INSTALL !== '1' && !dependencyPlan.canInstall) {
    throw new Error(dependencyPlan.packageJsonParseError);
  }

  const warnings = copyProjectPayload(repoRoot, targetRoot);
  ensureDependencyPackage(targetRoot);
  installDependencies(targetRoot);

  for (const warning of warnings) {
    console.log(warning);
  }

  console.log(`Project setup complete: ${targetRoot}`);
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
  installDependencies,
  main,
  resolveTarget,
};