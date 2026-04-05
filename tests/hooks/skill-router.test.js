const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let skillRouter = null;
let loadError = null;

try {
  skillRouter = require('../../scripts/hooks/skill-router');
} catch (error) {
  loadError = error;
}

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function ensureRouterLoaded() {
  if (loadError) {
    throw loadError;
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-skill-router-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeSkill(rootDir, relativeSkillPath, content) {
  writeFile(path.join(rootDir, relativeSkillPath), content);
}

function runRouter(args, cwd) {
  return execFileSync('node', [path.join(__dirname, '..', '..', 'scripts', 'hooks', 'skill-router.js'), ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

function createSkillWorkspace() {
  const testDir = createTestDir();

  writeSkill(
    testDir,
    path.join('.github', 'skills', 'blueprint', 'SKILL.md'),
    `---
name: blueprint
description: >-
  Turn a one-line objective into a step-by-step construction plan.
  TRIGGER when: user requests a plan, blueprint, or roadmap for a
  complex multi-PR task.
  DO NOT TRIGGER when: task is completable in a single PR or user says
  "just do it".
---
# Blueprint
`
  );

  writeSkill(
    testDir,
    path.join('.github', 'skills', 'prompt-optimizer', 'SKILL.md'),
    `---
name: prompt-optimizer
description: >-
  Analyze raw prompts and improve prompt quality.
  TRIGGER when: user says "optimize prompt", "rewrite this prompt",
  or asks how to write a prompt.
  DO NOT TRIGGER when: user says "optimize performance" or asks to
  execute the task directly.
---
# Prompt Optimizer
`
  );

  writeSkill(
    testDir,
    path.join('.github', 'skills', 'benchmark', 'SKILL.md'),
    `# Benchmark — Performance Baseline & Regression Detection

## When to Use

- Before and after a PR to measure performance impact
- When users report "it feels slow"
`
  );

  writeFile(
    path.join(testDir, '.github', 'skills', 'blueprint', 'reference.md'),
    '# not a skill catalog entry\n'
  );
  writeSkill(
    testDir,
    path.join('scripts', '.github', 'skills', 'shadow-copy', 'SKILL.md'),
    `---
name: shadow-copy
description: this file must be ignored by the shipped catalog loader
---
# Shadow Copy
`
  );

  return testDir;
}

console.log('skill-router.js tests');

const results = [];

results.push(test('loads the skill router module', () => {
  ensureRouterLoaded();
  assert.ok(skillRouter);
}));

results.push(test('collectSkillFiles scopes catalog discovery to .github/skills top-level entries', () => {
  ensureRouterLoaded();
  const testDir = createSkillWorkspace();

  try {
    const files = skillRouter.collectSkillFiles(testDir).map((filePath) =>
      path.relative(testDir, filePath).split(path.sep).join('/')
    );

    assert.deepStrictEqual(files, [
      '.github/skills/benchmark/SKILL.md',
      '.github/skills/blueprint/SKILL.md',
      '.github/skills/prompt-optimizer/SKILL.md',
    ]);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('loadSkillCatalog reads frontmatter signals and falls back to heading metadata', () => {
  ensureRouterLoaded();
  const testDir = createSkillWorkspace();

  try {
    const catalog = skillRouter.loadSkillCatalog(testDir);
    const byName = new Map(catalog.map((entry) => [entry.name, entry]));

    assert.strictEqual(catalog.length, 3);
    assert.ok(byName.has('blueprint'));
    assert.ok(byName.has('prompt-optimizer'));
    assert.ok(byName.has('benchmark'));
    assert.ok(byName.get('blueprint').triggerPhrases.includes('roadmap'));
    assert.ok(byName.get('prompt-optimizer').negativePhrases.includes('optimize performance'));
    assert.strictEqual(byName.get('benchmark').description, '');
    assert.ok(byName.get('benchmark').keywords.includes('performance'));
    assert.strictEqual(byName.get('benchmark').title, 'Benchmark');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('recommendSkills ranks keyword-first matches and returns the matched signals', () => {
  ensureRouterLoaded();
  const testDir = createSkillWorkspace();

  try {
    const catalog = skillRouter.loadSkillCatalog(testDir);
    const result = skillRouter.recommendSkills({
      query: 'Create a roadmap and plan for a multi-PR migration',
      skills: catalog,
      topK: 2,
      minScore: 0.15,
    });

    assert.strictEqual(result.usedEmbeddings, false);
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].name, 'blueprint');
    assert.ok(result.results[0].score >= 0.15);
    assert.ok(result.results[0].matchedSignals.includes('roadmap'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('recommendSkills suppresses results when a negative trigger matches the query intent', () => {
  ensureRouterLoaded();
  const testDir = createSkillWorkspace();

  try {
    const catalog = skillRouter.loadSkillCatalog(testDir);
    const result = skillRouter.recommendSkills({
      query: 'Optimize performance of this code path',
      skills: catalog,
      topK: 3,
      minScore: 0.05,
    });

    assert.ok(!result.results.some((entry) => entry.name === 'prompt-optimizer'));
    assert.ok(result.results.some((entry) => entry.name === 'benchmark'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('recommendSkills returns an empty recommendation set below the minimum score threshold', () => {
  ensureRouterLoaded();
  const testDir = createSkillWorkspace();

  try {
    const catalog = skillRouter.loadSkillCatalog(testDir);
    const result = skillRouter.recommendSkills({
      query: 'warehouse picking lane balancing',
      skills: catalog,
      topK: 3,
      minScore: 0.3,
    });

    assert.deepStrictEqual(result.results, []);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('evaluateSkillRouterCases reports hit rate for deterministic keyword routing', () => {
  ensureRouterLoaded();
  const testDir = createSkillWorkspace();

  try {
    const catalog = skillRouter.loadSkillCatalog(testDir);
    const report = skillRouter.evaluateSkillRouterCases({
      skills: catalog,
      cases: [
        {
          query: 'Need a multi-PR roadmap and implementation plan',
          expectedSkill: 'blueprint',
        },
        {
          query: 'Please rewrite this prompt for GitHub Copilot',
          expectedSkill: 'prompt-optimizer',
        },
        {
          query: 'Benchmark the page because it feels slow',
          expectedSkill: 'benchmark',
        },
      ],
      topK: 1,
      minScore: 0.05,
    });

    assert.strictEqual(report.total, 3);
    assert.strictEqual(report.hits, 3);
    assert.strictEqual(report.missCount, 0);
    assert.strictEqual(report.hitRate, 1);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('recommend CLI stays usable without a query and returns an empty recommendation payload', () => {
  ensureRouterLoaded();
  const testDir = createSkillWorkspace();

  try {
    const output = JSON.parse(runRouter(['recommend', '--root', testDir], testDir));
    assert.deepStrictEqual(output.results, []);
    assert.strictEqual(output.query, '');
    assert.ok(output.warning.includes('--query'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('recommendSkills matches the hyphenated single-token slugs used by prompt guidance', () => {
  ensureRouterLoaded();
  const testDir = createSkillWorkspace();

  try {
    const catalog = skillRouter.loadSkillCatalog(testDir);
    const result = skillRouter.recommendSkills({
      query: 'rewrite-this-prompt-for-github-copilot',
      skills: catalog,
      topK: 1,
      minScore: 0.05,
    });

    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].name, 'prompt-optimizer');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('shipped skill-router eval fixture covers at least five benchmark cases', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'skill-router', 'eval-cases.json');
  const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  assert.ok(Array.isArray(cases));
  assert.ok(cases.length >= 5, `expected at least 5 shipped cases, received ${cases.length}`);
  assert.ok(cases.every((testCase) => testCase.query && testCase.expectedSkill));
}));

results.push(test('eval CLI uses the shipped skill-router fixture when cases are omitted', () => {
  ensureRouterLoaded();

  const output = JSON.parse(runRouter(['eval', '--top-k', '1', '--min-score', '0.05'], process.cwd()));

  assert.ok(output.total >= 5);
  assert.strictEqual(output.missCount, 0);
  assert.strictEqual(output.hitRate, 1);
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}