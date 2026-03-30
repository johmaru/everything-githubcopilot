#!/usr/bin/env node
'use strict';

const { emit, fileExists, getContext, getFilePath, readFile, toWorkspacePath } = require('./_shared');

const context = getContext();
const filePath = toWorkspacePath(getFilePath(context));

if (!filePath || !/\.(ts|tsx|js|jsx)$/i.test(filePath) || !fileExists(filePath)) {
  process.exit(0);
}

const content = readFile(filePath);
if (!content) {
  process.exit(0);
}

const matches = content.match(/\bconsole\.log\s*\(/g);
if (matches && matches.length > 0) {
  emit(`Hook warning: console.log found in ${filePath} (${matches.length} occurrence${matches.length === 1 ? '' : 's'})`);
}

process.exit(0);