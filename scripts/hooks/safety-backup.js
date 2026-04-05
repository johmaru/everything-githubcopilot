#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getContext } = require('./_shared');

const WORKSPACE_ROOT = process.cwd();
const SESSIONS_DIR = path.join(WORKSPACE_ROOT, '.github', 'sessions');
const BACKUPS_DIR = path.join(SESSIONS_DIR, 'safety-backups');
const SESSION_ID_FILE = path.join(SESSIONS_DIR, '.current-session-id');
const FORBIDDEN_SEGMENTS = new Set(['node_modules', '.git']);
const SESSION_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'backup',
  };

  for (let i = 3; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];

    switch (key) {
      case '--session-id':
        args.sessionId = next;
        i++;
        break;
      case '--file':
        args.filePath = next;
        i++;
        break;
      case '--reason':
        args.reason = next;
        i++;
        break;
      default:
        break;
    }
  }

  return args;
}

function resolveSessionId(explicitSessionId) {
  if (explicitSessionId) {
    return normalizeSessionId(explicitSessionId);
  }

  const context = getContext();
  const payload = context.payload || {};
  if (payload && typeof payload === 'object' && payload.sessionId) {
    return normalizeSessionId(payload.sessionId);
  }

  try {
    const persisted = fs.readFileSync(SESSION_ID_FILE, 'utf8').trim();
    if (persisted) {
      return normalizeSessionId(persisted);
    }
  } catch {
    // ignore missing file
  }

  return normalizeSessionId(crypto.randomUUID());
}

function normalizeSessionId(value) {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid session id');
  }
  return sessionId;
}

function isPathInsideWorkspace(targetPath) {
  const relativePath = path.relative(WORKSPACE_ROOT, targetPath);
  if (!relativePath || relativePath === '') {
    return true;
  }

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false;
  }

  const segments = relativePath.split(path.sep);
  return !segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment));
}

function isPathInsideBase(basePath, targetPath) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function ensureSafeTarget(filePath) {
  const absolutePath = path.resolve(WORKSPACE_ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Target does not exist: ${filePath}`);
  }

  const targetStats = fs.lstatSync(absolutePath);
  const resolvedPath = fs.realpathSync(absolutePath);

  if (targetStats.isDirectory()) {
    throw new Error(`Refusing to back up directories: ${filePath}`);
  }

  if (!isPathInsideWorkspace(absolutePath)) {
    throw new Error(`Refusing to back up paths outside the workspace: ${filePath}`);
  }

  if (!isPathInsideWorkspace(resolvedPath)) {
    throw new Error(`Refusing to back up symlinked paths outside the workspace: ${filePath}`);
  }

  if (targetStats.isSymbolicLink() && !isPathInsideWorkspace(resolvedPath)) {
    throw new Error(`Refusing to back up symbolic links outside the workspace: ${filePath}`);
  }

  if (isPathInsideBase(BACKUPS_DIR, absolutePath) || isPathInsideBase(BACKUPS_DIR, resolvedPath)) {
    throw new Error(`Refusing to back up an existing backup path: ${filePath}`);
  }

  return resolvedPath;
}

function manifestPathFor(sessionId) {
  const manifestPath = path.resolve(BACKUPS_DIR, `${sessionId}.json`);
  if (!isPathInsideBase(BACKUPS_DIR, manifestPath)) {
    throw new Error('Resolved manifest path escaped the backups directory');
  }
  return manifestPath;
}

function backupRootFor(sessionId) {
  const backupRoot = path.resolve(BACKUPS_DIR, sessionId);
  if (!isPathInsideBase(BACKUPS_DIR, backupRoot)) {
    throw new Error('Resolved backup path escaped the backups directory');
  }
  return backupRoot;
}

function loadManifest(sessionId) {
  const manifestPath = manifestPathFor(sessionId);
  if (!fs.existsSync(manifestPath)) {
    return {
      sessionId,
      createdAt: new Date().toISOString(),
      entries: [],
    };
  }

  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function saveManifest(sessionId, manifest) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.writeFileSync(manifestPathFor(sessionId), JSON.stringify(manifest, null, 2));
}

function copyTarget(sourcePath, destinationPath) {
  const stats = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

  if (stats.isDirectory()) {
    fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
    return 'directory';
  }

  fs.copyFileSync(sourcePath, destinationPath);
  return 'file';
}

function backup(args) {
  if (!args.filePath) {
    throw new Error('Error: --file is required for backup');
  }

  const sessionId = resolveSessionId(args.sessionId);
  const sourcePath = ensureSafeTarget(args.filePath);
  const relativeSourcePath = path.relative(WORKSPACE_ROOT, sourcePath);
  const backupPath = path.join(backupRootFor(sessionId), relativeSourcePath);
  const entryType = copyTarget(sourcePath, backupPath);
  const manifest = loadManifest(sessionId);
  const relativeBackupPath = path.relative(WORKSPACE_ROOT, backupPath).split(path.sep).join('/');
  const normalizedSourcePath = relativeSourcePath.split(path.sep).join('/');

  const nextEntry = {
    filePath: normalizedSourcePath,
    backupPath: relativeBackupPath,
    reason: args.reason || 'unspecified risk',
    type: entryType,
    createdAt: new Date().toISOString(),
  };

  manifest.entries = manifest.entries.filter((entry) => entry.filePath !== normalizedSourcePath);
  manifest.entries.push(nextEntry);
  saveManifest(sessionId, manifest);

  process.stdout.write(JSON.stringify({
    sessionId,
    filePath: normalizedSourcePath,
    backupPath: relativeBackupPath,
    reason: nextEntry.reason,
  }) + '\n');
}

function cleanup(args) {
  const sessionId = resolveSessionId(args.sessionId);
  const manifestPath = manifestPathFor(sessionId);

  if (!fs.existsSync(manifestPath)) {
    process.stdout.write(JSON.stringify({ sessionId, removedEntries: 0 }) + '\n');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const backupRoot = backupRootFor(sessionId);

  if (fs.existsSync(backupRoot)) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
  fs.rmSync(manifestPath, { force: true });

  process.stdout.write(JSON.stringify({
    sessionId,
    removedEntries: manifest.entries.length,
  }) + '\n');
}

function main() {
  const args = parseArgs(process.argv);

  switch (args.command) {
    case 'backup':
      backup(args);
      break;
    case 'cleanup':
      cleanup(args);
      break;
    default:
      throw new Error('Usage: node scripts/hooks/safety-backup.js <backup|cleanup> [--session-id <id>] [--file <path>] [--reason <text>]');
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}