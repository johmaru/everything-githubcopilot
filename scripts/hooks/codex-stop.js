#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { emit, getContext } = require('./_shared');

const SESSION_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const STOP_CHILD_SCRIPTS = [
  { fileName: 'session-stop.js', args: [] },
  { fileName: 'safety-backup.js', args: ['cleanup'] },
  { fileName: 'post-edit-typecheck.js', args: ['cleanup'] },
];

function hasWorkspaceMarkers(targetDir) {
  return fs.existsSync(path.join(targetDir, 'AGENTS.md'))
    && fs.existsSync(path.join(targetDir, '.codex', 'hooks.json'));
}

function resolveWorkspaceRoot(startDir) {
  let currentDir = path.resolve(startDir || process.cwd());

  while (true) {
    if (hasWorkspaceMarkers(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(startDir || process.cwd());
    }

    currentDir = parentDir;
  }
}

function formatWarning(child, result) {
  const stderrLine = typeof result.stderr === 'string'
    ? result.stderr.split(/\r?\n/u).map((line) => line.trim()).find(Boolean)
    : '';

  if (result.error && result.error.message) {
    return `${child.fileName} failed: ${result.error.message}`;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    return stderrLine
      ? `${child.fileName} exited with code ${result.status}: ${stderrLine}`
      : `${child.fileName} exited with code ${result.status}`;
  }

  if (result.signal) {
    return `${child.fileName} exited with signal ${result.signal}`;
  }

  if (stderrLine) {
    return `${child.fileName} reported: ${stderrLine}`;
  }

  return `${child.fileName} reported an unknown stop-hook failure`;
}

function buildStopHookResult(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return { continue: true };
  }

  const summary = warnings.slice(0, 3).join('; ');
  return {
    continue: true,
    systemMessage: `Codex stop cleanup warning: ${summary}`,
  };
}

function normalizeSessionId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const sessionId = value.trim();
  return SESSION_ID_PATTERN.test(sessionId) ? sessionId : null;
}

function resolveSessionId(workspaceRoot, payload) {
  if (payload && typeof payload === 'object') {
    const normalizedPayloadSessionId = normalizeSessionId(payload.sessionId) || normalizeSessionId(payload.session_id);
    if (normalizedPayloadSessionId) {
      return normalizedPayloadSessionId;
    }
  }

  try {
    const persisted = fs.readFileSync(path.join(workspaceRoot, '.github', 'sessions', '.current-session-id'), 'utf8').trim();
    const normalizedPersisted = normalizeSessionId(persisted);
    if (normalizedPersisted) {
      return normalizedPersisted;
    }
  } catch {
    // ignore missing session file
  }

  return null;
}

function parseRawInput(rawInput) {
  if (typeof rawInput !== 'string' || !rawInput.trim()) {
    return {};
  }

  try {
    const payload = JSON.parse(rawInput);
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

function buildChildInvocation(child, workspaceRoot, payload, sessionId) {
  if (child.fileName === 'safety-backup.js') {
    return {
      args: [path.join(workspaceRoot, 'scripts', 'hooks', child.fileName), ...child.args, ...(sessionId ? ['--session-id', sessionId] : [])],
      input: '',
    };
  }

  if (child.fileName === 'post-edit-typecheck.js') {
    return {
      args: [path.join(workspaceRoot, 'scripts', 'hooks', child.fileName), ...child.args],
      input: sessionId ? JSON.stringify({ sessionId }) : '',
    };
  }

  const sanitizedPayload = {
    cwd: workspaceRoot,
  };

  if (payload && typeof payload.cwd === 'string' && payload.cwd.trim()) {
    const resolvedCwd = path.resolve(payload.cwd.trim());
    const relativeCwd = path.relative(workspaceRoot, resolvedCwd);
    if (relativeCwd === '' || (!relativeCwd.startsWith('..') && !path.isAbsolute(relativeCwd))) {
      sanitizedPayload.cwd = resolvedCwd;
    }
  }

  if (sessionId) {
    sanitizedPayload.sessionId = sessionId;
  }
  if (payload && typeof payload.timestamp === 'string' && payload.timestamp.trim()) {
    sanitizedPayload.timestamp = payload.timestamp.trim();
  }
  if (payload && typeof payload.transcript_path === 'string' && payload.transcript_path.trim()) {
    const transcriptPath = payload.transcript_path.trim();
    if (path.isAbsolute(transcriptPath) && path.extname(transcriptPath).toLowerCase() === '.jsonl') {
      sanitizedPayload.transcript_path = transcriptPath;
    }
  }

  return {
    args: [path.join(workspaceRoot, 'scripts', 'hooks', child.fileName), ...child.args],
    input: JSON.stringify(sanitizedPayload),
  };
}

function runStopHooks(options = {}) {
  const workspaceRoot = options.workspaceRoot
    ? path.resolve(options.workspaceRoot)
    : resolveWorkspaceRoot(process.cwd());
  const nodeBinary = options.nodeBinary || process.execPath;
  const rawInput = typeof options.rawInput === 'string' ? options.rawInput : '';
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const payload = parseRawInput(rawInput);
  const sessionId = resolveSessionId(workspaceRoot, payload);
  const warnings = [];

  for (const child of STOP_CHILD_SCRIPTS) {
    const invocation = buildChildInvocation(child, workspaceRoot, payload, sessionId);
    const result = spawnSyncImpl(nodeBinary, invocation.args, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      input: invocation.input,
      shell: false,
    });

    if (result.error || result.status !== 0 || result.signal || (typeof result.stderr === 'string' && result.stderr.trim())) {
      warnings.push(formatWarning(child, result));
    }
  }

  return buildStopHookResult(warnings);
}

function main() {
  const context = getContext();
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const result = runStopHooks({
    workspaceRoot,
    rawInput: context.raw,
  });

  emit(JSON.stringify(result));
}

if (require.main === module) {
  main();
}

module.exports = {
  buildChildInvocation,
  buildStopHookResult,
  main,
  normalizeSessionId,
  parseRawInput,
  resolveWorkspaceRoot,
  runStopHooks,
  resolveSessionId,
  STOP_CHILD_SCRIPTS,
};