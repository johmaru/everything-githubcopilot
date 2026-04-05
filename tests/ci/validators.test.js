/**
 * Focused tests for the currently shipped CI validators.
 *
 * Run with: node tests/ci/validators.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const validatorsDir = path.join(repoRoot, 'scripts', 'ci');
let packedFilePathsCache = null;

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

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-ci-validator-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function stripShebang(source) {
  let nextSource = source;
  if (nextSource.charCodeAt(0) === 0xFEFF) {
    nextSource = nextSource.slice(1);
  }
  if (nextSource.startsWith('#!')) {
    const newlineIndex = nextSource.indexOf('\n');
    nextSource = newlineIndex === -1 ? '' : nextSource.slice(newlineIndex + 1);
  }
  return nextSource;
}

function runSourceViaTempFile(source) {
  const tempFile = path.join(repoRoot, `.tmp-validator-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tempFile, source, 'utf8');
    const stdout = execFileSync('node', [tempFile], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      cwd: repoRoot,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore cleanup failures
    }
  }
}

function runValidator(name) {
  try {
    const stdout = execFileSync('node', [path.join(validatorsDir, `${name}.js`)], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      cwd: repoRoot,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

function readOptionalRepoFile(...segments) {
  const filePath = path.join(repoRoot, ...segments);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf8');
}

function isPublishedRepoFile(relativePath) {
  if (packedFilePathsCache === null) {
    const stdout = execSync('npm pack --dry-run --json', {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...process.env,
        npm_config_progress: 'false',
        npm_config_loglevel: 'silent',
      },
    });

    const report = JSON.parse(stdout);
    const fileEntries = Array.isArray(report) && report[0] && Array.isArray(report[0].files)
      ? report[0].files
      : [];

    packedFilePathsCache = new Set(fileEntries.map((entry) => entry.path));
  }

  return packedFilePathsCache.has(relativePath);
}

function runValidatorWithOverrides(name, overrides) {
  let source = stripShebang(fs.readFileSync(path.join(validatorsDir, `${name}.js`), 'utf8'));
  for (const [constant, value] of Object.entries(overrides)) {
    const pattern = new RegExp(`const ${constant} = .*?;`);
    source = source.replace(pattern, `const ${constant} = ${JSON.stringify(value)};`);
  }
  return runSourceViaTempFile(source);
}

function writeAgent(filePath, frontmatter, body = '# Agent\n') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\n${frontmatter.join('\n')}\n---\n\n${body}`);
}

function writePlannerAgent(filePath, body = [
  '# planner',
  '',
  '## plannerの活用',
  '',
  'researcherサブエージェントの利用は必須です。',
  '',
  '- 依存関係の追跡が主要タスクに含まれる場合',
  '- 複数ファイルを横断して呼び出し関係や責務分担を確認する場合',
  '- アーキテクチャ全体像や既存パターンの調査が計画の前提になる場合',
  '',
  '調査結果の要点を計画へ統合してください。',
  'researcher を使わずに計画を出す場合は、不要だと判断した理由を明記してください。',
].join('\n')) {
  writeAgent(filePath, [
    'name: planner',
    'description: planner',
    'tools:',
    '  - agent',
    'handoffs:',
    '  - label: low-risk to coder',
    '    agent: coder',
    '    send: true',
    '  - label: manual to coder',
    '    agent: coder',
    '    send: false',
  ], body);
}

function writeSupporterAgent(filePath, handoffLines = [
  'handoffs:',
  '  - label: to planner',
  '    agent: planner',
  '    send: false',
  '  - label: to researcher',
  '    agent: researcher',
  '    send: false',
]) {
  writeAgent(filePath, [
    'name: supporter',
    'description: supporter',
    ...handoffLines,
  ]);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeHookCommand(command) {
  if (typeof command === 'string') {
    return command;
  }

  if (Array.isArray(command)) {
    return command.join(' ');
  }

  return '';
}

console.log('\n=== Testing Current CI Validators ===\n');

const results = [];

results.push(test('validate-copilot-customizations passes on the shipped repository', () => {
  const result = runValidator('validate-copilot-customizations');
  assert.strictEqual(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('Validated Copilot customizations'));
}));

results.push(test('validate-copilot-customizations fails on agent without frontmatter', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    fs.writeFileSync(path.join(testDir, '.github', 'agents', 'broken.agent.md'), '# no frontmatter\n');

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('missing YAML frontmatter'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires internal agents to be non-invocable', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writePlannerAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '  - label: to researcher',
      '    agent: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'hidden.agent.md'), [
      'name: hidden',
      'description: hidden',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('user-invocable: false'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects markdown-only researcher handoffs', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writePlannerAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
    ], '## HANDOFF: coder → researcher\n');
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("coder must have handoff to 'researcher'"));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations accepts runtime handoff chain in frontmatter', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writeAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      'name: planner',
      'description: planner',
      'tools: [agent]',
      'handoffs:',
      '  - label: low-risk to coder',
      '    agent: coder',
      '    send: true',
      '  - label: manual to coder',
      '    agent: coder',
      '    send: false',
    ], [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイル横断で呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像の調査が計画の前提になる場合',
      '',
      '調査結果の要点を計画へ統合してください。',
      'researcher を使わずに計画を出す場合は、不要だと判断した理由を明記してください。',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '  - label: to researcher',
      '    agent: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'internal.agent.md'), [
      'name: internal',
      'description: internal',
      'user-invocable: false',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 0, result.stderr);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations accepts inline tools list with trailing comment', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writeAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      'name: planner',
      'description: planner',
      'tools: [agent] # keep researcher handoff enabled',
      'handoffs:',
      '  - label: low-risk to coder',
      '    agent: coder',
      '    send: true',
      '  - label: manual to coder',
      '    agent: coder',
      '    send: false',
    ], [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイル横断で呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像の調査が計画の前提になる場合',
      '',
      '調査結果の要点を計画へ統合してください。',
      'researcher を使わずに計画を出す場合は、不要だと判断した理由を明記してください。',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '  - label: to researcher',
      '    agent: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'internal.agent.md'), [
      'name: internal',
      'description: internal',
      'user-invocable: false',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 0, result.stderr);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations ignores bullet lines inside handoff prompt block scalars', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writeAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      'name: planner',
      'description: planner',
      'tools: [agent]',
      'handoffs:',
      '  - label: low-risk to coder',
      '    agent: coder',
      '    prompt: >',
      '      Follow the approved plan:',
      '      - implement step by step',
      '      - validate after each step',
      '    send: true',
      '  - label: manual to coder',
      '    agent: coder',
      '    send: false',
    ], [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイル横断で呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像の調査が計画の前提になる場合',
      '',
      '調査結果の要点を計画へ統合してください。',
      'researcher を使わずに計画を出す場合は、不要だと判断した理由を明記してください。',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '    send: false',
      '  - label: to researcher',
      '    agent: researcher',
      '    send: false',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeSupporterAgent(path.join(testDir, '.github', 'agents', 'supporter.agent.md'));

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 0, result.stderr);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires planner researcher contract anchors', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writeAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      'name: planner',
      'description: planner',
      'handoffs:',
      '  - label: to coder',
      '    agent: coder',
    ], [
      '# planner',
      '',
      'researcherサブエージェントの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- アーキテクチャ全体像や既存パターンの調査が計画の前提になる場合',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '  - label: to researcher',
      '    agent: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'internal.agent.md'), [
      'name: internal',
      'description: internal',
      'user-invocable: false',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('planner must require researcher usage'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires planner agent tool for researcher handoff', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writeAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      'name: planner',
      'description: planner',
      'handoffs:',
      '  - label: to coder',
      '    agent: coder',
    ], [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherサブエージェントの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイルを横断して呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像や既存パターンの調査が計画の前提になる場合',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '  - label: to researcher',
      '    agent: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'internal.agent.md'), [
      'name: internal',
      'description: internal',
      'user-invocable: false',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("planner must keep the 'agent' tool available"));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires planner to integrate researcher findings into the plan', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writePlannerAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherサブエージェントの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイルを横断して呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像や既存パターンの調査が計画の前提になる場合',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '  - label: to researcher',
      '    agent: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'internal.agent.md'), [
      'name: internal',
      'description: internal',
      'user-invocable: false',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('調査結果の要点を計画へ統合'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations accepts planner researcher contract anchors in planner section', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writePlannerAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイル横断で呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像の調査が計画の前提になる場合',
      '',
      '調査結果の要点を計画へ統合してください。',
      'researcher を使わずに計画を出す場合は、不要だと判断した理由を明記してください。',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '  - label: to researcher',
      '    agent: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'internal.agent.md'), [
      'name: internal',
      'description: internal',
      'user-invocable: false',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 0, result.stderr);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations accepts alternate planner researcher anchor wording', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writePlannerAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherサブエージェントの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイルを横断して呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像や既存パターンの調査が計画の前提になる場合',
      '',
      '調査結果を計画へ統合してください。',
      'researcher を使わずに計画を出す場合は、不要だと判断した理由を明記してください。',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '  - label: to researcher',
      '    agent: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'internal.agent.md'), [
      'name: internal',
      'description: internal',
      'user-invocable: false',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 0, result.stderr);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires planner low-risk handoff to coder to use send: true', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writeAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      'name: planner',
      'description: planner',
      'tools:',
      '  - agent',
      'handoffs:',
      '  - label: low-risk to coder',
      '    agent: coder',
      '    send: false',
      '  - label: manual to coder',
      '    agent: coder',
      '    send: false',
    ], [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherサブエージェントの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイルを横断して呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像や既存パターンの調査が計画の前提になる場合',
      '',
      '調査結果の要点を計画へ統合してください。',
      'researcher を使わずに計画を出す場合は、不要だと判断した理由を明記してください。',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '    send: false',
      '  - label: to researcher',
      '    agent: researcher',
      '    send: false',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeSupporterAgent(path.join(testDir, '.github', 'agents', 'supporter.agent.md'));

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("planner must set send: true for the coder handoff"));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires planner to keep a manual coder handoff with send: false', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writeAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'), [
      'name: planner',
      'description: planner',
      'tools:',
      '  - agent',
      'handoffs:',
      '  - label: low-risk to coder',
      '    agent: coder',
      '    send: true',
    ], [
      '# planner',
      '',
      '## plannerの活用',
      '',
      'researcherサブエージェントの利用は必須です。',
      '',
      '- 依存関係の追跡が主要タスクに含まれる場合',
      '- 複数ファイルを横断して呼び出し関係や責務分担を確認する場合',
      '- アーキテクチャ全体像や既存パターンの調査が計画の前提になる場合',
      '',
      '調査結果の要点を計画へ統合してください。',
      'researcher を使わずに計画を出す場合は、不要だと判断した理由を明記してください。',
    ].join('\n'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '    send: false',
      '  - label: to researcher',
      '    agent: researcher',
      '    send: false',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeSupporterAgent(path.join(testDir, '.github', 'agents', 'supporter.agent.md'));

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("planner must keep a manual coder handoff with send: false"));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations keeps supporter handoffs manual with send: false', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'copilot-instructions.md'), '# ok\n');
    writePlannerAgent(path.join(testDir, '.github', 'agents', 'planner.agent.md'));
    writeAgent(path.join(testDir, '.github', 'agents', 'coder.agent.md'), [
      'name: coder',
      'description: coder',
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '    send: false',
      '  - label: to researcher',
      '    agent: researcher',
      '    send: false',
    ]);
    writeAgent(path.join(testDir, '.github', 'agents', 'researcher.agent.md'), [
      'name: researcher',
      'description: researcher',
    ]);
    writeSupporterAgent(path.join(testDir, '.github', 'agents', 'supporter.agent.md'), [
      'handoffs:',
      '  - label: to planner',
      '    agent: planner',
      '    send: true',
      '  - label: to researcher',
      '    agent: researcher',
      '    send: false',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("supporter handoffs must keep send: false"));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-github-hooks passes on the shipped repository', () => {
  const result = runValidator('validate-github-hooks');
  assert.strictEqual(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('Validated GitHub Copilot hooks'));
}));

results.push(test('validate-github-hooks fails on missing local scripts', () => {
  const testDir = createTestDir();
  try {
    writeJson(path.join(testDir, 'schemas', 'hooks.schema.json'), {
      type: 'object',
      required: ['hooks'],
      properties: { hooks: { type: 'object' } },
      additionalProperties: true,
    });
    writeJson(path.join(testDir, '.github', 'hooks', 'deterministic-hooks.json'), {
      hooks: {
        Stop: [{
          description: 'cleanup',
          hooks: [{ type: 'command', command: 'node scripts/hooks/missing.js' }],
        }],
      },
    });

    const result = runValidatorWithOverrides('validate-github-hooks', {
      ROOT: testDir,
      HOOKS_DIR: path.join(testDir, '.github', 'hooks'),
      HOOKS_SCHEMA_PATH: path.join(testDir, 'schemas', 'hooks.schema.json'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('missing local command script'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-github-hooks accepts Stop hooks without matcher', () => {
  const testDir = createTestDir();
  try {
    writeJson(path.join(testDir, 'schemas', 'hooks.schema.json'), {
      type: 'object',
      required: ['hooks'],
      properties: { hooks: { type: 'object' } },
      additionalProperties: true,
    });
    fs.mkdirSync(path.join(testDir, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'scripts', 'hooks', 'cleanup.js'), 'console.log("ok");\n');
    writeJson(path.join(testDir, '.github', 'hooks', 'deterministic-hooks.json'), {
      hooks: {
        Stop: [{
          description: 'cleanup',
          hooks: [{ type: 'command', command: 'node scripts/hooks/cleanup.js' }],
        }],
      },
    });

    const result = runValidatorWithOverrides('validate-github-hooks', {
      ROOT: testDir,
      HOOKS_DIR: path.join(testDir, '.github', 'hooks'),
      HOOKS_SCHEMA_PATH: path.join(testDir, 'schemas', 'hooks.schema.json'),
    });

    assert.strictEqual(result.code, 0, result.stderr);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-github-hooks accepts PostToolUseFailure correction hooks with a matcher', () => {
  const testDir = createTestDir();
  try {
    writeJson(path.join(testDir, 'schemas', 'hooks.schema.json'), {
      type: 'object',
      required: ['hooks'],
      properties: { hooks: { type: 'object' } },
      additionalProperties: true,
    });
    fs.mkdirSync(path.join(testDir, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'scripts', 'hooks', 'tool-call-correction.js'), 'console.log("ok");\n');
    writeJson(path.join(testDir, '.github', 'hooks', 'deterministic-hooks.json'), {
      hooks: {
        PostToolUseFailure: [{
          matcher: '*',
          description: 'dry-run correction suggestions',
          hooks: [{ type: 'command', command: 'node scripts/hooks/tool-call-correction.js' }],
        }],
      },
    });

    const result = runValidatorWithOverrides('validate-github-hooks', {
      ROOT: testDir,
      HOOKS_DIR: path.join(testDir, '.github', 'hooks'),
      HOOKS_SCHEMA_PATH: path.join(testDir, 'schemas', 'hooks.schema.json'),
    });

    assert.strictEqual(result.code, 0, result.stderr);
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-no-personal-paths passes on the shipped repository', () => {
  const result = runValidator('validate-no-personal-paths');
  assert.strictEqual(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('Validated: no personal absolute paths'));
}));

results.push(test('validate-no-personal-paths fails on blocked personal paths', () => {
  const testDir = createTestDir();
  try {
    fs.mkdirSync(path.join(testDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'README.md'), 'See C:\\Users\\affoon\\secret\n');

    const result = runValidatorWithOverrides('validate-no-personal-paths', {
      ROOT: testDir,
      TARGETS: ['README.md', 'docs'],
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('personal path detected'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('checkpoint prompt keeps the repository checkpoint output path', () => {
  const checkpointPrompt = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'prompts', 'checkpoint.prompt.md'),
    'utf8'
  );

  assert.ok(
    checkpointPrompt.includes('.github/sessions/checkpoint.md'),
    'checkpoint prompt must keep writing the repository checkpoint artifact'
  );
}));

results.push(test('planner agent keeps the 10-step phase split contract', () => {
  const plannerAgent = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'agents', 'planner.agent.md'),
    'utf8'
  );

  assert.ok(plannerAgent.includes('10ステップ超'), 'planner agent must mention the >10-step threshold');
  assert.ok(plannerAgent.includes('フェーズ分割'), 'planner agent must keep the phase split rule');
}));

results.push(test('deterministic hooks keep the SessionStart and PreCompact Phase 2 wiring', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'hooks', 'deterministic-hooks.json'),
    'utf8'
  ));

  const sessionStartCommands = (hooksConfig.hooks.SessionStart || []).flatMap((entry) =>
    (entry.hooks || []).map((hook) => normalizeHookCommand(hook.command))
  );
  const preCompactCommands = (hooksConfig.hooks.PreCompact || []).flatMap((entry) =>
    (entry.hooks || []).map((hook) => normalizeHookCommand(hook.command))
  );

  assert.ok(Array.isArray(hooksConfig.hooks.SessionStart), 'deterministic hooks must keep the SessionStart event');
  assert.ok(
    sessionStartCommands.some((command) => command.includes('session-start.js')),
    'deterministic hooks must keep the session-start hook command on SessionStart'
  );
  assert.ok(Array.isArray(hooksConfig.hooks.PreCompact), 'deterministic hooks must keep the PreCompact event');
  assert.ok(
    preCompactCommands.some((command) => command.includes('pre-compact.js')),
    'deterministic hooks must keep the pre-compact hook command on PreCompact'
  );
}));

results.push(test('deterministic hooks ship the PostToolUseFailure correction wiring', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'hooks', 'deterministic-hooks.json'),
    'utf8'
  ));

  const failureEntries = hooksConfig.hooks.PostToolUseFailure || [];

  assert.ok(Array.isArray(hooksConfig.hooks.PostToolUseFailure), 'deterministic hooks must keep the PostToolUseFailure event');
  assert.strictEqual(failureEntries.length, 1, 'deterministic hooks must keep a single correction hook entry');
  assert.strictEqual(failureEntries[0].matcher, '*', 'correction hook must keep the catch-all matcher');
  assert.strictEqual(failureEntries[0].hooks[0].type, 'command');
  assert.strictEqual(failureEntries[0].hooks[0].command, 'node ./scripts/hooks/tool-call-correction.js');
  assert.strictEqual(failureEntries[0].hooks[0].async, true, 'correction hook should stay async');
  assert.strictEqual(failureEntries[0].hooks[0].timeout, 10, 'correction hook timeout should stay narrow');
}));

results.push(test('deterministic hooks run post-edit formatting, typecheck, and console warnings on Write and MultiEdit too', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'hooks', 'deterministic-hooks.json'),
    'utf8'
  ));

  const postToolUseEntries = hooksConfig.hooks.PostToolUse || [];
  const formatEntry = postToolUseEntries.find((entry) =>
    (entry.hooks || []).some((hook) => normalizeHookCommand(hook.command).includes('post-edit-format.js'))
  );
  const typecheckEntry = postToolUseEntries.find((entry) =>
    (entry.hooks || []).some((hook) => normalizeHookCommand(hook.command).includes('post-edit-typecheck.js'))
  );
  const consoleWarnEntry = postToolUseEntries.find((entry) =>
    (entry.hooks || []).some((hook) => normalizeHookCommand(hook.command).includes('post-edit-console-warn.js'))
  );

  assert.ok(formatEntry, 'format hook entry should exist');
  assert.ok(typecheckEntry, 'typecheck hook entry should exist');
  assert.ok(consoleWarnEntry, 'console warning hook entry should exist');
  assert.strictEqual(formatEntry.matcher, 'Edit|Write|MultiEdit', 'format hook should run on Write and MultiEdit');
  assert.strictEqual(typecheckEntry.matcher, 'Edit|Write|MultiEdit', 'typecheck hook should run on Write and MultiEdit');
  assert.strictEqual(consoleWarnEntry.matcher, 'Edit|Write|MultiEdit', 'console warning hook should run on Write and MultiEdit');
}));

results.push(test('architecture document captures the Phase 2 resume data flow', () => {
  const architectureDoc = readOptionalRepoFile('ARCHITECTURE.md');
  if (architectureDoc === null) {
    assert.strictEqual(isPublishedRepoFile('ARCHITECTURE.md'), false, 'ARCHITECTURE.md may only be absent when it is not part of the published package surface');
    return;
  }

  assert.ok(architectureDoc.includes('checkpoint.prompt.md'), 'architecture doc must mention the checkpoint prompt source');
  assert.ok(architectureDoc.includes('pre-compact.js'), 'architecture doc must mention the pre-compact hook');
  assert.ok(architectureDoc.includes('session-start.js'), 'architecture doc must mention the session-start hook');
  assert.ok(architectureDoc.includes('compact-snapshot.md'), 'architecture doc must mention the compact snapshot artifact');
}));

results.push(test('phase 2 verification doc captures the manual compact validation protocol', () => {
  const verificationDoc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'phase-2-context-management-verification.md'),
    'utf8'
  );

  assert.ok(verificationDoc.includes('/compact focus on'), 'phase 2 verification doc must mention the focused manual compact flow');
  assert.ok(verificationDoc.includes('20ターン'), 'phase 2 verification doc must mention the long-session success criterion');
  assert.ok(verificationDoc.includes('10ステップ超'), 'phase 2 verification doc must mention the large-plan success criterion');
  assert.ok(verificationDoc.includes('記録テンプレート'), 'phase 2 verification doc must keep scenario evidence templates');
  assert.ok(verificationDoc.includes('完了判定'), 'phase 2 verification doc must keep explicit completion gates');
}));

results.push(test('phase 2 product log defines the runtime evidence handoff fields', () => {
  const productDoc = readOptionalRepoFile('PRODUCT.md');
  if (productDoc === null) {
    assert.strictEqual(isPublishedRepoFile('PRODUCT.md'), false, 'PRODUCT.md may only be absent when it is not part of the published package surface');
    return;
  }

  assert.ok(productDoc.includes('Phase 2 runtime evidence 転記ルール'), 'PRODUCT must define how runtime evidence is copied into the log');
  assert.ok(productDoc.includes('シナリオ ID'), 'PRODUCT must require the scenario id in runtime evidence log entries');
  assert.ok(productDoc.includes('artifact / context'), 'PRODUCT must require the observed artifact or context summary');
}));

results.push(test('architecture document distinguishes shipped repo proof from runtime proof', () => {
  const architectureDoc = readOptionalRepoFile('ARCHITECTURE.md');
  if (architectureDoc === null) {
    assert.strictEqual(isPublishedRepoFile('ARCHITECTURE.md'), false, 'ARCHITECTURE.md may only be absent when it is not part of the published package surface');
    return;
  }

  assert.ok(architectureDoc.includes('repo contract と runtime proof の境界'), 'architecture doc must define the proof boundary section');
  assert.ok(architectureDoc.includes('repo proof'), 'architecture doc must mention repo proof explicitly');
  assert.ok(architectureDoc.includes('runtime proof'), 'architecture doc must mention runtime proof explicitly');
}));

results.push(test('ja strategic compact doc matches the current manual compact workflow', () => {
  const strategicCompactJaDoc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'ja-JP', 'skills', 'strategic-compact', 'SKILL.md'),
    'utf8'
  );

  assert.ok(strategicCompactJaDoc.includes('PreCompact'), 'ja strategic compact doc must mention the PreCompact hook');
  assert.ok(strategicCompactJaDoc.includes('manual `/compact`'), 'ja strategic compact doc must mention the manual compact path');
  assert.ok(strategicCompactJaDoc.includes('optional'), 'ja strategic compact doc must keep reminder wiring optional');
}));

results.push(test('package manifest excludes local planning docs from the published files surface', () => {
  assert.strictEqual(isPublishedRepoFile('PRODUCT.md'), false, 'PRODUCT.md should stay out of the published package surface');
  assert.strictEqual(isPublishedRepoFile('HANDOFF.md'), false, 'HANDOFF.md should stay out of the published package surface');
  assert.strictEqual(isPublishedRepoFile('ARCHITECTURE.md'), false, 'ARCHITECTURE.md should stay out of the published package surface');
}));

results.push(test('coder agent requires a verification completion gate before completion reporting', () => {
  const coderAgent = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'agents', 'coder.agent.md'),
    'utf8'
  );

  assert.ok(coderAgent.includes('verification completion gate'), 'coder agent must mention the verification completion gate explicitly');
  assert.ok(coderAgent.includes('checklist'), 'coder agent must mention checklist enforcement explicitly');
  assert.ok(coderAgent.includes('未完了時'), 'coder agent must explain what to do when checklist items remain incomplete');
}));

results.push(test('verify prompt stays verification-only and reports checklist outcomes', () => {
  const verifyPrompt = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'prompts', 'verify.prompt.md'),
    'utf8'
  );

  assert.ok(verifyPrompt.includes('verification-only mode'), 'verify prompt must stay verification-only');
  assert.ok(verifyPrompt.includes('checklist'), 'verify prompt must report checklist outcomes');
  assert.ok(verifyPrompt.includes('neutral') || verifyPrompt.includes('pass') || verifyPrompt.includes('block'), 'verify prompt must define checklist outcome states');
}));

results.push(test('verification-loop skill requires checklist enforcement and follow-up guidance', () => {
  const verificationSkill = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'skills', 'verification-loop', 'SKILL.md'),
    'utf8'
  );

  assert.ok(verificationSkill.includes('checklist'), 'verification-loop skill must mention checklist enforcement');
  assert.ok(verificationSkill.includes('follow-up') || verificationSkill.includes('次の一手'), 'verification-loop skill must mention follow-up guidance for incomplete work');
  assert.ok(verificationSkill.includes('neutral') || verificationSkill.includes('未使用'), 'verification-loop skill must define the no-todo neutral path');
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);
if (failed > 0) {
  process.exit(1);
}