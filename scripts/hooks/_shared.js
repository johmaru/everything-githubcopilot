'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readStdin() {
  if (process.stdin.isTTY) {
    return '';
  }

  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parsePayload(raw) {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function findStringByKeys(value, keys, seen = new Set()) {
  if (typeof value === 'string') {
    return null;
  }

  if (!value || typeof value !== 'object' || seen.has(value)) {
    return null;
  }

  seen.add(value);
  const wanted = new Set(keys.map(normalizeKey));

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findStringByKeys(item, keys, seen);
      if (match) {
        return match;
      }
    }
    return null;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === 'string' && wanted.has(normalizeKey(key)) && entryValue.trim()) {
      return entryValue.trim();
    }
  }

  for (const entryValue of Object.values(value)) {
    const match = findStringByKeys(entryValue, keys, seen);
    if (match) {
      return match;
    }
  }

  return null;
}

function findEnvValue(keys) {
  const wanted = keys.map(normalizeKey);

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) {
      continue;
    }

    const normalized = normalizeKey(key);
    if (wanted.some(target => normalized === target || normalized.endsWith(target))) {
      return value;
    }
  }

  return null;
}

function getContext() {
  const raw = readStdin();
  return {
    raw,
    payload: parsePayload(raw),
  };
}

function getCommandText(context) {
  if (typeof context.payload === 'string' && context.payload.trim()) {
    return context.payload.trim();
  }

  return findStringByKeys(context.payload, ['command', 'shellCommand', 'toolInputCommand'])
    || findEnvValue(['toolInputCommand', 'command']);
}

function getFilePath(context) {
  return findStringByKeys(context.payload, ['filePath', 'file_path', 'targetFile', 'target_path', 'path'])
    || findEnvValue(['toolInputFilePath', 'filePath', 'file_path', 'targetFile']);
}

function toWorkspacePath(filePath) {
  if (!filePath) {
    return null;
  }

  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function toRelativeWorkspacePath(filePath) {
  const absolutePath = toWorkspacePath(filePath);
  if (!absolutePath) {
    return null;
  }

  return path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function findLocalBin(name) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  const candidate = path.join(process.cwd(), 'node_modules', '.bin', `${name}${extension}`);
  return fs.existsSync(candidate) ? candidate : null;
}

function runLocalBin(name, args) {
  const binPath = findLocalBin(name);
  if (!binPath) {
    return null;
  }

  return spawnSync(binPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
}

function emit(message, stream = 'stdout') {
  const output = `${message}\n`;
  if (stream === 'stderr') {
    process.stderr.write(output);
    return;
  }

  process.stdout.write(output);
}

module.exports = {
  emit,
  fileExists,
  getCommandText,
  getContext,
  getFilePath,
  readFile,
  runLocalBin,
  toRelativeWorkspacePath,
  toWorkspacePath,
};