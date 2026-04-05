#!/usr/bin/env node
'use strict';

const { emit, getContext, getFilePaths, runLocalBin } = require('./_shared');

const context = getContext();
const filePaths = getFilePaths(context);

if (!filePaths.some((filePath) => /\.(ts|tsx)$/i.test(filePath))) {
  process.exit(0);
}

const result = runLocalBin('tsc', ['--noEmit', '--pretty', 'false']);
if (!result) {
  emit('Hook warning: local tsc not found; skipping targeted TypeScript check');
  process.exit(0);
}

if (result && result.status !== 0) {
  const output = (result.stdout || result.stderr || '').trim();
  if (output) {
    emit(`Hook warning: TypeScript check reported issues\n${output.split(/\r?\n/).slice(0, 10).join('\n')}`);
  }
}

process.exit(0);