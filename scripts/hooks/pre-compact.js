#!/usr/bin/env node
'use strict';

/**
 * PreCompact hook — snapshot key workspace state before context compaction.
 *
 * Captures the current branch and modified files, persists to SQLite
 * (updating the active session record) and writes a markdown snapshot.
 *
 * Input (stdin JSON): { sessionId, timestamp, cwd, hookEventName, transcript_path }
 * Output: writes `.github/sessions/compact-snapshot.md`
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getContext, emit } = require('./_shared');
const db = require('./db');

const SESSIONS_DIR = path.join(process.cwd(), '.github', 'sessions');
const SNAPSHOT_FILE = path.join(SESSIONS_DIR, 'compact-snapshot.md');

const context = getContext();
const payload = context.payload || {};
const sessionId = payload.sessionId || 'unknown';
const timestamp = payload.timestamp || new Date().toISOString();

const lines = [
  '# Pre-Compact Snapshot',
  '',
  `- **Timestamp**: ${timestamp}`,
  `- **Session ID**: ${sessionId}`,
  `- **CWD**: ${payload.cwd || process.cwd()}`,
];

// Capture git branch
let branch = '';
try {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.status === 0 && result.stdout.trim()) {
    branch = result.stdout.trim();
    lines.push(`- **Branch**: ${branch}`);
  }
} catch {
  // git not available — skip
}

// Capture recently modified tracked files (last 10)
const modifiedFiles = [];
let totalModifiedFileCount = 0;
try {
  const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
  });
  if (diff.status === 0 && diff.stdout.trim()) {
    const allModifiedFiles = diff.stdout.trim().split('\n');
    totalModifiedFileCount = allModifiedFiles.length;
    modifiedFiles.push(...allModifiedFiles.slice(0, 10));
    lines.push(`- **Modified File Count**: ${totalModifiedFileCount}`);
    lines.push(`- **Displayed File Count**: ${modifiedFiles.length}`);
    lines.push(`- **Modified Files Truncated**: ${totalModifiedFileCount > modifiedFiles.length ? 'yes' : 'no'}`);
    lines.push('', '## Modified Files', '');
    for (const f of modifiedFiles) {
      lines.push(`- ${f}`);
    }
  }
} catch {
  // git not available — skip
}

// Persist to SQLite
const handle = db.open();
const shouldPersistSession = handle && sessionId !== 'unknown';

if (shouldPersistSession) {
  try {
    db.upsertSession(handle, {
      id: sessionId,
      branch: branch || undefined,
    });

    if (modifiedFiles.length > 0) {
      const fileRecords = modifiedFiles.map((fp) => ({
        filePath: fp,
        action: 'modified',
      }));
      db.insertSessionFiles(handle, sessionId, fileRecords);
    }
  } catch (err) {
    emit(`pre-compact: SQLite write failed: ${err.message}`, 'stderr');
  } finally {
    db.close();
  }
} else if (handle) {
  db.close();
}

// Always write markdown snapshot as well
try {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, lines.join('\n') + '\n', 'utf8');
} catch (err) {
  emit(`pre-compact: failed to write snapshot: ${err.message}`, 'stderr');
}

process.exit(0);
