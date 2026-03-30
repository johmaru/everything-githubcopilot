#!/usr/bin/env node
'use strict';

const path = require('path');
const { emit, getContext, getFilePath, toRelativeWorkspacePath } = require('./_shared');

const ALLOWED_ROOTS = [/^docs\//i, /^\.github\//i, /^assets\/images\//i];
const ALLOWED_FILE_NAMES = /^(README|CHANGELOG|LICENSE|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|AGENTS)(\..+)?$/i;

const context = getContext();
const filePath = getFilePath(context);
const relativePath = toRelativeWorkspacePath(filePath);

if (!relativePath || !/\.(md|mdx|txt)$/i.test(relativePath)) {
  process.exit(0);
}

const normalized = relativePath.split(path.sep).join('/');
const baseName = path.basename(normalized);

if (ALLOWED_FILE_NAMES.test(baseName) || ALLOWED_ROOTS.some(pattern => pattern.test(normalized))) {
  process.exit(0);
}

emit(`Hook warning: documentation file path looks non-standard: ${normalized}`);
process.exit(0);