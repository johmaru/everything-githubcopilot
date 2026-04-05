const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let verificationEval = null;
let loadError = null;

try {
  verificationEval = require('../../scripts/hooks/verification-eval');
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

function ensureLoaded() {
  if (loadError) {
    throw loadError;
  }
}

console.log('verification-eval.js tests');

const results = [];

results.push(test('loads the verification eval module', () => {
  ensureLoaded();
  assert.ok(verificationEval);
}));

results.push(test('shipped verification eval fixture covers at least four benchmark cases', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'verification', 'eval-cases.json');
  const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  assert.ok(Array.isArray(cases));
  assert.ok(cases.length >= 4, `expected at least 4 shipped cases, received ${cases.length}`);
  assert.ok(cases.every((testCase) => testCase.name && testCase.expected && testCase.session));
}));

results.push(test('evaluateVerificationCases reports hit rate for the shipped state transitions', () => {
  ensureLoaded();

  const report = verificationEval.evaluateVerificationCases([
    {
      name: 'neutral case',
      session: {},
      expected: {
        status: 'neutral',
        incompleteCount: 0,
        blockReason: null,
      },
    },
    {
      name: 'blocked case',
      session: {
        todoTool: 'todo',
        tasks: [
          {
            taskKey: 'verify-blocked',
            description: 'Finish checklist gate',
            status: 'in-progress',
          },
        ],
      },
      expected: {
        status: 'blocked',
        incompleteCount: 1,
        blockReason: 'incomplete_tasks',
      },
    },
    {
      name: 'pass case',
      session: {
        todoTool: 'manage_todo_list',
        tasks: [
          {
            taskKey: 'verify-pass',
            description: 'Checklist done',
            status: 'completed',
          },
        ],
      },
      expected: {
        status: 'pass',
        incompleteCount: 0,
        blockReason: null,
      },
    },
  ]);

  assert.strictEqual(report.total, 3);
  assert.strictEqual(report.hits, 3);
  assert.strictEqual(report.missCount, 0);
  assert.strictEqual(report.hitRate, 1);
}));

results.push(test('eval CLI uses the shipped verification fixture when cases are omitted', () => {
  const output = JSON.parse(execFileSync('node', [
    path.join(__dirname, '..', '..', 'scripts', 'hooks', 'verification-eval.js'),
    'eval',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  }));

  assert.ok(output.total >= 4);
  assert.strictEqual(output.missCount, 0);
  assert.strictEqual(output.hitRate, 1);
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}
