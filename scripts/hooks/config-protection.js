#!/usr/bin/env node
'use strict';

const path = require('path');
const { emit, getContext, getFilePath, toRelativeWorkspacePath } = require('./_shared');

const PROTECTED_PATTERNS = [
  /(^|\/)eslint\.config\.(js|cjs|mjs)$/i,
  /(^|\/)\.eslintrc(\.(js|cjs|json|yaml|yml))?$/i,
  /(^|\/)prettier\.config\.(js|cjs|mjs|ts)$/i,
  /(^|\/)\.prettierrc(\.(js|cjs|json|yaml|yml))?$/i,
  /(^|\/)commitlint\.config\.(js|cjs|mjs)$/i,
  /(^|\/)\.markdownlint(\.(json|yaml|yml|js|cjs))?$/i,
  /(^|\/)stylelint\.config\.(js|cjs|mjs)$/i,
];

const context = getContext();
const filePath = getFilePath(context);
const relativePath = toRelativeWorkspacePath(filePath) || (filePath ? filePath.split(path.sep).join('/') : '');

if (relativePath && PROTECTED_PATTERNS.some(pattern => pattern.test(relativePath))) {
  emit(`Hook blocked edit to protected config file: ${relativePath}`, 'stderr');
  process.exit(2);
}

process.exit(0);