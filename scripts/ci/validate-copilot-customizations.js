#!/usr/bin/env node
/**
 * Validate GitHub Copilot customization files under .github/
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const README_PATH = path.join(ROOT, 'README.md');
const GITHUB_DIR = path.join(ROOT, '.github');
const COPILOT_INSTRUCTIONS = path.join(GITHUB_DIR, 'copilot-instructions.md');
const INSTRUCTIONS_DIR = path.join(GITHUB_DIR, 'instructions');
const PROMPTS_DIR = path.join(GITHUB_DIR, 'prompts');
const AGENTS_DIR = path.join(GITHUB_DIR, 'agents');
const SKILLS_DIR = path.join(GITHUB_DIR, 'skills');
const CODEX_SKILLS_MIRROR_DIR = path.join(ROOT, '.agents', 'skills');
const COMMON_AGENTS_INSTRUCTIONS = path.join(INSTRUCTIONS_DIR, 'common-agents.instructions.md');
const COMMON_DEVELOPMENT_WORKFLOW = path.join(INSTRUCTIONS_DIR, 'common-development-workflow.instructions.md');
const KNOWLEDGE_AUDIT_PROMPT = path.join(PROMPTS_DIR, 'knowledge-audit.prompt.md');
const VERIFY_PROMPT = path.join(PROMPTS_DIR, 'verify.prompt.md');
const CODER_AGENT = path.join(AGENTS_DIR, 'coder.agent.md');
const SAFETY_CHECKER_AGENT = path.join(AGENTS_DIR, 'safety-checker.agent.md');
const EXPECTED_CODEX_STOP_COMMAND = `node -e "var fs=require('fs'),path=require('path');var dir=process.cwd();var rel='scripts/hooks/codex-stop.js';for(;;){var candidate=path.join(dir,rel);var hasMarkers=fs.existsSync(path.join(dir,'AGENTS.md'))&&fs.existsSync(path.join(dir,'.codex','hooks.json'));if(hasMarkers){if(fs.existsSync(candidate)){process.chdir(dir);var mod=require(candidate);if(mod&&typeof mod.main==='function'){mod.main()}}else{process.exit(0)}break;}var parent=path.dirname(dir);if(parent===dir){process.exit(0)}dir=parent}"`;
const EXPECTED_CODEX_STOP_TIMEOUT = 30;

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

function isValidQuotedFrontmatterValue(value) {
  if (value.startsWith('"')) {
    return /^"(?:[^"\\]|\\(?:[0abtnvfre"/\\N_LP]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}))*"(?:\s+#.*)?$/.test(value);
  }

  if (value.startsWith("'")) {
    return /^'(?:[^']|'')*'(?:\s+#.*)?$/.test(value);
  }

  return false;
}

function findInvalidFrontmatterLine(content) {
  const frontmatterBlock = extractFrontmatterBlock(content);
  if (!frontmatterBlock) {
    return null;
  }

  const lines = frontmatterBlock.split(/\r?\n/);
  let withinBlockScalar = false;

  for (const [index, line] of lines.entries()) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (withinBlockScalar) {
      if (indent > 0) {
        continue;
      }
      withinBlockScalar = false;
    }

    if (indent > 0) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!match) {
      return index + 2;
    }

    const value = match[2].trim();
    if (!value) {
      continue;
    }

    if (value.startsWith('"') || value.startsWith("'")) {
      if (!isValidQuotedFrontmatterValue(value)) {
        return index + 2;
      }
      continue;
    }

    if (value.startsWith('[') || value.startsWith('{')) {
      continue;
    }

    if (/^[>|][+-]?\d*$/.test(value)) {
      withinBlockScalar = true;
      continue;
    }

    if (/:\s/.test(value)) {
      return index + 2;
    }
  }

  return null;
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
  return content
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function collectMissingAnchors(content, anchorGroups) {
  const normalizedContent = normalizeForAnchorCheck(content);
  return anchorGroups
    .filter((group) => !group.some((anchor) => normalizedContent.includes(anchor.toLowerCase())))
    .map((group) => group[0]);
}

function validateAnchoredContract(filePath, errors, ruleId, requirement, anchorGroups) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const missingAnchors = collectMissingAnchors(readUtf8(filePath), anchorGroups);
  if (missingAnchors.length === 0) {
    return;
  }

  errors.push(
    `ERROR: ${ruleId}: ${relative(filePath)} ${requirement} (missing anchors: ${missingAnchors.join(', ')})`
  );
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

function validateSkills(files, errors) {
  for (const filePath of files) {
    const content = readUtf8(filePath);
    const frontmatter = extractFrontmatter(content);
    const file = relative(filePath);

    if (!frontmatter) {
      errors.push(`ERROR: ${file} is missing YAML frontmatter`);
      continue;
    }

    const invalidFrontmatterLine = findInvalidFrontmatterLine(content);
    if (invalidFrontmatterLine !== null) {
      errors.push(`ERROR: ${file} has invalid YAML frontmatter near line ${invalidFrontmatterLine}`);
      continue;
    }

    if (!frontmatter.name) {
      errors.push(`ERROR: ${file} is missing a name field`);
    }
    if (!frontmatter.description) {
      errors.push(`ERROR: ${file} is missing a description field`);
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

function validateReviewRoutingContracts(errors) {
  const requiredContractFiles = [
    [COMMON_AGENTS_INSTRUCTIONS, 'P1-009', 'must keep common-agents.instructions.md present for review-routing enforcement'],
    [COMMON_DEVELOPMENT_WORKFLOW, 'P1-009', 'must keep common-development-workflow.instructions.md present for review-routing enforcement'],
    [COPILOT_INSTRUCTIONS, 'P1-009', 'must keep copilot-instructions.md present for review-routing enforcement'],
    [KNOWLEDGE_AUDIT_PROMPT, 'P1-010', 'must keep knowledge-audit.prompt.md present for knowledge-audit boundary enforcement'],
    [VERIFY_PROMPT, 'P1-010', 'must keep verify.prompt.md present for verification boundary enforcement'],
    [CODER_AGENT, 'P1-010', 'must keep coder.agent.md present for latency-sensitive review boundary enforcement'],
    [SAFETY_CHECKER_AGENT, 'P1-010', 'must keep safety-checker.agent.md present for high-risk safety boundary enforcement'],
  ];

  const contractSurfaceSignals = [
    COMMON_AGENTS_INSTRUCTIONS,
    COMMON_DEVELOPMENT_WORKFLOW,
    KNOWLEDGE_AUDIT_PROMPT,
    VERIFY_PROMPT,
    SAFETY_CHECKER_AGENT,
  ];

  const copilotInstructionsContent = fs.existsSync(COPILOT_INSTRUCTIONS) ? readUtf8(COPILOT_INSTRUCTIONS) : '';
  const normalizedCopilotInstructions = normalizeForAnchorCheck(copilotInstructionsContent);
  const hasRootReviewRoutingAnchor = normalizedCopilotInstructions.includes('planner→(handoff)→coder→(handoff)→researcher(review)')
    || normalizedCopilotInstructions.includes('planner->coder->researcher')
    || normalizedCopilotInstructions.includes('planner->coder->researcherlane')
    || normalizedCopilotInstructions.includes('keepresearcherasthedefaultimplementationreviewpath');
  const hasRepoLevelSignal = fs.existsSync(path.join(ROOT, 'package.json')) || fs.existsSync(path.join(ROOT, 'AGENTS.md'));

  if (!contractSurfaceSignals.some((filePath) => fs.existsSync(filePath)) && !hasRootReviewRoutingAnchor && !hasRepoLevelSignal) {
    return;
  }

  let missingFileFound = false;
  for (const [filePath, ruleId, requirement] of requiredContractFiles) {
    if (fs.existsSync(filePath)) {
      continue;
    }

    missingFileFound = true;
    errors.push(`ERROR: ${ruleId}: ${relative(filePath)} ${requirement}`);
  }

  if (missingFileFound) {
    return;
  }

  validateAnchoredContract(
    COMMON_AGENTS_INSTRUCTIONS,
    errors,
    'P1-009',
    'must keep the high-risk-only code-reviewer routing anchor in the source-of-truth instructions',
    [
      ['high-riskcodejustwritten/modified'],
      ['code-reviewer'],
      ['high-riskchangesinclude'],
    ]
  );

  validateAnchoredContract(
    COMMON_DEVELOPMENT_WORKFLOW,
    errors,
    'P1-009',
    'must keep researcher as the default implementation review and code-reviewer as high-risk-only',
    [
      ['defaultimplementationreview'],
      ['planner->coder->researcher', 'planner->coder->researcherlane', 'defaultimplementationreviewintheplanner->coder->researcherlane'],
      ['high-riskchanges'],
    ]
  );

  validateAnchoredContract(
    COPILOT_INSTRUCTIONS,
    errors,
    'P1-009',
    'must keep the root review-routing contract aligned with the shipped implementation lane',
    [
      ['planner→(handoff)→coder→(handoff)→researcher(review)'],
      ['usecode-revieweronlyforhigh-riskorcross-cuttingrepositorychanges'],
      ['keepresearcherasthedefaultimplementationreviewpath'],
    ]
  );

  validateAnchoredContract(
    KNOWLEDGE_AUDIT_PROMPT,
    errors,
    'P1-010',
    'must keep repository knowledge maintenance separate from implementation review and verification flows',
    [
      ['repositoryknowledgemaintenanceonly'],
      ['defaultresearcher'],
      ['high-riskcode-reviewer'],
      ['/verify'],
    ]
  );

  validateAnchoredContract(
    VERIFY_PROMPT,
    errors,
    'P1-010',
    'must keep broad regression scoped to final verification or high-risk change sets',
    [
      ['verification-onlymode'],
      ['finalverificationorhigh-riskchangesets'],
      ['checklist'],
    ]
  );

  validateAnchoredContract(
    SAFETY_CHECKER_AGENT,
    errors,
    'P1-010',
    'must keep the high-risk-only safety review timing and scope explicit',
    [
      ['immediatelyafterhigh-riskcoderedits', 'immediatelyafterhigh-riskedits', 'reviewrunsimmediatelyafterhigh-riskcoderedits'],
      ['settingschanges'],
      ['multi-filechanges'],
    ]
  );

  validateAnchoredContract(
    CODER_AGENT,
    errors,
    'P1-010',
    'must keep the latency-sensitive coder review and verification boundaries explicit',
    [
      ['high-riskedit直後に安全性チェックを省略しない'],
      ['広い回帰確認は最終確認またはhigh-riskcloseout'],
      ['既定review'],
      ['high-risk追加review'],
      ['planner->coder->researcher'],
    ]
  );
}

function validateSemanticIndexerContracts(errors) {
  const semanticIndexerSignals = ['semantic-indexer', 'entry-points:index', 'entry-points:query', 'rust:index'];
  const readmeContent = fs.existsSync(README_PATH) ? readUtf8(README_PATH) : '';
  const instructionsContent = fs.existsSync(COPILOT_INSTRUCTIONS) ? readUtf8(COPILOT_INSTRUCTIONS) : '';
  const normalizedReadme = normalizeForAnchorCheck(readmeContent);
  const normalizedInstructions = normalizeForAnchorCheck(instructionsContent);
  const hasReadmeSignal = semanticIndexerSignals.some((signal) => normalizedReadme.includes(signal));
  const hasInstructionsSignal = semanticIndexerSignals.some((signal) => normalizedInstructions.includes(signal));
  const hasRepoLevelSignal = fs.existsSync(path.join(ROOT, 'package.json')) || fs.existsSync(path.join(ROOT, 'AGENTS.md'));

  if (!hasReadmeSignal && !hasInstructionsSignal && !hasRepoLevelSignal) {
    return;
  }

  if (hasRepoLevelSignal && !fs.existsSync(README_PATH)) {
    errors.push(
      `ERROR: P1-011: ${relative(README_PATH)} must keep semantic-indexer discovery and summary guidance visible in the README`
    );
  }

  if (hasReadmeSignal || hasRepoLevelSignal) {
    validateAnchoredContract(
      README_PATH,
      errors,
      'P1-011',
      'must keep semantic-indexer discovery and summary guidance visible in the README',
      [
        ['entry-points:index'],
        ['entry-points:query'],
        ['rust:index'],
        ['--formatsummary'],
        ['--filerust/semantic-indexer/src/cli.rs'],
        ['semantic-indexer'],
      ]
    );
  }

  if (hasInstructionsSignal || hasRepoLevelSignal) {
    validateAnchoredContract(
      COPILOT_INSTRUCTIONS,
      errors,
      'P1-011',
      'must keep semantic-indexer routing guidance for static AST analysis in workspace instructions',
      [
        ['semantic-indexer'],
        ['entry-points:index'],
        ['entry-points:query'],
        ['rust:index'],
        ['--formatsummary'],
        ['--file'],
        ['staticastsummary', 'exported-surfacecounts'],
      ]
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

function validateCodexSkillsMirror(errors) {
  if (!fs.existsSync(CODEX_SKILLS_MIRROR_DIR)) {
    return;
  }

  const sourceFiles = collectFiles(SKILLS_DIR, 'SKILL.md');
  const mirrorFiles = collectFiles(CODEX_SKILLS_MIRROR_DIR, 'SKILL.md');
  const toRootRelativePath = (rootDir, filePath) => path.relative(rootDir, filePath).split(path.sep).join('/');
  const sourceByRelativePath = new Map(sourceFiles.map((filePath) => [toRootRelativePath(SKILLS_DIR, filePath), filePath]));
  const mirrorByRelativePath = new Map(mirrorFiles.map((filePath) => [toRootRelativePath(CODEX_SKILLS_MIRROR_DIR, filePath), filePath]));

  for (const relativePath of sourceByRelativePath.keys()) {
    if (!mirrorByRelativePath.has(relativePath)) {
      errors.push(`ERROR: P1-012: .agents/skills is missing mirrored file '${relativePath}' from .github/skills`);
      return;
    }
  }

  for (const relativePath of mirrorByRelativePath.keys()) {
    if (!sourceByRelativePath.has(relativePath)) {
      errors.push(`ERROR: P1-012: .agents/skills contains extra mirrored file '${relativePath}' that is not present in .github/skills`);
      return;
    }
  }

  for (const [relativePath, sourceFilePath] of sourceByRelativePath.entries()) {
    const mirrorFilePath = mirrorByRelativePath.get(relativePath);
    if (readUtf8(sourceFilePath) !== readUtf8(mirrorFilePath)) {
      errors.push(`ERROR: P1-012: .agents/skills file '${relativePath}' must mirror the content shipped in .github/skills`);
      return;
    }
  }
}

function validateCodexContracts(errors) {
  const codexDir = path.join(ROOT, '.codex');
  const codexAgentsFile = path.join(codexDir, 'AGENTS.md');
  const codexAgentsDir = path.join(codexDir, 'agents');
  const codexConfig = path.join(codexDir, 'config.toml');
  const codexHooks = path.join(codexDir, 'hooks.json');
  const codexRules = path.join(codexDir, 'rules', 'security.rules');

  if (!fs.existsSync(codexDir)) {
    return;
  }

  validateCodexSkillsMirror(errors);

  const requiredFiles = [
    { filePath: codexAgentsFile, label: '.codex/AGENTS.md' },
    { filePath: codexAgentsDir, label: '.codex/agents/' },
    { filePath: codexConfig, label: '.codex/config.toml' },
    { filePath: codexHooks, label: '.codex/hooks.json' },
    { filePath: codexRules, label: '.codex/rules/security.rules' },
  ];

  for (const { filePath, label } of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      errors.push(`ERROR: P1-012: ${label} is required when .codex/ compatibility surface exists`);
    }
  }

  if (fs.existsSync(codexConfig)) {
    const configContent = readUtf8(codexConfig);
    const uncommentedConfigLines = configContent
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    if (uncommentedConfigLines.some((line) => /^model_instructions_file\s*=/.test(line))) {
      errors.push('ERROR: P1-012: .codex/config.toml must leave model_instructions_file unset so the root AGENTS.md remains active');
    }
  }

  if (fs.existsSync(codexHooks)) {
    let hooksConfig = null;
    try {
      hooksConfig = JSON.parse(readUtf8(codexHooks));
    } catch (error) {
      errors.push(`ERROR: P1-012: .codex/hooks.json must contain valid JSON (${error.message})`);
    }

    if (hooksConfig && (!hooksConfig.hooks || !Array.isArray(hooksConfig.hooks.Stop) || hooksConfig.hooks.Stop.length === 0)) {
      errors.push('ERROR: P1-012: .codex/hooks.json must define Stop as a single codex-stop.js command');
    }

    if (hooksConfig && hooksConfig.hooks && Array.isArray(hooksConfig.hooks.Stop)) {
      const stopEntries = hooksConfig.hooks.Stop;
      const primaryStopEntry = stopEntries[0] || null;
      const stopHooks = primaryStopEntry && Array.isArray(primaryStopEntry.hooks) ? primaryStopEntry.hooks : [];
      const stopCommandEntry = stopHooks.length === 1 && stopHooks[0] && stopHooks[0].type === 'command'
        ? stopHooks[0]
        : null;
      const stopCommand = stopCommandEntry && typeof stopCommandEntry.command === 'string'
        ? stopCommandEntry.command
        : '';

      if (
        stopEntries.length !== 1
        || stopHooks.length !== 1
        || !stopCommand
        || stopCommand.trim() !== EXPECTED_CODEX_STOP_COMMAND.trim()
        || stopCommandEntry.timeout !== EXPECTED_CODEX_STOP_TIMEOUT
      ) {
        errors.push('ERROR: P1-012: .codex/hooks.json Stop must delegate through a single codex-stop.js command so Codex receives valid JSON stdout');
      }
    }
  }

  if (fs.existsSync(codexAgentsFile)) {
    const content = readUtf8(codexAgentsFile);
    const staleRefs = [
      { pattern: '.agents/skills/', label: '.agents/skills/' },
      { pattern: 'agents/openai.yaml', label: 'agents/openai.yaml' },
      { pattern: 'scripts/sync-ecc-to-codex.sh', label: 'scripts/sync-ecc-to-codex.sh' },
    ];

    for (const { pattern, label } of staleRefs) {
      if (content.includes(pattern) && !fs.existsSync(path.join(ROOT, label))) {
        errors.push(`ERROR: P1-012: .codex/AGENTS.md references non-existent path '${label}'`);
      }
    }

    if (/skills\s+are\s+discovered\s+from\s+`?\.codex\/skills\/?`?/iu.test(content)
      || /codex\s+discovers\s+skills\s+from\s+`?\.codex\/skills\/?`?/iu.test(content)) {
      errors.push('ERROR: P1-012: .codex/AGENTS.md must keep .agents/skills as the canonical Codex discovery path; .codex/skills is compatibility-only');
    }

    validateAnchoredContract(
      codexAgentsFile,
      errors,
      'P1-012',
      'must keep the root instruction boundary and unsupported Codex runtime surfaces explicit',
      [
        ['codexshouldcontinuetousetherootagents.mdforprojectinstructions', 'projectinstructionscomefromtherootagents.md'],
        ['.agents/skills/'],
        ['.codex/instructions/'],
        ['.codex/prompts/'],
      ]
    );
  }

  const readmeContent = fs.existsSync(README_PATH) ? readUtf8(README_PATH) : '';
  if (readmeContent.length > 0 && !normalizeForAnchorCheck(readmeContent).includes('.codex')) {
    errors.push(
      `ERROR: P1-012: ${relative(README_PATH)} must document the .codex/ compatibility surface boundary`
    );
  }
}

function main() {
  const errors = [];
  const warnings = [];
  requireNonEmptyFile(COPILOT_INSTRUCTIONS, errors);

  const instructionFiles = collectFiles(INSTRUCTIONS_DIR, '.instructions.md');
  const promptFiles = collectFiles(PROMPTS_DIR, '.prompt.md');
  const agentFiles = collectFiles(AGENTS_DIR, '.agent.md');
  const skillFiles = collectFiles(SKILLS_DIR, 'SKILL.md');

  validateInstructions(instructionFiles, errors);
  validateSkills(skillFiles, errors);
  const customAgentNames = validateAgents(agentFiles, errors, warnings);
  validatePrompts(promptFiles, customAgentNames, errors);
  validateReviewRoutingContracts(errors);
  validateSemanticIndexerContracts(errors);
  validateCodexContracts(errors);

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
    `Validated Copilot customizations: ${instructionFiles.length} instructions, ${promptFiles.length} prompts, ${agentFiles.length} agents, ${skillFiles.length} skills`
  );
}

main();