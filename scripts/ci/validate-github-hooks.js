#!/usr/bin/env node
/**
 * Validate GitHub Copilot hook files under .github/hooks/.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Ajv = require('ajv');

const ROOT = path.join(__dirname, '../..');
const HOOKS_DIR = path.join(ROOT, '.github', 'hooks');
const HOOKS_SCHEMA_PATH = path.join(ROOT, 'schemas', 'hooks.schema.json');
const ALLOWED_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']);
const VALID_HOOK_TYPES = new Set(['command', 'http', 'prompt', 'agent']);
const EVENTS_WITHOUT_MATCHER = new Set(['Stop']);
const FORBIDDEN_COMMAND_SNIPPETS = ['${CLAUDE_PLUGIN_ROOT}', 'run-with-flags.js', 'run-with-flags-shell.sh', '~/.claude/'];

function collectJsonFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(absolute));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(absolute);
    }
  }

  return files.sort();
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => isNonEmptyString(item));
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractLocalNodeScript(command) {
  if (typeof command !== 'string') {
    return null;
  }

  const match = command.match(/^node\s+(?:\.\\|\.\/)?(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  if (!match) {
    return null;
  }

  const scriptPath = match[1] || match[2] || match[3];
  if (!scriptPath || path.isAbsolute(scriptPath) || scriptPath.startsWith('-')) {
    return null;
  }

  return scriptPath;
}

function validateHookEntry(hook, label, errors) {
  if (!hook || typeof hook !== 'object') {
    errors.push(`ERROR: ${label} is not an object`);
    return;
  }

  if (!VALID_HOOK_TYPES.has(hook.type)) {
    errors.push(`ERROR: ${label} has unsupported hook type '${hook.type}'`);
    return;
  }

  if ('timeout' in hook && (typeof hook.timeout !== 'number' || hook.timeout < 0)) {
    errors.push(`ERROR: ${label} 'timeout' must be a non-negative number`);
  }

  if (hook.type === 'command') {
    if ('async' in hook && typeof hook.async !== 'boolean') {
      errors.push(`ERROR: ${label} 'async' must be a boolean`);
    }

    if (!isNonEmptyString(hook.command) && !isNonEmptyStringArray(hook.command)) {
      errors.push(`ERROR: ${label} missing or invalid 'command' field`);
      return;
    }

    const commandText = Array.isArray(hook.command) ? hook.command.join(' ') : hook.command;
    for (const forbidden of FORBIDDEN_COMMAND_SNIPPETS) {
      if (commandText.includes(forbidden)) {
        errors.push(`ERROR: ${label} uses legacy Claude-only hook command content '${forbidden}'`);
      }
    }

    const localNodeScript = extractLocalNodeScript(commandText);
    if (localNodeScript) {
      const absoluteScriptPath = path.join(ROOT, localNodeScript);
      if (!fs.existsSync(absoluteScriptPath)) {
        errors.push(`ERROR: ${label} references missing local command script '${localNodeScript}'`);
      }
    }

    const nodeEMatch = typeof hook.command === 'string' ? hook.command.match(/^node -e "(.*)"$/s) : null;
    if (nodeEMatch) {
      try {
        new vm.Script(nodeEMatch[1].replace(/\\/g, '\\').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
      } catch (error) {
        errors.push(`ERROR: ${label} has invalid inline JS: ${error.message}`);
      }
    }

    return;
  }

  if (hook.type === 'http') {
    if (!isNonEmptyString(hook.url)) {
      errors.push(`ERROR: ${label} missing or invalid 'url' field`);
    }
    return;
  }

  if (!isNonEmptyString(hook.prompt)) {
    errors.push(`ERROR: ${label} missing or invalid 'prompt' field`);
  }
}

function validateGithubHooksFile(filePath, schemaValidate, errors) {
  const file = relative(filePath);
  let data;

  try {
    data = loadJson(filePath);
  } catch (error) {
    errors.push(`ERROR: ${file} contains invalid JSON: ${error.message}`);
    return;
  }

  const valid = schemaValidate(data);
  if (!valid) {
    for (const error of schemaValidate.errors || []) {
      errors.push(`ERROR: ${file} schema: ${error.instancePath || '/'} ${error.message}`);
    }
    return;
  }

  const hooks = data.hooks || data;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    errors.push(`ERROR: ${file} must use object-style hook configuration with a 'hooks' object`);
    return;
  }

  for (const [eventType, matchers] of Object.entries(hooks)) {
    if (!ALLOWED_EVENTS.has(eventType)) {
      errors.push(`ERROR: ${file} uses non-deterministic or unsupported event '${eventType}'`);
      continue;
    }

    if (!Array.isArray(matchers)) {
      errors.push(`ERROR: ${file} event '${eventType}' must contain an array of matchers`);
      continue;
    }

    matchers.forEach((matcher, matcherIndex) => {
      const label = `${file}:${eventType}[${matcherIndex}]`;

      if (!matcher || typeof matcher !== 'object') {
        errors.push(`ERROR: ${label} is not an object`);
        return;
      }

      if (!EVENTS_WITHOUT_MATCHER.has(eventType) && !isNonEmptyString(matcher.matcher)) {
        errors.push(`ERROR: ${label} is missing a string matcher`);
      }

      if (!Array.isArray(matcher.hooks) || matcher.hooks.length === 0) {
        errors.push(`ERROR: ${label} must contain a non-empty hooks array`);
        return;
      }

      matcher.hooks.forEach((hook, hookIndex) => {
        validateHookEntry(hook, `${label}.hooks[${hookIndex}]`, errors);
      });
    });
  }
}

function main() {
  const files = collectJsonFiles(HOOKS_DIR);
  if (files.length === 0) {
    console.log('No .github hook files found, skipping validation');
    process.exit(0);
  }

  const schema = loadJson(HOOKS_SCHEMA_PATH);
  const ajv = new Ajv({ allErrors: true });
  const schemaValidate = ajv.compile(schema);
  const errors = [];

  files.forEach(filePath => validateGithubHooksFile(filePath, schemaValidate, errors));

  if (errors.length > 0) {
    errors.forEach(error => console.error(error));
    process.exit(1);
  }

  console.log(`Validated GitHub Copilot hooks: ${files.length} file(s)`);
}

main();