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

function extractFrontmatterBlock(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

function frontmatterHasListValue(content, key, expectedValue) {
  const frontmatterBlock = extractFrontmatterBlock(content);
  if (!frontmatterBlock) {
    return false;
  }

  let withinTargetKey = false;
  for (const line of frontmatterBlock.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!withinTargetKey) {
      if (trimmedLine.startsWith(`${key}: [`)) {
        const normalizedInlineList = trimmedLine.replace(/\]\s+#.*$/, ']');
        const inlineItems = normalizedInlineList
          .slice(key.length + 1)
          .trim()
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        return inlineItems.includes(expectedValue);
      }

      if (trimmedLine === `${key}:`) {
        withinTargetKey = true;
      }
      continue;
    }

    if (/^[A-Za-z0-9_-]+:/.test(trimmedLine)) {
      break;
    }

    if (!trimmedLine) {
      continue;
    }

    if (trimmedLine.startsWith('-') && trimmedLine.replace(/^-[\s]*/, '').replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '') === expectedValue) {
      return true;
    }
  }

  return false;
}

function normalizeForAnchorCheck(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').replace(/\s+/g, '');
}

function extractMarkdownSection(content, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp(`^## ${escapedHeading}\\r?$`, 'm');
  const headingMatch = headingPattern.exec(content);
  if (!headingMatch) {
    return '';
  }

  const startIndex = headingMatch.index + headingMatch[0].length;
  const remainingContent = content.slice(startIndex).replace(/^\r?\n/, '');
  const nextHeadingMatch = remainingContent.match(/^## .*\r?$/m);

  return nextHeadingMatch
    ? remainingContent.slice(0, nextHeadingMatch.index)
    : remainingContent;
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

function extractHandoffAgents(content) {
  const agents = extractHandoffEntries(content)
    .map((entry) => entry.agent)
    .filter(Boolean);

  return [...new Set(agents)]; // Remove duplicates
}

function extractHandoffEntries(content) {
  const frontmatterBlock = extractFrontmatterBlock(content);
  if (!frontmatterBlock) {
    return [];
  }

  const entries = [];
  let inHandoffs = false;
  let currentEntry = null;
  let blockScalarIndent = null;

  for (const line of frontmatterBlock.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    const indent = line.search(/\S|$/);

    if (!inHandoffs) {
      if (trimmedLine === 'handoffs:') {
        inHandoffs = true;
      }
      continue;
    }

    if (/^[A-Za-z0-9_-]+:/.test(trimmedLine) && !line.startsWith(' ')) {
      break;
    }

    if (blockScalarIndent !== null) {
      if (!trimmedLine) {
        continue;
      }

      if (indent > blockScalarIndent) {
        continue;
      }

      blockScalarIndent = null;
    }

    if (!trimmedLine) {
      continue;
    }

    if (trimmedLine.startsWith('- ')) {
      if (currentEntry) {
        entries.push(currentEntry);
      }
      currentEntry = {};
      const inlineLine = trimmedLine.slice(2);
      const colonIndex = inlineLine.indexOf(':');
      if (colonIndex > 0) {
        const key = inlineLine.slice(0, colonIndex).trim();
        const value = inlineLine.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        currentEntry[key] = value;
      }
      continue;
    }

    if (!currentEntry) {
      continue;
    }

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, colonIndex).trim();
    const value = trimmedLine.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    currentEntry[key] = value;

    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      blockScalarIndent = indent;
    }
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

function validateSendPolicy(agentName, filePath, content, errors) {
  const handoffEntries = extractHandoffEntries(content);

  if (agentName === 'planner') {
    const coderHandoffs = handoffEntries.filter((entry) => entry.agent === 'coder');
    const lowRiskAutoHandoff = coderHandoffs.find((entry) => entry.send === 'true' && /low\s*risk|low-risk|低リスク/i.test(entry.label || ''));
    const manualCoderHandoff = coderHandoffs.find((entry) => entry.send === 'false');

    if (!lowRiskAutoHandoff) {
      errors.push(`ERROR: P3-SEND: ${relative(filePath)} planner must set send: true for the coder handoff marked as low-risk`);
    }

    if (!manualCoderHandoff) {
      errors.push(`ERROR: P3-SEND: ${relative(filePath)} planner must keep a manual coder handoff with send: false`);
    }
  }

  if (agentName === 'supporter') {
    const unsafeHandoffs = handoffEntries.filter((entry) => entry.send !== 'false');
    if (unsafeHandoffs.length > 0) {
      errors.push(`ERROR: P3-SEND: ${relative(filePath)} supporter handoffs must keep send: false`);
    }
  }
}

/**
 * P1-004: Validate four-layer handoff chains
 * Ensures the core workflow chains are properly defined:
 * - Implementation: planner → coder → researcher
 * - Support: supporter → planner / supporter → researcher
 */
function validateHandoffChain(handoffRefs, agentFiles, errors, warnings) {
  // Check if planner can handoff to coder
  const plannerTargets = handoffRefs.get('planner') || [];
  if (!plannerTargets.includes('coder')) {
    errors.push(`ERROR: P1-004: planner must have handoff to 'coder' (planner → coder chain broken)`);
  }

  // Check if coder can handoff to researcher and planner (for recovery)
  const coderTargets = handoffRefs.get('coder') || [];
  if (!coderTargets.includes('researcher')) {
    errors.push(`ERROR: P1-004: coder must have handoff to 'researcher' (coder → researcher chain broken)`);
  }
  if (!coderTargets.includes('planner')) {
    warnings.push(`WARN: P1-004: coder should have handoff to 'planner' for failure recovery (coder → planner chain missing)`);
  }

  // Check researcher is not a source (it should be read-only terminal)
  if (handoffRefs.has('researcher')) {
    warnings.push(`WARN: P1-004: researcher should not have outgoing handoffs (it is a read-only terminal node)`);
  }
}

/**
 * P1-003: Validate agent visibility contract
 * Only planner, coder, researcher, supporter should be user-visible (user-invocable: true or not set)
 * All other agents must have user-invocable: false
 */
function validateAgentVisibility(agentFiles, errors) {
  const VISIBLE_AGENTS = new Set(['planner', 'coder', 'researcher', 'supporter']);

  for (const filePath of agentFiles) {
    const content = readUtf8(filePath);
    const frontmatter = extractFrontmatter(content);
    const file = relative(filePath);

    if (!frontmatter) {
      continue; // Already reported as error elsewhere
    }

    const agentName = frontmatter.name || path.basename(filePath, '.agent.md');
    const isUserInvocable = frontmatter['user-invocable'] !== 'false' && frontmatter['user-invocable'] !== false;

    if (VISIBLE_AGENTS.has(agentName)) {
      // Visible agents should NOT have user-invocable: false
      if (frontmatter['user-invocable'] === 'false' || frontmatter['user-invocable'] === false) {
        errors.push(`ERROR: P1-003: ${file} has 'user-invocable: false' but '${agentName}' must be user-visible`);
      }
    } else {
      // Non-visible agents MUST have user-invocable: false
      if (isUserInvocable) {
        errors.push(`ERROR: P1-003: ${file} is missing 'user-invocable: false'. Only planner, coder, researcher, supporter should be user-visible`);
      }
    }
  }
}

function validatePlannerResearcherContract(filePath, content, errors) {
  if (!frontmatterHasListValue(content, 'tools', 'agent')) {
    errors.push(
      `ERROR: P1-008: ${relative(filePath)} planner must keep the 'agent' tool available for researcher handoff`
    );
  }

  const plannerUsageSection = extractMarkdownSection(content, 'plannerの活用');
  const anchorGroups = [
    ['researcherサブエージェントの利用は必須', 'researcherの利用は必須'],
    ['依存関係の追跡'],
    ['複数ファイルを横断', '複数ファイル横断'],
    ['アーキテクチャ全体像や既存パターン', 'アーキテクチャ全体像', '既存パターン'],
    ['調査結果の要点を計画へ統合', '調査結果を計画へ統合'],
    ['不要だと判断した理由'],
  ];
  const normalizedContent = normalizeForAnchorCheck(plannerUsageSection);
  const missingAnchors = anchorGroups
    .filter((group) => !group.some((anchor) => normalizedContent.includes(anchor)))
    .map((group) => group[0]);

  if (!plannerUsageSection || missingAnchors.length > 0) {
    errors.push(
      `ERROR: P1-008: ${relative(filePath)} planner must require researcher usage for dependency and architecture investigation (missing anchors: ${missingAnchors.join(', ')})`
    );
  }
}

function validateAgents(files, errors, warnings) {
  const names = new Map();
  const handoffRefs = new Map();

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
    if (agentName === 'planner') {
      validatePlannerResearcherContract(filePath, content, errors);
    }
    validateSendPolicy(agentName, filePath, content, errors);

    if (names.has(agentName)) {
      errors.push(`ERROR: ${file} reuses agent name '${agentName}' already declared in ${names.get(agentName)}`);
    } else {
      names.set(agentName, file);
    }

    // Collect handoff references for validation
    const handoffAgents = extractHandoffAgents(content);
    if (handoffAgents.length > 0) {
      handoffRefs.set(agentName, handoffAgents);
    }
  }

  // Validate handoff references
  const allAgentNames = new Set(names.keys());
  for (const [sourceAgent, targets] of handoffRefs) {
    for (const target of targets) {
      if (!allAgentNames.has(target)) {
        errors.push(`ERROR: ${names.get(sourceAgent)} references unknown handoff agent '${target}'`);
      }
    }
  }

  // P1-004: Validate three-layer handoff chain (planner → coder → researcher)
  validateHandoffChain(handoffRefs, names, errors, warnings);

  // P1-003: Validate agent visibility contract
  validateAgentVisibility(files, errors);

  return allAgentNames;
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
  const warnings = [];
  requireNonEmptyFile(COPILOT_INSTRUCTIONS, errors);

  const instructionFiles = collectFiles(INSTRUCTIONS_DIR, '.instructions.md');
  const promptFiles = collectFiles(PROMPTS_DIR, '.prompt.md');
  const agentFiles = collectFiles(AGENTS_DIR, '.agent.md');

  validateInstructions(instructionFiles, errors);
  const customAgentNames = validateAgents(agentFiles, errors, warnings);
  validatePrompts(promptFiles, customAgentNames, errors);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  for (const warning of warnings) {
    console.warn(warning);
  }

  console.log(
    `Validated Copilot customizations: ${instructionFiles.length} instructions, ${promptFiles.length} prompts, ${agentFiles.length} agents`
  );
}

main();