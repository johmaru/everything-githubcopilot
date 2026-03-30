#!/usr/bin/env node
'use strict';

const { emit, fileExists, getContext, getFilePath, runLocalBin, toWorkspacePath } = require('./_shared');

const context = getContext();
const filePath = toWorkspacePath(getFilePath(context));

if (!filePath || !fileExists(filePath) || !/\.(ts|tsx|js|jsx|json|md|css|scss|html|yml|yaml)$/i.test(filePath)) {
  process.exit(0);
}

const result = runLocalBin('prettier', ['--write', filePath]);
if (result && result.status !== 0) {
  const output = (result.stderr || result.stdout || '').trim();
  if (output) {
    emit(`Hook warning: prettier failed for ${filePath}\n${output}`);
  }
}

process.exit(0);