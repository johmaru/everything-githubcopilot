#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const db = require('./db');
const { getContext } = require('./_shared');
const { getToolSchema, normalizeModelProfile } = require('./tool-call-schema-registry');

const DEFAULT_EVAL_CASES_PATH = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'tool-call-correction', 'eval-cases.json');

function parseStructuredValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function stringifyValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined) {
    return '';
  }

  return JSON.stringify(value);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function sanitizeObservationText(content) {
  return String(content ?? '')
    .replace(/"(password|passwd|token|secret|api[_-]?key)"\s*:\s*"(?:\\.|[^"\\])*"/gi, '"$1":"<redacted>"')
    .replace(/\\"(password|passwd|token|secret|api[_-]?key)\\"\s*:\s*\\"(?:\\\\.|[^"\\])*\\"/gi, '\\"$1\\":\\"<redacted>\\"')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1<redacted>')
    .replace(/\b(?:ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g, '<redacted>')
    .replace(/\bsk-[A-Za-z0-9]+\b/g, '<redacted>')
    .replace(/\bAIza[0-9A-Za-z\-_]{20,}\b/g, '<redacted>')
    .replace(/\b(password|passwd|token|secret|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi, (_, keyName) => `${keyName}=<redacted>`)
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<redacted-path>')
    .replace(/\/(Users|home)\/[^\s"']+/g, '<redacted-path>');
}

function getActualType(value) {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

function preserveModelProfile(modelProfile) {
  if (modelProfile === null || modelProfile === undefined) {
    return 'generic';
  }

  const normalizedProfile = normalizeModelProfile(modelProfile);
  if (normalizedProfile !== 'generic') {
    return normalizedProfile;
  }

  const rawProfile = String(modelProfile).trim();
  return rawProfile || 'generic';
}

function normalizeToolInput(value) {
  const structuredValue = parseStructuredValue(value);
  if (structuredValue === null) {
    if (value !== undefined) {
      return {
        kind: 'invalid_root',
        value: typeof value === 'string' && value.trim().toLowerCase() === 'null' ? null : value,
      };
    }

    return {
      kind: 'object',
      value: {},
    };
  }

  if (typeof structuredValue !== 'object' || Array.isArray(structuredValue)) {
    return {
      kind: 'invalid_root',
      value: structuredValue,
    };
  }

  return {
    kind: 'object',
    value: JSON.parse(JSON.stringify(structuredValue)),
  };
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isObjectArray(value) {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function matchesExpectedType(value, expectedType) {
  if (expectedType === 'string') {
    return typeof value === 'string';
  }

  if (expectedType === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (expectedType === 'boolean') {
    return typeof value === 'boolean';
  }

  if (expectedType === 'string[]') {
    return isStringArray(value);
  }

  if (expectedType === 'object[]') {
    return isObjectArray(value);
  }

  return false;
}

function coerceLosslessValue(value, expectedType) {
  if (matchesExpectedType(value, expectedType)) {
    return { ok: true, changed: false, value };
  }

  if (expectedType === 'number' && typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return { ok: true, changed: true, value: Number(value.trim()) };
  }

  if (expectedType === 'boolean' && typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return { ok: true, changed: true, value: true };
    }
    if (normalized === 'false') {
      return { ok: true, changed: true, value: false };
    }
  }

  return { ok: false, changed: false, value };
}

function selectFailureType({ missingRequired, typeMismatches, appliedFixes }) {
  if (missingRequired.length > 0) {
    return 'validation_missing_required';
  }

  if (typeMismatches.length > 0) {
    return 'validation_type_mismatch';
  }

  if (appliedFixes.some((fix) => fix.type === 'coerce_scalar')) {
    return 'validation_type_mismatch';
  }

  if (appliedFixes.some((fix) => fix.type === 'rename_alias')) {
    return 'validation_alias_match';
  }

  if (appliedFixes.some((fix) => fix.type === 'drop_shadowed_alias')) {
    return 'validation_alias_match';
  }

  if (appliedFixes.some((fix) => fix.type === 'drop_unknown_property')) {
    return 'validation_unknown_property';
  }

  return 'valid';
}

function collectMissingConditionalRequired(schema, normalizedInput) {
  return (schema.oneOfRequired || [])
    .filter((group) => !group.some((field) => normalizedInput[field] !== undefined))
    .map((group) => group.join('|'));
}

function buildNoSchemaPlan(toolName, modelProfile) {
  return {
    toolName,
    modelProfile: preserveModelProfile(modelProfile),
    status: 'suggestion_only',
    failureType: 'no_schema',
    canRedispatch: false,
    correctedInput: null,
    appliedFixes: [],
    suggestedFixes: [
      {
        type: 'registry_missing',
        toolName,
      },
    ],
    blockedReason: null,
    missingRequired: [],
    typeMismatches: [],
  };
}

function buildCorrectionPlan({ toolName, toolInput, modelProfile }) {
  const schema = getToolSchema(toolName, { modelProfile });
  if (!schema) {
    return buildNoSchemaPlan(toolName, modelProfile);
  }

  const normalizedToolInput = normalizeToolInput(toolInput);
  if (normalizedToolInput.kind !== 'object') {
    return {
      toolName,
      modelProfile: schema.modelProfile,
      status: 'blocked',
      failureType: 'validation_type_mismatch',
      canRedispatch: false,
      correctedInput: null,
      appliedFixes: [],
      suggestedFixes: [],
      blockedReason: 'unsafe_type_mismatch',
      missingRequired: [],
      typeMismatches: [
        {
          field: '$root',
          expectedType: 'object',
          actualType: getActualType(normalizedToolInput.value),
        },
      ],
    };
  }

  const rawInput = normalizedToolInput.value;
  const normalizedInput = {};
  const appliedFixes = [];
  const typeMismatches = [];

  for (const [rawKey, rawValue] of Object.entries(rawInput)) {
    const canonicalKey = schema.aliases[rawKey] || rawKey;
    const canonicalValueProvided = Object.prototype.hasOwnProperty.call(rawInput, canonicalKey);

    if (schema.aliases[rawKey] && canonicalValueProvided) {
      appliedFixes.push({
        type: 'drop_shadowed_alias',
        from: rawKey,
        to: canonicalKey,
      });
      continue;
    }

    if (schema.aliases[rawKey] && !(canonicalKey in rawInput) && !(canonicalKey in normalizedInput)) {
      appliedFixes.push({
        type: 'rename_alias',
        from: rawKey,
        to: canonicalKey,
      });
    }

    if (!schema.properties[canonicalKey]) {
      appliedFixes.push({
        type: 'drop_unknown_property',
        from: rawKey,
      });
      continue;
    }

    if (canonicalKey in normalizedInput) {
      continue;
    }

    const expectedType = schema.properties[canonicalKey];
    const coercion = coerceLosslessValue(rawValue, expectedType);
    if (!coercion.ok) {
      typeMismatches.push({
        field: canonicalKey,
        expectedType,
        actualType: getActualType(rawValue),
      });
      continue;
    }

    if (coercion.changed) {
      appliedFixes.push({
        type: 'coerce_scalar',
        field: canonicalKey,
        from: typeof rawValue,
        to: expectedType,
      });
    }

    normalizedInput[canonicalKey] = coercion.value;
  }

  const missingRequired = schema.required.filter((field) => normalizedInput[field] === undefined);
  const missingConditionalRequired = collectMissingConditionalRequired(schema, normalizedInput);
  const missingFields = [...missingRequired, ...missingConditionalRequired];
  const failureType = selectFailureType({ missingRequired: missingFields, typeMismatches, appliedFixes });

  if (missingFields.length > 0) {
    return {
      toolName,
      modelProfile: schema.modelProfile,
      status: 'blocked',
      failureType,
      canRedispatch: false,
      correctedInput: null,
      appliedFixes,
      suggestedFixes: [],
      blockedReason: 'missing_required_value',
      missingRequired: missingFields,
      typeMismatches,
    };
  }

  if (typeMismatches.length > 0) {
    return {
      toolName,
      modelProfile: schema.modelProfile,
      status: 'blocked',
      failureType,
      canRedispatch: false,
      correctedInput: null,
      appliedFixes,
      suggestedFixes: [],
      blockedReason: 'unsafe_type_mismatch',
      missingRequired: missingFields,
      typeMismatches,
    };
  }

  return {
    toolName,
    modelProfile: schema.modelProfile,
    status: appliedFixes.length > 0 ? 'suggested' : 'valid',
    failureType,
    canRedispatch: false,
    correctedInput: normalizedInput,
    appliedFixes,
    suggestedFixes: [],
    blockedReason: null,
    missingRequired: missingFields,
    typeMismatches,
  };
}

function safeReadSession(handle, sessionId) {
  if (!handle || typeof handle.prepare !== 'function' || !sessionId) {
    return null;
  }

  try {
    return handle.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  } catch {
    return null;
  }
}

function matchesExpectedPlan(plan, expected = {}) {
  if (expected.status !== undefined && plan.status !== expected.status) {
    return false;
  }

  if (expected.failureType !== undefined && plan.failureType !== expected.failureType) {
    return false;
  }

  if (expected.blockedReason !== undefined && plan.blockedReason !== expected.blockedReason) {
    return false;
  }

  if (expected.modelProfile !== undefined && plan.modelProfile !== normalizeModelProfile(expected.modelProfile)) {
    return false;
  }

  if (expected.correctedInput !== undefined) {
    if (JSON.stringify(plan.correctedInput) !== JSON.stringify(expected.correctedInput)) {
      return false;
    }
  }

  if (expected.missingRequired !== undefined) {
    const actualMissing = [...(plan.missingRequired || [])].sort();
    const expectedMissing = [...expected.missingRequired].sort();
    if (JSON.stringify(actualMissing) !== JSON.stringify(expectedMissing)) {
      return false;
    }
  }

  if (expected.appliedFixTypes !== undefined) {
    const actualFixTypes = (plan.appliedFixes || []).map((fix) => fix.type);
    if (JSON.stringify(actualFixTypes) !== JSON.stringify(expected.appliedFixTypes)) {
      return false;
    }
  }

  return true;
}

function evaluateCorrectionCases(cases) {
  const evaluatedCases = (cases || []).map((testCase) => {
    const actualPlan = buildCorrectionPlan({
      toolName: testCase.toolName,
      toolInput: testCase.toolInput,
      modelProfile: testCase.modelProfile,
    });
    const hit = matchesExpectedPlan(actualPlan, testCase.expected);

    return {
      name: testCase.name || null,
      toolName: testCase.toolName,
      modelProfile: actualPlan.modelProfile,
      hit,
      expected: testCase.expected || {},
      actualPlan,
    };
  });

  const hits = evaluatedCases.filter((testCase) => testCase.hit).length;
  const total = evaluatedCases.length;

  return {
    total,
    hits,
    missCount: total - hits,
    hitRate: total === 0 ? 0 : hits / total,
    cases: evaluatedCases,
  };
}

function processFailurePayload({ payload, dbModule = db }) {
  const toolName = payload.tool_name || payload.toolName || payload.tool || '';
  if (!toolName) {
    return { exitCode: 0, plan: null };
  }

  const toolInput = firstDefined(payload.tool_input, payload.toolInput, payload.input, {});
  const toolOutput = firstDefined(payload.tool_output, payload.toolOutput, payload.output, payload.tool_response, '');
  const sessionId = firstDefined(payload.session_id, payload.sessionId, null);
  const modelProfile = firstDefined(payload.model_profile, payload.modelProfile, payload.model_name, payload.model, null);
  const cwd = firstDefined(payload.cwd, process.cwd());
  const createdAt = new Date().toISOString();
  const plan = buildCorrectionPlan({ toolName, toolInput, modelProfile });
  const observationOutput = {
    toolName,
    modelProfile: plan.modelProfile,
    status: plan.status,
    failureType: plan.failureType,
    canRedispatch: false,
    appliedFixes: plan.appliedFixes,
    suggestedFixes: plan.suggestedFixes,
    correctedInput: plan.correctedInput,
    blockedReason: plan.blockedReason,
    missingRequired: plan.missingRequired,
    typeMismatches: plan.typeMismatches,
    originalToolOutput: typeof toolOutput === 'string' ? toolOutput : stringifyValue(toolOutput),
  };

  if (!dbModule.isAvailable || !dbModule.isAvailable()) {
    return { exitCode: 0, plan, observation: null };
  }

  const handle = dbModule.open ? dbModule.open() : null;
  if (!handle) {
    return { exitCode: 0, plan, observation: null };
  }

  try {
    try {
      const projectId = dbModule.detectProjectId ? dbModule.detectProjectId(cwd) : null;
      const existingSession = safeReadSession(handle, sessionId);

      if (sessionId && !existingSession && typeof dbModule.upsertSession === 'function') {
        dbModule.upsertSession(handle, {
          id: sessionId,
          startedAt: createdAt,
          projectId,
        });
      }

      const observation = {
        sessionId,
        projectId,
        toolName,
        toolInput: sanitizeObservationText(stringifyValue(toolInput)),
        toolOutput: sanitizeObservationText(JSON.stringify(observationOutput)),
        eventType: 'tool_correction_dry_run',
        createdAt,
      };

      if (typeof dbModule.insertObservation === 'function') {
        dbModule.insertObservation(handle, observation);
      }

      return { exitCode: 0, plan, observation };
    } catch {
      return { exitCode: 0, plan, observation: null };
    }
  } finally {
    if (typeof dbModule.close === 'function') {
      try {
        dbModule.close();
      } catch {
        // Best-effort observation persistence must not break the failure hook.
      }
    }
  }
}

function parseCliArgs(argv) {
  const args = {
    mode: 'hook',
  };

  const subcommand = argv[2];
  if (subcommand === 'classify' || subcommand === 'correct' || subcommand === 'eval') {
    args.mode = subcommand;
  }

  for (let index = args.mode === 'hook' ? 2 : 3; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--tool') {
      args.toolName = next;
      index += 1;
      continue;
    }
    if (arg === '--input') {
      args.toolInput = next === undefined ? '' : next;
      if (next !== undefined) {
        index += 1;
      }
      continue;
    }
    if (arg === '--input-file') {
      args.inputFile = next;
      index += 1;
      continue;
    }
    if (arg === '--model-profile') {
      args.modelProfile = next;
      index += 1;
      continue;
    }
    if (arg === '--cases') {
      args.casesFile = next;
      index += 1;
    }
  }

  return args;
}

function loadCliInput(args) {
  if (args.inputFile) {
    return JSON.parse(fs.readFileSync(args.inputFile, 'utf8'));
  }

  const structured = parseStructuredValue(args.toolInput);
  if (structured !== null) {
    return structured;
  }

  if (args.toolInput !== undefined) {
    return args.toolInput;
  }

  return {};
}

function loadEvaluationCases(args) {
  return JSON.parse(fs.readFileSync(args.casesFile || DEFAULT_EVAL_CASES_PATH, 'utf8'));
}

function runCli(argv = process.argv, { contextPayload, dbModule } = {}) {
  const args = parseCliArgs(argv);
  if (args.mode === 'classify' || args.mode === 'correct') {
    const plan = buildCorrectionPlan({
      toolName: args.toolName,
      toolInput: loadCliInput(args),
      modelProfile: args.modelProfile,
    });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }

  if (args.mode === 'eval') {
    const report = evaluateCorrectionCases(loadEvaluationCases(args));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const context = contextPayload ? { payload: contextPayload } : getContext();
  const payload = context.payload || {};
  return processFailurePayload({ payload, dbModule }).exitCode;
}

module.exports = {
  buildCorrectionPlan,
  evaluateCorrectionCases,
  matchesExpectedPlan,
  parseStructuredValue,
  processFailurePayload,
  runCli,
};

if (require.main === module) {
  process.exitCode = runCli(process.argv);
}