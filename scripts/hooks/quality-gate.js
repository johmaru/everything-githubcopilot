#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { emit, fileExists, getContext, getFilePaths, readFile, toWorkspacePath } = require('./_shared');

const context = getContext();
const filePaths = [...new Set(getFilePaths(context)
  .map(toWorkspacePath)
  .filter((filePath) => filePath && fileExists(filePath)))];

if (filePaths.length === 0) {
  process.exit(0);
}

for (const filePath of filePaths) {
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
      continue;
    }

    try {
      JSON.parse(content);
    } catch (error) {
      emit(`Hook quality gate failed for ${filePath}\n${error.message}`, 'stderr');
      process.exit(1);
    }
  }
}

process.exit(0);