#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const embedding = require('./embedding');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_EVAL_CASES_PATH = path.join(DEFAULT_ROOT, 'tests', 'fixtures', 'skill-router', 'eval-cases.json');
const TRIGGER_PREFIX = 'trigger when:';
const NEGATIVE_TRIGGER_PREFIX = 'do not trigger when:';
const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'asks', 'before', 'by', 'can', 'code', 'complex',
  'create', 'describes', 'directly', 'do', 'does', 'end', 'enhance', 'execute', 'explicitly',
  'fewer', 'for', 'from', 'help', 'how', 'if', 'improve', 'in', 'is', 'it', 'just', 'needs',
  'of', 'on', 'or', 'quality', 'request', 'requests', 'rewrite', 'says', 'single', 'task',
  'than', 'that', 'the', 'this', 'to', 'user', 'users', 'when', 'wants', 'with', 'write'
]);

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function normalizeSlashes(value) {
  return value.split(path.sep).join('/');
}

function tokenize(value) {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+\-\s]/gu, ' ')
    .trim();
  const segments = normalizedValue.split(/\s+/).filter(Boolean);
  const tokens = [];

  for (const segment of segments) {
    if (!STOPWORDS.has(segment)) {
      tokens.push(segment);
    }

    if (segment.includes('-')) {
      const hyphenParts = segment.split('-').filter(Boolean);
      for (const part of hyphenParts) {
        if (part.length >= 3 && !STOPWORDS.has(part)) {
          tokens.push(part);
        }
      }
    }

    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(segment)) {
      const glyphs = [...segment];
      for (let index = 0; index < glyphs.length - 1; index += 1) {
        tokens.push(glyphs.slice(index, index + 2).join(''));
      }
    }
  }

  return unique(tokens);
}

function normalizePhrase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+\-\s]/gu, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractFrontmatterBlock(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

function extractFrontmatterValue(block, key) {
  if (!block) {
    return null;
  }

  const lines = block.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith(`${key}:`)) {
      continue;
    }

    const rawValue = trimmedLine.slice(key.length + 1).trim();
    if (!rawValue) {
      return '';
    }

    if (rawValue === '>-' || rawValue === '|-' || rawValue === '>' || rawValue === '|') {
      const collected = [];
      for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
        const nestedLine = lines[nestedIndex];
        if (!nestedLine.startsWith('  ')) {
          break;
        }
        collected.push(nestedLine.trim());
      }
      return collected.join(' ').trim();
    }

    return rawValue.replace(/^['"]|['"]$/g, '');
  }

  return null;
}

function extractHeadingTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  if (!match) {
    return '';
  }

  const heading = match[1].trim();
  return heading.split(/\s+[\u2013\u2014-]\s+/)[0].trim();
}

function extractSection(content, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sectionPattern = new RegExp(`^## ${escapedHeading}\\r?$`, 'm');
  const sectionMatch = sectionPattern.exec(content);
  if (!sectionMatch) {
    return '';
  }

  const afterHeading = content.slice(sectionMatch.index + sectionMatch[0].length).replace(/^\r?\n/, '');
  const nextHeadingMatch = afterHeading.match(/^## .*\r?$/m);
  return nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading;
}

function extractQuotedPhrases(value) {
  const phrases = [];
  const regex = /"([^"]+)"/g;
  let match = regex.exec(value);
  while (match) {
    phrases.push(normalizePhrase(match[1]));
    match = regex.exec(value);
  }
  return phrases;
}

function extractTriggerSegments(description, prefix) {
  if (!description) {
    return [];
  }

  const normalizedDescription = description.replace(/\s+/g, ' ').trim();
  const lowerDescription = normalizedDescription.toLowerCase();
  const startIndex = lowerDescription.indexOf(prefix);
  if (startIndex === -1) {
    return [];
  }

  const startOffset = startIndex + prefix.length;
  const sliced = normalizedDescription.slice(startOffset);
  const negativeIndex = sliced.toLowerCase().indexOf(NEGATIVE_TRIGGER_PREFIX);
  const segment = negativeIndex >= 0 ? sliced.slice(0, negativeIndex) : sliced;

  return [segment.trim()];
}

function extractNegativeSegments(description) {
  if (!description) {
    return [];
  }

  const normalizedDescription = description.replace(/\s+/g, ' ').trim();
  const lowerDescription = normalizedDescription.toLowerCase();
  const startIndex = lowerDescription.indexOf(NEGATIVE_TRIGGER_PREFIX);
  if (startIndex === -1) {
    return [];
  }

  return [normalizedDescription.slice(startIndex + NEGATIVE_TRIGGER_PREFIX.length).trim()];
}

function phrasesFromSegments(segments) {
  const results = [];

  for (const segment of segments) {
    results.push(...extractQuotedPhrases(segment));
    results.push(...tokenize(segment));
  }

  return unique(results);
}

function negativePhrasesFromSegments(segments) {
  const results = [];

  for (const segment of segments) {
    results.push(...extractQuotedPhrases(segment));
  }

  return unique(results);
}

function keywordCandidates(skillEntry) {
  return unique([
    ...tokenize(skillEntry.name),
    ...tokenize(skillEntry.title),
    ...tokenize(skillEntry.description),
    ...tokenize(skillEntry.whenToUse),
    ...skillEntry.triggerPhrases.flatMap((phrase) => tokenize(phrase)),
  ]);
}

function collectSkillFiles(rootDir = DEFAULT_ROOT) {
  const skillsDir = path.join(rootDir, '.github', 'skills');
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsDir, entry.name, 'SKILL.md'))
    .filter((filePath) => fs.existsSync(filePath))
    .sort();
}

function parseSkillFile(filePath, rootDir = DEFAULT_ROOT) {
  const content = readUtf8(filePath);
  const frontmatterBlock = extractFrontmatterBlock(content);
  const frontmatterName = extractFrontmatterValue(frontmatterBlock, 'name');
  const description = extractFrontmatterValue(frontmatterBlock, 'description') || '';
  const title = extractHeadingTitle(content);
  const name = frontmatterName || path.basename(path.dirname(filePath));
  const whenToUse = extractSection(content, 'When to Use');
  const triggerSegments = extractTriggerSegments(description, TRIGGER_PREFIX);
  const negativeSegments = extractNegativeSegments(description);

  const entry = {
    name,
    title,
    description,
    filePath: normalizeSlashes(path.relative(rootDir, filePath)),
    triggerPhrases: phrasesFromSegments(triggerSegments),
    negativePhrases: negativePhrasesFromSegments(negativeSegments),
    whenToUse,
  };

  return {
    ...entry,
    keywords: keywordCandidates(entry),
  };
}

function loadSkillCatalog(rootDir = DEFAULT_ROOT) {
  return collectSkillFiles(rootDir).map((filePath) => parseSkillFile(filePath, rootDir));
}

function matchesNegativePhrase(query, phrases) {
  const normalizedQuery = normalizePhrase(query);
  return phrases.some((phrase) => phrase && normalizedQuery.includes(phrase));
}

function scoreSkill(query, skillEntry) {
  if (matchesNegativePhrase(query, skillEntry.negativePhrases)) {
    return null;
  }

  const normalizedQuery = normalizePhrase(query);
  const queryTokens = new Set(tokenize(query));
  const matchedSignals = [];
  let score = 0;

  for (const phrase of skillEntry.triggerPhrases) {
    if (!phrase) {
      continue;
    }

    if (phrase.includes(' ') || phrase.includes('-')) {
      if (normalizedQuery.includes(phrase)) {
        matchedSignals.push(phrase);
        score += 3;
      }
      continue;
    }

    if (queryTokens.has(phrase)) {
      matchedSignals.push(phrase);
      score += 2;
    }
  }

  for (const keyword of skillEntry.keywords) {
    if (queryTokens.has(keyword) && !matchedSignals.includes(keyword)) {
      matchedSignals.push(keyword);
      score += 1;
    }
  }

  if (matchedSignals.length === 0) {
    return null;
  }

  return {
    ...skillEntry,
    score: score / Math.max(queryTokens.size, 1),
    matchedSignals,
  };
}

async function rerankWithEmbeddings(query, rankedSkills, embeddingModule = embedding) {
  if (!embeddingModule.isAvailable || !embeddingModule.isAvailable()) {
    return { results: rankedSkills, usedEmbeddings: false };
  }

  const queryVector = await embeddingModule.embed(query);
  if (!queryVector) {
    return { results: rankedSkills, usedEmbeddings: false };
  }

  const candidateTexts = rankedSkills.map((skillEntry) => [
    skillEntry.name,
    skillEntry.title,
    skillEntry.description,
    skillEntry.whenToUse,
  ].filter(Boolean).join(' '));
  const candidateVectors = await embeddingModule.embedBatch(candidateTexts);
  if (!Array.isArray(candidateVectors) || candidateVectors.length !== rankedSkills.length) {
    return { results: rankedSkills, usedEmbeddings: false };
  }

  const reranked = rankedSkills
    .map((skillEntry, index) => {
      const candidateVector = candidateVectors[index];
      if (!candidateVector) {
        return skillEntry;
      }

      let similarity = 0;
      for (let vectorIndex = 0; vectorIndex < queryVector.length; vectorIndex += 1) {
        similarity += Number(queryVector[vectorIndex] || 0) * Number(candidateVector[vectorIndex] || 0);
      }

      return {
        ...skillEntry,
        score: (skillEntry.score * 0.7) + (similarity * 0.3),
      };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  return { results: reranked, usedEmbeddings: true };
}

function recommendSkillCandidates({ query, skills, minScore = 0.1 }) {
  return skills
    .map((skillEntry) => scoreSkill(query, skillEntry))
    .filter(Boolean)
    .filter((skillEntry) => skillEntry.score >= minScore)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

function recommendSkills(options) {
  const { query, skills = [], topK = 5, minScore = 0.1 } = options;
  const results = recommendSkillCandidates({ query, skills, minScore }).slice(0, topK);

  return {
    query,
    topK,
    minScore,
    usedEmbeddings: false,
    results,
  };
}

async function recommendSkillsWithEmbeddings(options) {
  const { query, skills = [], topK = 5, minScore = 0.1, embeddingModule = embedding } = options;
  const ranked = recommendSkillCandidates({ query, skills, minScore });
  const reranked = await rerankWithEmbeddings(query, ranked, embeddingModule);

  return {
    query,
    topK,
    minScore,
    usedEmbeddings: reranked.usedEmbeddings,
    results: reranked.results.slice(0, topK),
  };
}

function evaluateSkillRouterCases({ skills, cases, topK = 1, minScore = 0.1 }) {
  const evaluatedCases = cases.map((testCase) => {
    const recommendation = recommendSkills({
      query: testCase.query,
      skills,
      topK,
      minScore,
    });
    const hit = recommendation.results.some((entry) => entry.name === testCase.expectedSkill);

    return {
      query: testCase.query,
      expectedSkill: testCase.expectedSkill,
      hit,
      results: recommendation.results,
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

async function evaluateSkillRouterCasesWithEmbeddings({
  skills,
  cases,
  topK = 1,
  minScore = 0.1,
  embeddingModule = embedding,
}) {
  const evaluatedCases = [];
  let usedEmbeddings = false;

  for (const testCase of cases) {
    const recommendation = await recommendSkillsWithEmbeddings({
      query: testCase.query,
      skills,
      topK,
      minScore,
      embeddingModule,
    });
    usedEmbeddings = usedEmbeddings || recommendation.usedEmbeddings;
    const hit = recommendation.results.some((entry) => entry.name === testCase.expectedSkill);

    evaluatedCases.push({
      query: testCase.query,
      expectedSkill: testCase.expectedSkill,
      hit,
      usedEmbeddings: recommendation.usedEmbeddings,
      results: recommendation.results,
    });
  }

  const hits = evaluatedCases.filter((testCase) => testCase.hit).length;
  const total = evaluatedCases.length;

  return {
    total,
    hits,
    missCount: total - hits,
    hitRate: total === 0 ? 0 : hits / total,
    usedEmbeddings,
    cases: evaluatedCases,
  };
}

function parseArgs(argv) {
  const options = {
    command: argv[2] || 'recommend',
    root: DEFAULT_ROOT,
    topK: 5,
    minScore: 0.1,
    useEmbeddings: false,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--query') {
      options.query = next;
      index += 1;
      continue;
    }
    if (arg === '--root') {
      options.root = path.resolve(next);
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
    if (arg === '--cases') {
      options.casesFile = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--use-embeddings') {
      options.useEmbeddings = true;
    }
  }

  return options;
}

async function runCli(argv = process.argv) {
  const options = parseArgs(argv);
  const skills = loadSkillCatalog(options.root);

  if (options.command === 'recommend') {
    if (!options.query) {
      process.stdout.write(`${JSON.stringify({
        query: '',
        topK: options.topK,
        minScore: options.minScore,
        usedEmbeddings: false,
        results: [],
        warning: 'Provide --query to receive non-empty recommendations.',
      }, null, 2)}\n`);
      return 0;
    }

    const output = options.useEmbeddings
      ? await recommendSkillsWithEmbeddings({
        query: options.query,
        skills,
        topK: options.topK,
        minScore: options.minScore,
      })
      : recommendSkills({
        query: options.query,
        skills,
        topK: options.topK,
        minScore: options.minScore,
      });

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return 0;
  }

  if (options.command === 'eval') {
    const cases = JSON.parse(readUtf8(options.casesFile || DEFAULT_EVAL_CASES_PATH));
    const output = options.useEmbeddings
      ? await evaluateSkillRouterCasesWithEmbeddings({
        skills,
        cases,
        topK: options.topK,
        minScore: options.minScore,
      })
      : evaluateSkillRouterCases({
        skills,
        cases,
        topK: options.topK,
        minScore: options.minScore,
      });
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return 0;
  }

  throw new Error(`Unsupported command: ${options.command}`);
}

module.exports = {
  collectSkillFiles,
  evaluateSkillRouterCases,
  evaluateSkillRouterCasesWithEmbeddings,
  loadSkillCatalog,
  parseSkillFile,
  recommendSkills,
  recommendSkillsWithEmbeddings,
  rerankWithEmbeddings,
  runCli,
};

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}