const assert = require('assert');

let benchmark = null;
let loadError = null;

try {
  benchmark = require('../../scripts/hooks/phase6-benchmark');
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

console.log('phase6-benchmark.js tests');

const results = [];

results.push(test('loads the Phase6 benchmark helper', () => {
  ensureLoaded();
  assert.ok(benchmark);
}));

results.push(test('normalizeAreaReport shapes area metrics with defaults', () => {
  ensureLoaded();

  const report = benchmark.normalizeAreaReport('entry-point-retrieval', {
    total: 4,
    hits: 3,
    usedEmbeddings: false,
    notes: ['fallback path'],
  });

  assert.deepStrictEqual(report, {
    area: 'entry-point-retrieval',
    total: 4,
    hits: 3,
    missCount: 1,
    hitRate: 0.75,
    usedEmbeddings: false,
    notes: ['fallback path'],
  });
}));

results.push(test('aggregateReports computes rolled-up totals across areas', () => {
  ensureLoaded();

  const aggregate = benchmark.aggregateReports([
    benchmark.normalizeAreaReport('entry-point-retrieval', {
      total: 4,
      hits: 3,
      usedEmbeddings: false,
    }),
    benchmark.normalizeAreaReport('skill-routing', {
      total: 3,
      hits: 3,
      usedEmbeddings: true,
    }),
  ]);

  assert.deepStrictEqual(aggregate.summary, {
    total: 7,
    hits: 6,
    missCount: 1,
    hitRate: 6 / 7,
    usedEmbeddings: true,
  });
  assert.strictEqual(aggregate.areas.length, 2);
}));

results.push(test('compareToBaseline reports deltas by area and overall', () => {
  ensureLoaded();

  const current = benchmark.aggregateReports([
    benchmark.normalizeAreaReport('entry-point-retrieval', { total: 4, hits: 3 }),
    benchmark.normalizeAreaReport('skill-routing', { total: 3, hits: 3 }),
  ]);
  const baseline = {
    generatedAt: '2026-04-05T00:00:00.000Z',
    summary: {
      total: 7,
      hits: 5,
      missCount: 2,
      hitRate: 5 / 7,
      usedEmbeddings: false,
    },
    areas: [
      { area: 'entry-point-retrieval', total: 4, hits: 2, missCount: 2, hitRate: 0.5, usedEmbeddings: false, notes: [] },
      { area: 'skill-routing', total: 3, hits: 3, missCount: 0, hitRate: 1, usedEmbeddings: false, notes: [] },
    ],
  };

  const comparison = benchmark.compareToBaseline(current, baseline);

  assert.strictEqual(comparison.summary.deltaHits, 1);
  assert.strictEqual(comparison.summary.deltaMissCount, -1);
  assert.ok(comparison.summary.deltaHitRate > 0);
  assert.strictEqual(comparison.areas[0].area, 'entry-point-retrieval');
  assert.strictEqual(comparison.areas[0].deltaHits, 1);
  assert.strictEqual(comparison.areas[1].area, 'skill-routing');
  assert.strictEqual(comparison.areas[1].deltaHits, 0);
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}