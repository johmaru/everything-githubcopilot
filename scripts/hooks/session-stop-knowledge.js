'use strict';

const MIN_OBSERVATIONS = 5;
const STATIC_USAGE_TOOLS = new Set(['vscode_listCodeUsages', 'search/usages']);

function extractObservationPatterns(observations) {
  const patterns = [];

  for (let index = 0; index < observations.length - 1; index += 1) {
    const current = observations[index];
    if (current.tool_name === 'read_file') {
      continue;
    }

    const output = current.tool_output || '';
    if (!looksLikeError(output)) {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < Math.min(index + 4, observations.length); nextIndex += 1) {
      const next = observations[nextIndex];
      const nextOutput = next.tool_output || '';
      if (!looksLikeSuccess(nextOutput)) {
        continue;
      }

      const errorSnippet = output.slice(0, 200).replace(/\n/g, ' ');
      const fixTool = next.tool_name;
      const fixInput = summarizeToolInput(next.tool_input || '');
      patterns.push({
        kind: 'error_resolution',
        content: `Error in ${current.tool_name}: "${errorSnippet}" -> Fixed with ${fixTool}: "${fixInput}"`,
        domain: 'debugging',
        trigger: errorSnippet,
        action: `Use ${fixTool}: ${fixInput}`,
        confidence: 0.4,
      });
      break;
    }
  }

  const staticUsageSuccesses = observations.filter(
    (observation) => isSuccessfulStaticUsageSearch(observation)
  );
  const readAfterStaticUsageCount = countFollowUpReads(observations);
  if (staticUsageSuccesses.length >= 2 && readAfterStaticUsageCount >= 2) {
    patterns.push({
      kind: 'workflow',
      content: 'Prefer static usage search before targeted file reads for repo-internal dependency tracing.',
      confidence: 0.65,
    });
  }

  const sequenceCounts = new Map();
  for (let length = 2; length <= 3; length += 1) {
    for (let index = 0; index <= observations.length - length; index += 1) {
      const sequence = observations.slice(index, index + length).map((observation) => observation.tool_name).join(' -> ');
      if (isLowInformationSequence(sequence)) {
        continue;
      }
      sequenceCounts.set(sequence, (sequenceCounts.get(sequence) || 0) + 1);
    }
  }

  for (const [sequence, count] of sequenceCounts) {
    if (count >= 3) {
      patterns.push({
        kind: 'workflow',
        content: `Repeated workflow (${count}x): ${sequence}`,
        domain: 'workflow',
        trigger: `when following the ${sequence.split(' -> ')[0]} workflow`,
        action: `Use the observed sequence: ${sequence}`,
        confidence: Math.min(0.3 + count * 0.1, 0.8),
      });
    }
  }

  const fileCounts = new Map();
  for (const observation of observations) {
    if (!/Edit|Write|MultiEdit/i.test(observation.tool_name)) {
      continue;
    }

    const input = observation.tool_input || '';
    const match = input.match(/"(?:file_?path|path|target)"\s*:\s*"([^"]+)"/i);
    if (!match) {
      continue;
    }

    const filePath = match[1];
    fileCounts.set(filePath, (fileCounts.get(filePath) || 0) + 1);
  }

  for (const [filePath, count] of fileCounts) {
    if (count >= 3) {
      patterns.push({
        kind: 'hotspot',
        content: `File hotspot: ${filePath} was edited ${count} times in this session`,
        domain: 'codebase',
        trigger: `when editing ${filePath}`,
        action: 'Check nearby tests and existing patterns before changing this file again.',
        confidence: 0.3,
      });
    }
  }

  return patterns;
}

function summarizeToolInput(toolInput) {
  const parsed = parseStructuredValue(toolInput);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const command = parsed.command || parsed.shellCommand || parsed.toolInputCommand;
    if (typeof command === 'string' && command.trim()) {
      return command.trim().slice(0, 200).replace(/\n/g, ' ');
    }

    const filePath = parsed.filePath || parsed.file_path || parsed.path || parsed.target;
    if (typeof filePath === 'string' && filePath.trim()) {
      return filePath.trim().slice(0, 200).replace(/\n/g, ' ');
    }
  }

  return String(toolInput || '').slice(0, 200).replace(/\n/g, ' ');
}

function isLowInformationSequence(sequence) {
  const tools = String(sequence || '').split(' -> ').map((tool) => tool.trim()).filter(Boolean);
  if (tools.length === 0) {
    return true;
  }

  return tools.every((tool) => /^bash$/i.test(tool));
}

function countFollowUpReads(observations) {
  let count = 0;

  for (let index = 0; index < observations.length - 1; index += 1) {
    const current = observations[index];
    if (!isSuccessfulStaticUsageSearch(current)) {
      continue;
    }

    const targets = extractStaticUsageTargets(current);
    if (targets.size === 0) {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < Math.min(index + 3, observations.length); nextIndex += 1) {
      const next = observations[nextIndex];
      if (isSuccessfulRead(next) && readMatchesStaticUsageTargets(next, targets)) {
        count += 1;
        break;
      }
    }
  }

  return count;
}

function isStaticUsageTool(toolName) {
  return STATIC_USAGE_TOOLS.has(toolName);
}

function isSuccessfulStaticUsageSearch(observation) {
  if (!observation || !isStaticUsageTool(observation.tool_name)) {
    return false;
  }

  const output = observation.tool_output || '';
  return Boolean(output.trim()) && !looksLikeToolError(output);
}

function isSuccessfulRead(observation) {
  if (!observation || observation.tool_name !== 'read_file') {
    return false;
  }

  const output = observation.tool_output || '';
  return !/^\s*Error:/i.test(output);
}

function extractStaticUsageTargets(observation) {
  const parsedOutput = parseStructuredValue(observation.tool_output || '');
  const targets = new Set();
  collectTargets(parsedOutput, targets);
  return targets;
}

function readMatchesStaticUsageTargets(observation, targets) {
  const readTarget = extractReadTarget(observation.tool_input || '');
  return Boolean(readTarget) && targets.has(readTarget);
}

function extractReadTarget(toolInput) {
  const parsedInput = parseStructuredValue(toolInput);
  if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
    return null;
  }

  return normalizeLocation(parsedInput.filePath || parsedInput.uri || null);
}

function parseStructuredValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '[' && trimmed[0] !== '{')) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function collectTargets(value, targets) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTargets(item, targets);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const filePath = normalizeLocation(value.filePath || null);
  const uri = normalizeLocation(value.uri || null);
  if (filePath) {
    targets.add(filePath);
  }
  if (uri) {
    targets.add(uri);
  }

  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === 'object') {
      collectTargets(nestedValue, targets);
    }
  }
}

function normalizeLocation(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  return value.trim().replace(/\\/g, '/');
}

function looksLikeToolError(text) {
  if (!text) {
    return false;
  }

  return /^\s*(error|err|exception|TypeError|ReferenceError|SyntaxError|panic|fatal)\b/i.test(text)
    || /\b(Cannot find module|Module not found|ENOENT|EACCES|permission denied|access denied)\b/i.test(text)
    || /\bfailed\b/i.test(text);
}

function looksLikeError(text) {
  if (!text) {
    return false;
  }

  return looksLikeToolError(text) || /\b(rejected|not found)\b/i.test(text);
}

function looksLikeSuccess(text) {
  if (!text) {
    return false;
  }

  return /\b(success|passed|ok|created|updated|written|done|completed)\b/i.test(text)
    && !looksLikeError(text);
}

module.exports = {
  MIN_OBSERVATIONS,
  extractObservationPatterns,
  looksLikeError,
  looksLikeSuccess,
  isLowInformationSequence,
};
