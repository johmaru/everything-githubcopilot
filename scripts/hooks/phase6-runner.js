#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const codebaseEntryPoints = require('./codebase-entry-points');
const phase6Benchmark = require('./phase6-benchmark');
const skillRouter = require('./skill-router');
const toolCallCorrection = require('./tool-call-correction');
const verificationEval = require('./verification-eval');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INDEX_FILE = path.join('.github', 'sessions', 'phase6-benchmark-index.json');
const DEFAULT_SKILL_ROUTER_CASES = path.join(DEFAULT_ROOT, 'tests', 'fixtures', 'skill-router', 'eval-cases.json');
const DEFAULT_CORRECTION_CASES = path.join(DEFAULT_ROOT, 'tests', 'fixtures', 'tool-call-correction', 'eval-cases.json');
const DEFAULT_VERIFICATION_CASES = path.join(DEFAULT_ROOT, 'tests', 'fixtures', 'verification', 'eval-cases.json');

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function readJson(filePath) {
  return JSON.parse(readUtf8(filePath));
}

function parseArgs(argv) {
  const options = {
    command: argv[2] || 'run',
    root: DEFAULT_ROOT,
    indexFile: DEFAULT_INDEX_FILE,
    topK: 5,
    minScore: 0.1,
    useEmbeddings: false,
    keepIndex: false,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--root') {
      options.root = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--baseline') {
      options.baselineFile = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--index-file') {
      options.indexFile = next;
      index += 1;
      continue;
    }
    if (arg === '--top-k') {
      options.topK = Number(next || 5);
      index += 1;
      continue;
    }
    if (arg === '--min-score') {
      options.minScore = Number(next || 0.1);
      index += 1;
      continue;
    }
    if (arg === '--use-embeddings') {
      options.useEmbeddings = true;
      continue;
    }
    if (arg === '--keep-index') {
      options.keepIndex = true;
    }
  }

  return options;
}

async function runPhase6Benchmarks({
  root = DEFAULT_ROOT,
  indexFile = DEFAULT_INDEX_FILE,
  topK = 5,
  minScore = 0.1,
  useEmbeddings = false,
  baselineFile,
  keepIndex = false,
} = {}) {
  const resolvedIndexPath = path.isAbsolute(indexFile)
    ? indexFile
    : path.resolve(root, indexFile);

  try {
    await codebaseEntryPoints.runIndexCommand({
      root,
      indexFile,
      files: [],
      force: false,
      topK,
    });

    const entryPointRetrieval = await codebaseEntryPoints.runEvalCommand({
      root,
      indexFile,
      topK,
    });

    const skillCases = readJson(DEFAULT_SKILL_ROUTER_CASES);
    const skillCatalog = skillRouter.loadSkillCatalog(root);
    const skillRouting = useEmbeddings
      ? await skillRouter.evaluateSkillRouterCasesWithEmbeddings({
        skills: skillCatalog,
        cases: skillCases,
        topK: 1,
        minScore,
      })
      : skillRouter.evaluateSkillRouterCases({
        skills: skillCatalog,
        cases: skillCases,
        topK: 1,
        minScore,
      });

    const toolCallCorrectionReport = toolCallCorrection.evaluateCorrectionCases(
      readJson(DEFAULT_CORRECTION_CASES)
    );
    const verificationEnforcement = verificationEval.evaluateVerificationCases(
      readJson(DEFAULT_VERIFICATION_CASES)
    );

    const aggregate = phase6Benchmark.aggregateReports([
      { area: 'entry-point-retrieval', ...entryPointRetrieval },
      { area: 'skill-routing', ...skillRouting },
      { area: 'tool-call-correction', ...toolCallCorrectionReport },
      { area: 'verification-enforcement', ...verificationEnforcement },
    ]);

    const report = {
      ...aggregate,
      reports: {
        entryPointRetrieval,
        skillRouting,
        toolCallCorrection: toolCallCorrectionReport,
        verificationEnforcement,
      },
    };

    if (baselineFile) {
      report.baselineComparison = phase6Benchmark.compareToBaseline(report, readJson(baselineFile));
    }

    return report;
  } finally {
    if (!keepIndex && fs.existsSync(resolvedIndexPath)) {
      fs.rmSync(resolvedIndexPath, { force: true });
    }
  }
}

async function main(argv = process.argv) {
  const options = parseArgs(argv);
  if (options.command !== 'run') {
    throw new Error(`Unsupported command: ${options.command}`);
  }

  const report = await runPhase6Benchmarks(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

module.exports = {
  runPhase6Benchmarks,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
