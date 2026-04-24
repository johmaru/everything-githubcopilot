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

function findStringsByKeys(value, keys, matches = [], seen = new Set()) {
  if (typeof value === 'string') {
    return matches;
  }

  if (!value || typeof value !== 'object' || seen.has(value)) {
    return matches;
  }

  seen.add(value);
  const wanted = new Set(keys.map(normalizeKey));

  if (Array.isArray(value)) {
    for (const item of value) {
      findStringsByKeys(item, keys, matches, seen);
    }
    return matches;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === 'string' && wanted.has(normalizeKey(key)) && entryValue.trim()) {
      matches.push(entryValue.trim());
    }
  }

  for (const entryValue of Object.values(value)) {
    findStringsByKeys(entryValue, keys, matches, seen);
  }

  return matches;
}

function findStringByKeys(value, keys, seen = new Set()) {
  return findStringsByKeys(value, keys, [], seen)[0] || null;
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

function getUniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function collectExplicitFilePaths(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const editLists = [
    payload.tool_input && payload.tool_input.edits,
    payload.toolInput && payload.toolInput.edits,
    payload.edits,
  ];

  const editMatches = editLists
    .filter(Array.isArray)
    .flatMap((edits) => findStringsByKeys(edits, ['filePath', 'file_path', 'targetFile', 'target_path']));

  if (editMatches.length > 0) {
    return getUniqueStrings(editMatches);
  }

  const directSources = [payload.tool_input, payload.toolInput, payload];
  return getUniqueStrings(
    directSources
      .filter((source) => source && typeof source === 'object')
      .flatMap((source) => findStringsByKeys(source, ['filePath', 'file_path', 'targetFile', 'target_path']))
  );
}

function extractApplyPatchFilePaths(patchText) {
  if (typeof patchText !== 'string' || !patchText.trim()) {
    return [];
  }

  const filePaths = [];
  const headerPattern = /^\*\*\* (?:Add|Update|Delete) File:\s+(.+?)\s*$/u;
  const movePattern = /^\*\*\* Move to:\s+(.+?)\s*$/u;

  for (const line of patchText.split(/\r?\n/u)) {
    const match = line.match(headerPattern) || line.match(movePattern);
    if (!match) {
      continue;
    }

    const filePath = match[1].trim();
    if (filePath && filePath !== '/dev/null') {
      filePaths.push(filePath);
    }
  }

  return getUniqueStrings(filePaths);
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
  return getFilePaths(context)[0] || null;
}

function getFilePaths(context) {
  const payloadMatches = collectExplicitFilePaths(context.payload);
  if (payloadMatches.length > 0) {
    return payloadMatches;
  }

  const patchMatches = extractApplyPatchFilePaths(getCommandText(context));
  if (patchMatches.length > 0) {
    return patchMatches;
  }

  const envValue = findEnvValue(['toolInputFilePath', 'filePath', 'file_path', 'targetFile']);
  return envValue ? [envValue] : [];
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
  extractApplyPatchFilePaths,
  fileExists,
  getCommandText,
  getContext,
  getFilePath,
  getFilePaths,
  readFile,
  runLocalBin,
  toRelativeWorkspacePath,
  toWorkspacePath,
};
