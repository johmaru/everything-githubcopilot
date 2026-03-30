#!/usr/bin/env node
/**
 * Validate GitHub Copilot customization files under .github/
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const GITHUB_DIR = path.join(ROOT, '.github');
const COPILOT_INSTRUCTIONS = path.join(GITHUB_DIR, 'copilot-instructions.md');
const INSTRUCTIONS_DIR = path.join(GITHUB_DIR, 'instructions');
const PROMPTS_DIR = path.join(GITHUB_DIR, 'prompts');
const AGENTS_DIR = path.join(GITHUB_DIR, 'agents');

const BUILT_IN_PROMPT_AGENTS = new Set(['ask', 'agent', 'plan']);

function collectFiles(dir, extension) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute, extension));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return null;
  }

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    frontmatter[key] = value;
  }

  return frontmatter;
}

function requireNonEmptyFile(filePath, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push(`ERROR: Missing required file ${relative(filePath)}`);
    return;
  }

  const content = readUtf8(filePath);
  if (!content.trim()) {
    errors.push(`ERROR: ${relative(filePath)} is empty`);
  }
}

function validateInstructions(files, errors) {
  for (const filePath of files) {
    const content = readUtf8(filePath);
    const frontmatter = extractFrontmatter(content);
    const file = relative(filePath);

    if (!frontmatter) {
      errors.push(`ERROR: ${file} is missing YAML frontmatter`);
      continue;
    }
    if (!frontmatter.description) {
      errors.push(`ERROR: ${file} is missing a description field`);
    }
    if (!frontmatter.applyTo) {
      errors.push(`ERROR: ${file} is missing an applyTo field`);
    }
  }
}

function validateAgents(files, errors) {
  const names = new Map();

  for (const filePath of files) {
    const content = readUtf8(filePath);
    const frontmatter = extractFrontmatter(content);
    const file = relative(filePath);

    if (!frontmatter) {
      errors.push(`ERROR: ${file} is missing YAML frontmatter`);
      continue;
    }
    if (!frontmatter.description) {
      errors.push(`ERROR: ${file} is missing a description field`);
    }

    const agentName = frontmatter.name || path.basename(filePath, '.agent.md');
    if (names.has(agentName)) {
      errors.push(`ERROR: ${file} reuses agent name '${agentName}' already declared in ${names.get(agentName)}`);
    } else {
      names.set(agentName, file);
    }
  }

  return new Set(names.keys());
}

function validatePrompts(files, customAgentNames, errors) {
  for (const filePath of files) {
    const content = readUtf8(filePath);
    const frontmatter = extractFrontmatter(content);
    const file = relative(filePath);

    if (!frontmatter) {
      errors.push(`ERROR: ${file} is missing YAML frontmatter`);
      continue;
    }
    if (!frontmatter.description) {
      errors.push(`ERROR: ${file} is missing a description field`);
    }

    const promptAgent = frontmatter.agent;
    if (promptAgent && !BUILT_IN_PROMPT_AGENTS.has(promptAgent) && !customAgentNames.has(promptAgent)) {
      errors.push(`ERROR: ${file} references unknown agent '${promptAgent}'`);
    }
  }
}

function main() {
  const errors = [];
  requireNonEmptyFile(COPILOT_INSTRUCTIONS, errors);

  const instructionFiles = collectFiles(INSTRUCTIONS_DIR, '.instructions.md');
  const promptFiles = collectFiles(PROMPTS_DIR, '.prompt.md');
  const agentFiles = collectFiles(AGENTS_DIR, '.agent.md');

  validateInstructions(instructionFiles, errors);
  const customAgentNames = validateAgents(agentFiles, errors);
  validatePrompts(promptFiles, customAgentNames, errors);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log(
    `Validated Copilot customizations: ${instructionFiles.length} instructions, ${promptFiles.length} prompts, ${agentFiles.length} agents`
  );
}

main();