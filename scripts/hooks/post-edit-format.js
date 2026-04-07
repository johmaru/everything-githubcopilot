#!/usr/bin/env node
'use strict';

const { emit, fileExists, getContext, getFilePaths, runLocalBin, toWorkspacePath } = require('./_shared');

const context = getContext();
const filePaths = [...new Set(getFilePaths(context)
  .map(toWorkspacePath)
  .filter((filePath) => filePath && fileExists(filePath) && /\.(ts|tsx|js|jsx)$/i.test(filePath)))];

if (filePaths.length === 0) {
  process.exit(0);
}

const result = runLocalBin('prettier', ['--write', ...filePaths]);
if (result && result.status !== 0) {
  const output = (result.stderr || result.stdout || '').trim();
  if (output) {
    emit(`Hook warning: prettier failed for ${filePaths.join(', ')}\n${output}`);
  }
}

process.exit(0);