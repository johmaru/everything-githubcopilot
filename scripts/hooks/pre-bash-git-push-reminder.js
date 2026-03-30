#!/usr/bin/env node
'use strict';

const { emit, getCommandText, getContext } = require('./_shared');

const context = getContext();
const command = getCommandText(context);

if (command && /(^|\s)git\s+push(\s|$)/i.test(command)) {
  emit('Hook reminder: review your diff before pushing with git diff origin/main...HEAD');
}

process.exit(0);