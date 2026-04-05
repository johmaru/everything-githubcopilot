const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let phase6Runner = null;
let loadError = null;

try {
  phase6Runner = require('../../scripts/hooks/phase6-runner');
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

async function testAsync(name, fn) {
  try {
    await fn();
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

console.log('phase6-runner.js tests');

async function main() {
  const results = [];

  results.push(test('loads the phase 6 runner module', () => {
    ensureLoaded();
    assert.ok(phase6Runner);
  }));

  results.push(await testAsync('runPhase6Benchmarks aggregates all benchmark domains', async () => {
    ensureLoaded();

    const report = await phase6Runner.runPhase6Benchmarks({
      root: process.cwd(),
      topK: 5,
      minScore: 0.05,
    });

    assert.strictEqual(report.areas.length, 4);
    assert.deepStrictEqual(report.areas.map((area) => area.area), [
      'entry-point-retrieval',
      'skill-routing',
      'tool-call-correction',
      'verification-enforcement',
    ]);
    assert.ok(report.summary.total >= 19);
    assert.strictEqual(report.summary.missCount, 0);
    assert.strictEqual(report.summary.hitRate, 1);
    assert.ok(report.reports.entryPointRetrieval);
    assert.ok(report.reports.skillRouting);
    assert.ok(report.reports.toolCallCorrection);
    assert.ok(report.reports.verificationEnforcement);
  }));

  results.push(test('CLI can attach baseline comparison data', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egc-phase6-runner-'));
    const baselinePath = path.join(tempDir, 'baseline.json');

    try {
      fs.writeFileSync(baselinePath, JSON.stringify({
        generatedAt: '2026-04-05T00:00:00Z',
        summary: {
          total: 19,
          hits: 18,
          missCount: 1,
          hitRate: 18 / 19,
          usedEmbeddings: false,
        },
        areas: [
          { area: 'entry-point-retrieval', total: 4, hits: 3, missCount: 1, hitRate: 0.75, usedEmbeddings: false },
          { area: 'skill-routing', total: 6, hits: 6, missCount: 0, hitRate: 1, usedEmbeddings: false },
          { area: 'tool-call-correction', total: 5, hits: 5, missCount: 0, hitRate: 1, usedEmbeddings: false },
          { area: 'verification-enforcement', total: 4, hits: 4, missCount: 0, hitRate: 1, usedEmbeddings: false }
        ]
      }, null, 2));

      const output = JSON.parse(execFileSync('node', [
        path.join(__dirname, '..', '..', 'scripts', 'hooks', 'phase6-runner.js'),
        'run',
        '--baseline',
        baselinePath,
        '--top-k',
        '5',
        '--min-score',
        '0.05',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      }));

      assert.ok(output.baselineComparison);
      assert.ok(output.baselineComparison.summary.deltaHitRate > 0);
      assert.strictEqual(output.summary.missCount, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }));

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;

  console.log(`\n  ${passed} passing, ${failed} failing`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
