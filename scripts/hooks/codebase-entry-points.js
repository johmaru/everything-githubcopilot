#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const embedding = require('./embedding');

const SUPPORTED_EXTENSIONS = new Set(['.py', '.rs', '.ts']);
const EXCLUDED_DIRS = new Set(['.git', 'dist', 'node_modules', 'target']);
const DEFAULT_INDEX_PATH = path.join('.github', 'sessions', 'codebase-entry-points.json');
const DEFAULT_EVAL_CASES_PATH = path.join('tests', 'fixtures', 'entry-points', 'eval-cases.json');
const INDEX_VERSION = 1;
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_REAL_ROOT = fs.realpathSync.native(WORKSPACE_ROOT);
const RUST_MANIFEST_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'rust',
  'semantic-indexer',
  'Cargo.toml'
);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function normalizeRelativePath(rootDir, absolutePath) {
  return normalizePath(path.relative(rootDir, absolutePath));
}

function resolveRealPathCandidate(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  let probePath = resolvedPath;

  while (!fs.existsSync(probePath)) {
    const parentPath = path.dirname(probePath);
    if (parentPath === probePath) {
      break;
    }
    probePath = parentPath;
  }

  const realProbePath = fs.realpathSync.native(probePath);
  const relativeTail = path.relative(probePath, resolvedPath);
  return path.resolve(realProbePath, relativeTail);
}

function ensureWithinWorkspace(targetPath, label) {
  const resolvedPath = resolveRealPathCandidate(targetPath);
  const relativePath = path.relative(WORKSPACE_REAL_ROOT, resolvedPath);
  if (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  ) {
    return resolvedPath;
  }

  throw new Error(`${label} must stay within the workspace: ${targetPath}`);
}

function shouldIncludeDirectory(rootDir, absoluteDirPath, depth) {
  const entryName = path.basename(absoluteDirPath);
  if (EXCLUDED_DIRS.has(entryName)) {
    return false;
  }

  const relativePath = normalizeRelativePath(rootDir, absoluteDirPath);
  if (relativePath === '.github/sessions' || relativePath.startsWith('.github/sessions/')) {
    return false;
  }

  if (
    depth > 0 &&
    entryName.startsWith('.') &&
    entryName !== '.github' &&
    entryName !== '.opencode'
  ) {
    return false;
  }

  return true;
}

function collectSourceFiles(rootDir) {
  const root = path.resolve(rootDir);
  const files = [];

  function walk(currentDir, depth) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (shouldIncludeDirectory(root, absolutePath, depth + 1)) {
          walk(absolutePath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        continue;
      }

      const stat = fs.statSync(absolutePath);
      files.push({
        absolutePath,
        relativePath: normalizeRelativePath(root, absolutePath),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  walk(root, 0);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

function buildManifest(files) {
  return files.reduce((manifest, file) => {
    manifest[file.relativePath] = {
      mtimeMs: file.mtimeMs,
      size: file.size,
    };
    return manifest;
  }, {});
}

function detectIndexChanges(previousManifest = {}, currentFiles = []) {
  const currentByPath = new Map(currentFiles.map((file) => [file.relativePath, file]));
  const changedFiles = currentFiles.filter((file) => {
    const previous = previousManifest[file.relativePath];
    return !previous || previous.mtimeMs !== file.mtimeMs || previous.size !== file.size;
  });
  const removedFiles = Object.keys(previousManifest)
    .filter((relativePath) => !currentByPath.has(relativePath))
    .sort();

  changedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { changedFiles, removedFiles };
}

function mergeIndexedEntries(existingEntries, nextEntries, changedPaths, removedPaths) {
  const replacedPaths = new Set([...changedPaths, ...removedPaths]);
  const retainedEntries = (existingEntries || []).filter(
    (entry) => !replacedPaths.has(entry.file_path)
  );
  const merged = retainedEntries.concat(nextEntries || []);
  merged.sort((left, right) => {
    return (
      left.file_path.localeCompare(right.file_path) ||
      String(left.chunk_id).localeCompare(String(right.chunk_id))
    );
  });
  return merged;
}

function dotSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    return 0;
  }

  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += Number(left[index] || 0) * Number(right[index] || 0);
  }
  return score;
}

function sanitizeRankedEntry(entry, score) {
  const { embedding: _embedding, ...rest } = entry;
  return { ...rest, score };
}

function rankEntryPoints(queryEmbedding, entries, topK = 5) {
  return (entries || [])
    .filter((entry) => Array.isArray(entry.embedding) && entry.embedding.length > 0)
    .map((entry) => sanitizeRankedEntry(entry, dotSimilarity(queryEmbedding, entry.embedding)))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

function rankEntryPointsByKeyword(query, entries, topK = 5) {
  const queryTokens = new Set(tokenize(query));
  const denominator = Math.max(queryTokens.size, 1);

  return (entries || [])
    .map((entry) => {
      const entryTokens = new Set(tokenize(`${entry.name || ''} ${entry.file_path || ''} ${entry.text || ''}`));
      let overlap = 0;
      for (const token of queryTokens) {
        if (entryTokens.has(token)) {
          overlap += 1;
        }
      }
      return sanitizeRankedEntry(entry, overlap / denominator);
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

function matchesExpected(entry, expected = {}) {
  if (expected.stable_symbol_id && entry.stable_symbol_id !== expected.stable_symbol_id) {
    return false;
  }
  if (expected.file_path && entry.file_path !== expected.file_path) {
    return false;
  }
  if (expected.name && entry.name !== expected.name) {
    return false;
  }
  return true;
}

function evaluateQueries(cases, entries, topK = 5) {
  const evaluatedCases = (cases || []).map((testCase) => {
    const ranked = Array.isArray(testCase.queryEmbedding)
      ? rankEntryPoints(testCase.queryEmbedding, entries, topK)
      : rankEntryPointsByKeyword(testCase.query, entries, topK);
    const hit = ranked.some((entry) => matchesExpected(entry, testCase.expected));

    return {
      query: testCase.query,
      expected: testCase.expected,
      hit,
      topResults: ranked,
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

function resolveIndexPath(rootDir, indexPath) {
  if (!indexPath) {
    return ensureWithinWorkspace(path.join(rootDir, DEFAULT_INDEX_PATH), 'index path');
  }
  const resolvedPath = path.isAbsolute(indexPath)
    ? indexPath
    : path.resolve(rootDir, indexPath);
  return ensureWithinWorkspace(resolvedPath, 'index path');
}

function loadIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return {
      version: INDEX_VERSION,
      model: embedding.MODEL_ID,
      root: null,
      generatedAt: null,
      manifest: {},
      entries: [],
    };
  }

  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function saveIndex(indexPath, payload) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(payload, null, 2));
}

function parseJsonLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runSemanticIndexer(rootDir, files) {
  const args = ['run', '--quiet', '--manifest-path', RUST_MANIFEST_PATH, '--', '--root', rootDir, '--format', 'jsonl'];
  for (const file of files) {
    args.push('--file', file);
  }

  const output = execFileSync('cargo', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return parseJsonLines(output);
}

async function attachEmbeddings(records) {
  if (!records.length) {
    return [];
  }

  const vectors = await embedding.embedBatch(records.map((record) => record.text));
  return records.map((record, index) => ({
    ...record,
    embedding: Array.isArray(vectors[index]) || vectors[index] instanceof Float32Array
      ? Array.from(vectors[index])
      : null,
  }));
}

async function enrichEvaluationCases(cases) {
  if (!embedding.isAvailable() || !cases.length) {
    return cases;
  }

  const queryEmbeddings = await embedding.embedBatch(cases.map((testCase) => testCase.query));
  return cases.map((testCase, index) => ({
    ...testCase,
    queryEmbedding: queryEmbeddings[index] ? Array.from(queryEmbeddings[index]) : testCase.queryEmbedding,
  }));
}

function parseArgs(argv) {
  const [command = 'index', ...rest] = argv;
  const options = {
    command,
    files: [],
    force: false,
    topK: 5,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    switch (arg) {
      case '--root':
        options.root = rest[index + 1];
        index += 1;
        break;
      case '--index-file':
        options.indexFile = rest[index + 1];
        index += 1;
        break;
      case '--file':
        options.files.push(rest[index + 1]);
        index += 1;
        break;
      case '--query':
        options.query = rest[index + 1];
        index += 1;
        break;
      case '--cases':
        options.casesFile = rest[index + 1];
        index += 1;
        break;
      case '--top-k':
        options.topK = Number(rest[index + 1] || 5);
        index += 1;
        break;
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function resolveRequestedFiles(rootDir, currentFiles, requestedFiles) {
  if (!requestedFiles || requestedFiles.length === 0) {
    return { selectedFiles: currentFiles, missingRelativePaths: [] };
  }

  const currentFilesByPath = new Map(currentFiles.map((file) => [file.relativePath, file]));
  const requestedPaths = new Set(
    requestedFiles.map((file) => {
      const absolutePath = ensureWithinWorkspace(
        path.isAbsolute(file) ? file : path.resolve(rootDir, file),
        'requested source file'
      );
      return normalizeRelativePath(rootDir, absolutePath);
    })
  );

  const selectedFiles = currentFiles.filter((file) => requestedPaths.has(file.relativePath));
  const missingRelativePaths = [...requestedPaths].filter(
    (relativePath) => !currentFilesByPath.has(relativePath)
  );

  return { selectedFiles, missingRelativePaths };
}

async function runIndexCommand(options) {
  const rootDir = ensureWithinWorkspace(options.root || process.cwd(), 'root path');
  const stat = fs.statSync(rootDir, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory()) {
    throw new Error(`root path must be an existing directory: ${rootDir}`);
  }

  const indexPath = resolveIndexPath(rootDir, options.indexFile);
  const currentFiles = collectSourceFiles(rootDir);
  const requestedFiles = resolveRequestedFiles(rootDir, currentFiles, options.files);
  const existingIndex = loadIndex(indexPath);

  let changedFiles = requestedFiles.selectedFiles;
  let removedFiles = [];
  if (!options.force && options.files.length === 0) {
    const changes = detectIndexChanges(existingIndex.manifest || {}, currentFiles);
    changedFiles = changes.changedFiles;
    removedFiles = changes.removedFiles;
  } else if (options.files.length > 0) {
    removedFiles = requestedFiles.missingRelativePaths.filter(
      (relativePath) => existingIndex.manifest && existingIndex.manifest[relativePath]
    );
  }

  const indexedRecords = changedFiles.length > 0
    ? await attachEmbeddings(runSemanticIndexer(rootDir, changedFiles.map((file) => file.absolutePath)))
    : [];

  const nextEntries = mergeIndexedEntries(
    existingIndex.entries || [],
    indexedRecords,
    changedFiles.map((file) => file.relativePath),
    removedFiles
  );

  let nextManifest;
  if (options.files.length > 0) {
    nextManifest = {
      ...(existingIndex.manifest || {}),
      ...buildManifest(changedFiles),
    };
    for (const removedPath of removedFiles) {
      delete nextManifest[removedPath];
    }
  } else {
    nextManifest = buildManifest(currentFiles);
  }

  saveIndex(indexPath, {
    version: INDEX_VERSION,
    model: embedding.MODEL_ID,
    root: rootDir,
    generatedAt: new Date().toISOString(),
    manifest: nextManifest,
    entries: nextEntries,
  });

  return {
    indexPath,
    root: rootDir,
    totalFiles: currentFiles.length,
    indexedFiles: changedFiles.map((file) => file.relativePath),
    removedFiles,
    entryCount: nextEntries.length,
    usedEmbeddings: indexedRecords.some((record) => Array.isArray(record.embedding)),
  };
}

async function runQueryCommand(options) {
  if (!options.query) {
    throw new Error('--query is required for query command');
  }

  const rootDir = ensureWithinWorkspace(options.root || process.cwd(), 'root path');
  const indexPath = resolveIndexPath(rootDir, options.indexFile);
  const indexPayload = loadIndex(indexPath);
  if (!Array.isArray(indexPayload.entries) || indexPayload.entries.length === 0) {
    throw new Error(`entry point index is empty: ${indexPath}`);
  }

  const queryEmbedding = await embedding.embed(options.query);
  const results = queryEmbedding
    ? rankEntryPoints(Array.from(queryEmbedding), indexPayload.entries, options.topK)
    : rankEntryPointsByKeyword(options.query, indexPayload.entries, options.topK);

  return {
    query: options.query,
    topK: options.topK,
    usedEmbeddings: Boolean(queryEmbedding),
    results,
  };
}

async function runEvalCommand(options) {
  const rootDir = ensureWithinWorkspace(options.root || process.cwd(), 'root path');
  const indexPath = resolveIndexPath(rootDir, options.indexFile);
  const indexPayload = loadIndex(indexPath);
  const requestedCasesPath = options.casesFile || DEFAULT_EVAL_CASES_PATH;
  const casesPath = ensureWithinWorkspace(
    path.isAbsolute(requestedCasesPath)
      ? requestedCasesPath
      : path.resolve(rootDir, requestedCasesPath),
    'evaluation cases path'
  );
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const enrichedCases = await enrichEvaluationCases(cases);

  return evaluateQueries(enrichedCases, indexPayload.entries || [], options.topK);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let result;
  switch (options.command) {
    case 'index':
      result = await runIndexCommand(options);
      break;
    case 'query':
      result = await runQueryCommand(options);
      break;
    case 'eval':
      result = await runEvalCommand(options);
      break;
    default:
      throw new Error(`Unsupported command: ${options.command}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  buildManifest,
  collectSourceFiles,
  detectIndexChanges,
  ensureWithinWorkspace,
  evaluateQueries,
  mergeIndexedEntries,
  rankEntryPoints,
  rankEntryPointsByKeyword,
  resolveRequestedFiles,
  runEvalCommand,
  runIndexCommand,
  runQueryCommand,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}