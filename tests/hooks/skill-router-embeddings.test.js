const assert = require('assert');

const skillRouter = require('../../scripts/hooks/skill-router');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createEmbeddingStub(queryVector, candidateVectors) {
  return {
    lastBatchSize: 0,
    isAvailable() {
      return true;
    },
    async embed() {
      return queryVector;
    },
    async embedBatch(texts) {
      this.lastBatchSize = texts.length;
      return candidateVectors;
    },
  };
}

console.log('skill-router embedding tests');

test('recommendSkillsWithEmbeddings reranks tied keyword matches by embedding similarity', async () => {
  const skills = [
    {
      name: 'alpha-skill',
      title: 'Alpha Skill',
      description: 'router query helper',
      filePath: '.github/skills/alpha/SKILL.md',
      triggerPhrases: ['router'],
      negativePhrases: [],
      whenToUse: '',
      keywords: ['router'],
    },
    {
      name: 'beta-skill',
      title: 'Beta Skill',
      description: 'router query helper',
      filePath: '.github/skills/beta/SKILL.md',
      triggerPhrases: ['router'],
      negativePhrases: [],
      whenToUse: '',
      keywords: ['router'],
    },
  ];

  const result = await skillRouter.recommendSkillsWithEmbeddings({
    query: 'router query',
    skills,
    topK: 2,
    minScore: 0.1,
    embeddingModule: createEmbeddingStub([1, 0], [[0.2, 0], [0.9, 0]]),
  });

  assert.strictEqual(result.usedEmbeddings, true);
  assert.strictEqual(result.results[0].name, 'beta-skill');
  assert.strictEqual(result.results[1].name, 'alpha-skill');
});

test('recommendSkillsWithEmbeddings reranks all lexical candidates before applying topK', async () => {
  const embeddingStub = createEmbeddingStub([1, 0], [[-1, 0], [1, 0]]);
  const skills = [
    {
      name: 'alpha-skill',
      title: 'Alpha Skill',
      description: 'router plan helper',
      filePath: '.github/skills/alpha/SKILL.md',
      triggerPhrases: ['router', 'plan'],
      negativePhrases: [],
      whenToUse: '',
      keywords: ['router', 'plan'],
    },
    {
      name: 'gamma-skill',
      title: 'Gamma Skill',
      description: 'router helper',
      filePath: '.github/skills/gamma/SKILL.md',
      triggerPhrases: ['router'],
      negativePhrases: [],
      whenToUse: '',
      keywords: ['router'],
    },
  ];

  const lexicalResult = skillRouter.recommendSkills({
    query: 'router plan assist',
    skills,
    topK: 1,
    minScore: 0.1,
  });

  assert.strictEqual(lexicalResult.results[0].name, 'alpha-skill');

  const result = await skillRouter.recommendSkillsWithEmbeddings({
    query: 'router plan assist',
    skills,
    topK: 1,
    minScore: 0.1,
    embeddingModule: embeddingStub,
  });

  assert.strictEqual(result.usedEmbeddings, true);
  assert.strictEqual(embeddingStub.lastBatchSize, 2);
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].name, 'gamma-skill');
});

test('evaluateSkillRouterCasesWithEmbeddings reports hit rate and embedding usage', async () => {
  const skills = [
    {
      name: 'alpha-skill',
      title: 'Alpha Skill',
      description: 'router query helper',
      filePath: '.github/skills/alpha/SKILL.md',
      triggerPhrases: ['router'],
      negativePhrases: [],
      whenToUse: '',
      keywords: ['router'],
    },
    {
      name: 'beta-skill',
      title: 'Beta Skill',
      description: 'router query helper',
      filePath: '.github/skills/beta/SKILL.md',
      triggerPhrases: ['router'],
      negativePhrases: [],
      whenToUse: '',
      keywords: ['router'],
    },
  ];

  const report = await skillRouter.evaluateSkillRouterCasesWithEmbeddings({
    skills,
    cases: [
      {
        query: 'router query',
        expectedSkill: 'beta-skill',
      },
    ],
    topK: 1,
    minScore: 0.1,
    embeddingModule: createEmbeddingStub([1, 0], [[0.2, 0], [0.9, 0]]),
  });

  assert.strictEqual(report.total, 1);
  assert.strictEqual(report.hits, 1);
  assert.strictEqual(report.missCount, 0);
  assert.strictEqual(report.hitRate, 1);
  assert.strictEqual(report.usedEmbeddings, true);
  assert.strictEqual(report.cases[0].usedEmbeddings, true);
});

async function main() {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  \u2713 ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  \u2717 ${name}`);
      console.log(`    Error: ${error.message}`);
      failed += 1;
    }
  }

  console.log(`\n  ${passed} passing, ${failed} failing`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});