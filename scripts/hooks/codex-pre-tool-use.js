#!/usr/bin/env node
'use strict';

/**
 * Codex PreToolUse hook: block git --no-verify flags.
 *
 * In Codex CLI, PreToolUse only fires for Bash commands.
 * This replaces `npx block-no-verify` with a local script
 * that uses the shared hook infrastructure.
 */

const { emit, getCommandText, getContext } = require('./_shared');

const context = getContext();
const command = getCommandText(context);

if (command && /--no-verify/i.test(command)) {
  emit('BLOCKED: --no-verify flag is not allowed. Pre-commit, commit-msg, and pre-push protections must not be skipped.');
  process.exit(1);
}

process.exit(0);
