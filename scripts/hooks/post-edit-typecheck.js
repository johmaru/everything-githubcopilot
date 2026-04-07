#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { emit, getContext, getFilePaths, runLocalBin } = require('./_shared');

const SESSION_ID_FILE = path.join(process.cwd(), '.github', 'sessions', '.current-session-id');

function resolveSessionId(context) {
  const payload = context.payload || {};
  if (payload && typeof payload === 'object') {
    const fromPayload = payload.sessionId || payload.session_id;
    if (typeof fromPayload === 'string' && fromPayload.trim()) {
      return fromPayload.trim();
    }
  }

  try {
    const persisted = fs.readFileSync(SESSION_ID_FILE, 'utf8').trim();
    if (persisted) {
      return persisted;
    }
  } catch {
    // ignore missing persisted session id
  }

  return 'unknown-session';
}

function getRunStateFilePath(sessionId) {
  const key = crypto
    .createHash('sha1')
    .update(`${process.cwd()}::${sessionId}`)
    .digest('hex');
  const stateDir = path.join(os.tmpdir(), 'egc-post-edit-typecheck');
  fs.mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, `${key}.token`);
}

function markLatestRun(stateFilePath, token) {
  fs.writeFileSync(stateFilePath, token, 'utf8');
}

function cleanupRunState(stateFilePath) {
  try {
    fs.rmSync(stateFilePath, { force: true });
  } catch {
    // non-fatal cleanup path
  }
}

function isLatestRun(stateFilePath, token) {
  try {
    return fs.readFileSync(stateFilePath, 'utf8') === token;
  } catch {
    return true;
  }
}

function isTypecheckRelevantFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return false;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const baseName = path.basename(normalizedPath).toLowerCase();

  if (/\.(ts|tsx)$/i.test(normalizedPath)) {
    return true;
  }

  return baseName === 'package.json'
    || baseName === 'jsconfig.json'
    || /^tsconfig(\..+)?\.json$/i.test(baseName);
}

const context = getContext();
const filePaths = getFilePaths(context);
const sessionId = resolveSessionId(context);

const stateFilePath = getRunStateFilePath(sessionId);

if (process.argv.includes('cleanup')) {
  cleanupRunState(stateFilePath);
  process.exit(0);
}

const runToken = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;

if (!filePaths.some((filePath) => isTypecheckRelevantFile(filePath))) {
  process.exit(0);
}

markLatestRun(stateFilePath, runToken);

const result = runLocalBin('tsc', ['--noEmit', '--pretty', 'false']);
if (!result) {
  emit('Hook warning: local tsc not found; skipping targeted TypeScript check');
  process.exit(0);
}

if (result && result.status !== 0) {
  if (!isLatestRun(stateFilePath, runToken)) {
    process.exit(0);
  }

  const output = (result.stdout || result.stderr || '').trim();
  if (output) {
    emit(`Hook warning: TypeScript check reported issues\n${output.split(/\r?\n/).slice(0, 10).join('\n')}`);
  }
}

process.exit(0);