#!/usr/bin/env node
'use strict';

const { emit, fileExists, getContext, getFilePaths, readFile, toWorkspacePath } = require('./_shared');

const context = getContext();
const filePaths = [...new Set(getFilePaths(context)
  .map(toWorkspacePath)
  .filter((filePath) => filePath && /\.(ts|tsx|js|jsx)$/i.test(filePath) && fileExists(filePath)))];

if (filePaths.length === 0) {
  process.exit(0);
}

for (const filePath of filePaths) {
  const content = readFile(filePath);
  if (!content) {
    continue;
  }

  const matches = content.match(/\bconsole\.log\s*\(/g);
  if (matches && matches.length > 0) {
    emit(`Hook warning: console.log found in ${filePath} (${matches.length} occurrence${matches.length === 1 ? '' : 's'})`);
  }
}

process.exit(0);