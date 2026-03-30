#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { emit, fileExists, getContext, getFilePath, readFile, toWorkspacePath } = require('./_shared');

const context = getContext();
const filePath = toWorkspacePath(getFilePath(context));

if (!filePath || !fileExists(filePath)) {
  process.exit(0);
}

if (/\.(js|cjs|mjs)$/i.test(filePath)) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || '').trim();
    if (output) {
      emit(`Hook quality gate failed for ${filePath}\n${output}`, 'stderr');
    }
    process.exit(1);
  }
}

if (/\.json$/i.test(filePath)) {
  const content = readFile(filePath);
  if (!content) {
    process.exit(0);
  }

  try {
    JSON.parse(content);
  } catch (error) {
    emit(`Hook quality gate failed for ${filePath}\n${error.message}`, 'stderr');
    process.exit(1);
  }
}

process.exit(0);