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
const SHIPPED_CODEX_SESSION_START_COMMAND = `node -e "var fs=require('fs'),path=require('path');var dir=process.cwd();var rel='scripts/hooks/session-start.js';for(;;){var candidate=path.join(dir,rel);var hasMarkers=fs.existsSync(path.join(dir,'AGENTS.md'))&&fs.existsSync(path.join(dir,'.codex','hooks.json'));if(hasMarkers){if(fs.existsSync(candidate)){process.chdir(dir);require(candidate)}else{process.exit(0)}break;}var parent=path.dirname(dir);if(parent===dir){process.exit(0)}dir=parent}"`;
const SHIPPED_CODEX_STOP_COMMAND = `node -e "var fs=require('fs'),path=require('path');var dir=process.cwd();var rel='scripts/hooks/codex-stop.js';for(;;){var candidate=path.join(dir,rel);var hasMarkers=fs.existsSync(path.join(dir,'AGENTS.md'))&&fs.existsSync(path.join(dir,'.codex','hooks.json'));if(hasMarkers){if(fs.existsSync(candidate)){process.chdir(dir);var mod=require(candidate);if(mod&&typeof mod.main==='function'){mod.main()}}else{process.exit(0)}break;}var parent=path.dirname(dir);if(parent===dir){process.exit(0)}dir=parent}"`;
function shippedCodexHookCommand(scriptName) {
  return `node -e "var fs=require('fs'),path=require('path');var dir=process.cwd();var rel='scripts/hooks/${scriptName}';for(;;){var candidate=path.join(dir,rel);var hasMarkers=fs.existsSync(path.join(dir,'AGENTS.md'))&&fs.existsSync(path.join(dir,'.codex','hooks.json'));if(hasMarkers){if(fs.existsSync(candidate)){process.chdir(dir);require(candidate)}else{process.exit(0)}break;}var parent=path.dirname(dir);if(parent===dir){process.exit(0)}dir=parent}"`;
}
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

function writeSkill(filePath, frontmatter, body = '# Skill\n') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---\n${frontmatter.join('\n')}\n---\n\n${body}`);
}

function writeCodexAgentsDoc(filePath, extraLines = []) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, [
    '# Codex CLI guidance',
    '',
    'Codex should continue to use the root `AGENTS.md` for project instructions.',
    'This repository does not ship runtime `.codex/instructions/` or `.codex/prompts/` payloads.',
    'Skills are discovered from `.agents/skills/`.',
    ...extraLines,
    '',
  ].join('\n'));
}

function writeCodexCompatibilitySurface(testDir, options = {}) {
  const {
    agentsDocExtraLines = [],
    readme = '# Test\n\n`.codex/` is a compatibility surface.\n',
    configToml = 'approval_policy = "on-request"\n',
    createSkillsBridge = false,
    createCodexSkillsMirror = false,
    includeHooks = true,
    hooksJson = JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: 'startup|resume',
            hooks: [
              {
                type: 'command',
                command: SHIPPED_CODEX_SESSION_START_COMMAND,
                timeout: 60,
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: 'apply_patch|Write|Edit',
            hooks: [
              {
                type: 'command',
                command: shippedCodexHookCommand('config-protection.js'),
                timeout: 5,
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: 'apply_patch|Write|Edit',
            hooks: [
              {
                type: 'command',
                command: shippedCodexHookCommand('quality-gate.js'),
              },
            ],
          },
          {
            matcher: 'apply_patch|Write|Edit',
            hooks: [
              {
                type: 'command',
                command: shippedCodexHookCommand('post-edit-format.js'),
              },
            ],
          },
          {
            matcher: 'apply_patch|Write|Edit',
            hooks: [
              {
                type: 'command',
                command: shippedCodexHookCommand('post-edit-typecheck.js'),
              },
            ],
          },
          {
            matcher: 'apply_patch|Write|Edit',
            hooks: [
              {
                type: 'command',
                command: shippedCodexHookCommand('post-edit-console-warn.js'),
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: SHIPPED_CODEX_STOP_COMMAND,
                timeout: 30,
              },
            ],
          },
        ],
      },
    }, null, 2),
    includeRules = true,
    includeAgents = true,
  } = options;

  fs.mkdirSync(path.join(testDir, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.codex', 'config.toml'), configToml);
  writeCodexAgentsDoc(path.join(testDir, '.codex', 'AGENTS.md'), agentsDocExtraLines);

  if (includeHooks) {
    fs.writeFileSync(path.join(testDir, '.codex', 'hooks.json'), hooksJson);
  }

  if (includeRules) {
    fs.mkdirSync(path.join(testDir, '.codex', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.codex', 'rules', 'security.rules'), '# security rules\n');
  }

  if (includeAgents) {
    fs.mkdirSync(path.join(testDir, '.codex', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.codex', 'agents', 'explorer.toml'), 'name = "explorer"\n');
  }

  if (createSkillsBridge) {
    fs.mkdirSync(path.join(testDir, '.agents', 'skills'), { recursive: true });
  }

  if (createCodexSkillsMirror) {
    fs.mkdirSync(path.join(testDir, '.codex', 'skills'), { recursive: true });
  }

  fs.writeFileSync(path.join(testDir, 'README.md'), readme);
}

function writeRepoFixture(testDir, relativePath, transform = (source) => source) {
  const sourcePath = path.join(repoRoot, ...relativePath.split('/'));
  const destinationPath = path.join(testDir, ...relativePath.split('/'));
  const source = fs.readFileSync(sourcePath, 'utf8');
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, transform(source), 'utf8');
}

function writeReviewRoutingFixture(testDir, overrides = {}) {
  const fixtureFiles = [
    '.github/copilot-instructions.md',
    '.github/instructions/common-agents.instructions.md',
    '.github/instructions/common-development-workflow.instructions.md',
    '.github/prompts/knowledge-audit.prompt.md',
    '.github/prompts/verify.prompt.md',
    '.github/agents/planner.agent.md',
    '.github/agents/coder.agent.md',
    '.github/agents/researcher.agent.md',
    '.github/agents/supporter.agent.md',
    '.github/agents/safety-checker.agent.md',
    '.github/agents/knowledge-curator.agent.md',
  ];

  for (const relativePath of fixtureFiles) {
    writeRepoFixture(testDir, relativePath, overrides[relativePath]);
  }
}

function writeMinimalRepoFixtures(testDir) {
  fs.mkdirSync(path.join(testDir, '.github', 'instructions'), { recursive: true });
  fs.mkdirSync(path.join(testDir, '.github', 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(testDir, '.github', 'agents'), { recursive: true });
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
  assert.ok(result.stdout.includes('skills'));
}));

results.push(test('shipped docs and instructions document semantic indexer discovery paths', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const workspaceInstructions = fs.readFileSync(
    path.join(repoRoot, '.github', 'copilot-instructions.md'),
    'utf8'
  );

  assert.ok(readme.includes('entry-points:index'), 'README must document entry-points:index');
  assert.ok(readme.includes('entry-points:query'), 'README must document entry-points:query');
  assert.ok(readme.includes('rust:index'), 'README must document rust:index');
  assert.ok(readme.includes('--file rust/semantic-indexer/src/cli.rs'), 'README must document targeted semantic-indexer file inspection');
  assert.ok(readme.includes('--format summary'), 'README must document semantic-indexer summary output');
  assert.ok(readme.includes('semantic-indexer'), 'README must mention semantic-indexer');
  assert.ok(
    workspaceInstructions.includes('semantic-indexer'),
    'workspace instructions must mention semantic-indexer when static AST exploration is appropriate'
  );
  assert.ok(
    workspaceInstructions.includes('--format summary'),
    'workspace instructions must document semantic-indexer summary output for static AST analysis'
  );
  assert.ok(
    workspaceInstructions.includes('--file <path>'),
    'workspace instructions must document targeted semantic-indexer file inspection'
  );
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

results.push(test('validate-copilot-customizations fails on skill without frontmatter', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    fs.mkdirSync(path.join(testDir, '.github', 'skills', 'broken-skill'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.github', 'skills', 'broken-skill', 'SKILL.md'), '# no frontmatter\n');

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('broken-skill/SKILL.md'));
    assert.ok(result.stderr.includes('missing YAML frontmatter'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations fails on skill without description', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeSkill(path.join(testDir, '.github', 'skills', 'broken-skill', 'SKILL.md'), [
      'name: broken-skill',
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
    assert.ok(result.stderr.includes('broken-skill/SKILL.md'));
    assert.ok(result.stderr.includes('description field'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations fails on skill without name', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeSkill(path.join(testDir, '.github', 'skills', 'broken-skill', 'SKILL.md'), [
      'description: Missing a name field',
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
    assert.ok(result.stderr.includes('broken-skill/SKILL.md'));
    assert.ok(result.stderr.includes('name field'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations accepts skill with block-scalar description', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeSkill(path.join(testDir, '.github', 'skills', 'valid-skill', 'SKILL.md'), [
      'name: valid-skill',
      'description: >-',
      '  Valid skill description for discovery.',
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
    assert.ok(result.stdout.includes('1 skills'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations accepts quoted skill frontmatter with inline comment', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeSkill(path.join(testDir, '.github', 'skills', 'valid-skill', 'SKILL.md'), [
      'name: valid-skill',
      'description: "Valid skill description" # keep this context',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      SKILLS_DIR: path.join(testDir, '.github', 'skills'),
    });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('1 skills'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations fails on skill with unterminated quoted frontmatter', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeSkill(path.join(testDir, '.github', 'skills', 'broken-skill', 'SKILL.md'), [
      'name: broken-skill',
      'description: "Unterminated quoted description',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      SKILLS_DIR: path.join(testDir, '.github', 'skills'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('broken-skill/SKILL.md'));
    assert.ok(result.stderr.includes('invalid YAML frontmatter'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations fails on skill with invalid double-quoted escape', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeSkill(path.join(testDir, '.github', 'skills', 'broken-skill', 'SKILL.md'), [
      'name: broken-skill',
      'description: "Invalid escape \\q in description"',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      SKILLS_DIR: path.join(testDir, '.github', 'skills'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('broken-skill/SKILL.md'));
    assert.ok(result.stderr.includes('invalid YAML frontmatter'));
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations fails on skill with invalid YAML frontmatter even when mirror matches', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
    });
    writeSkill(path.join(testDir, '.github', 'skills', 'broken-skill', 'SKILL.md'), [
      'name: broken-skill',
      'description: Invalid skill description: triggers YAML parse ambiguity',
    ]);
    writeSkill(path.join(testDir, '.agents', 'skills', 'broken-skill', 'SKILL.md'), [
      'name: broken-skill',
      'description: Invalid skill description: triggers YAML parse ambiguity',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      SKILLS_DIR: path.join(testDir, '.github', 'skills'),
      CODEX_SKILLS_MIRROR_DIR: path.join(testDir, '.agents', 'skills'),
    });

    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('broken-skill/SKILL.md'));
    assert.ok(result.stderr.includes('invalid YAML frontmatter'));
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

results.push(test('validate-copilot-customizations enforces the root review-routing contract anchors', () => {
  const testDir = createTestDir();
  try {
    writeReviewRoutingFixture(testDir, {
      '.github/instructions/common-development-workflow.instructions.md': (source) => source.replace(
        'Keep **researcher** as the default implementation review in the planner -> coder -> researcher lane',
        'Keep **code-reviewer** as the default implementation review after every implementation change'
      ),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      COMMON_AGENTS_INSTRUCTIONS: path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'),
      COMMON_DEVELOPMENT_WORKFLOW: path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'),
      KNOWLEDGE_AUDIT_PROMPT: path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'),
      VERIFY_PROMPT: path.join(testDir, '.github', 'prompts', 'verify.prompt.md'),
      CODER_AGENT: path.join(testDir, '.github', 'agents', 'coder.agent.md'),
      SAFETY_CHECKER_AGENT: path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'),
    });

    assert.strictEqual(result.code, 1, result.stderr);
    const errorLines = result.stderr.trim().split(/\r?\n/).filter(Boolean);
    assert.strictEqual(errorLines.length, 1, result.stderr);
    assert.ok(errorLines[0].includes('P1-009'), 'validator must report the review-routing contract rule id');
    assert.ok(errorLines[0].includes('common-development-workflow.instructions.md'), 'validator must identify the broken source-of-truth workflow file');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations enforces semantic-indexer summary guidance anchors', () => {
  const testDir = createTestDir();
  try {
    writeReviewRoutingFixture(testDir, {
      '.github/copilot-instructions.md': (source) => source.replace(
        '`npm run rust:index -- --format summary`, ',
        ''
      ),
    });
    writeRepoFixture(testDir, 'README.md');

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      COMMON_AGENTS_INSTRUCTIONS: path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'),
      COMMON_DEVELOPMENT_WORKFLOW: path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'),
      KNOWLEDGE_AUDIT_PROMPT: path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'),
      VERIFY_PROMPT: path.join(testDir, '.github', 'prompts', 'verify.prompt.md'),
      CODER_AGENT: path.join(testDir, '.github', 'agents', 'coder.agent.md'),
      SAFETY_CHECKER_AGENT: path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'),
    });

    assert.strictEqual(result.code, 1, result.stderr);
    const errorLines = result.stderr.trim().split(/\r?\n/).filter(Boolean);
    assert.ok(errorLines.some((line) => line.includes('P1-011')), 'validator must report the semantic-indexer guidance rule id');
    assert.ok(errorLines.some((line) => line.includes('copilot-instructions.md')), 'validator must identify the broken workspace instruction guidance surface');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations still enforces semantic-indexer guidance when both docs lose anchors in a repo-level fixture', () => {
  const testDir = createTestDir();
  try {
    writeReviewRoutingFixture(testDir, {
      '.github/copilot-instructions.md': (source) => source
        .replace('`npm run entry-points:index`, ', '')
        .replace('`npm run entry-points:query`, ', '')
        .replace('`npm run rust:index -- --format summary`, ', '')
        .replace('or targeted `npm run rust:index -- --file <path>` calls ', '')
        .replace('Use `semantic-indexer` through ', 'Use code search through '),
    });
    writeRepoFixture(testDir, 'README.md', (source) => source
      .replace('`npm run entry-points:index -- --root .`, ', '')
      .replace('`npm run entry-points:query -- --root . --query "semantic indexer"`, ', '')
      .replace('`npm run rust:index -- --root . --format summary`, ', '')
      .replace('semantic-indexer summaries, and direct semantic-indexer CLI access', 'code-search summaries and direct CLI access')
      .replace('semantic-indexer', 'indexer'));
    writeRepoFixture(testDir, 'package.json');

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      COMMON_AGENTS_INSTRUCTIONS: path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'),
      COMMON_DEVELOPMENT_WORKFLOW: path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'),
      KNOWLEDGE_AUDIT_PROMPT: path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'),
      VERIFY_PROMPT: path.join(testDir, '.github', 'prompts', 'verify.prompt.md'),
      CODER_AGENT: path.join(testDir, '.github', 'agents', 'coder.agent.md'),
      SAFETY_CHECKER_AGENT: path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'),
    });

    assert.strictEqual(result.code, 1, result.stderr);
    assert.ok(result.stderr.includes('P1-011'), 'validator must keep enforcing semantic-indexer guidance in repo-level fixtures');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires README for repo-level semantic-indexer guidance', () => {
  const testDir = createTestDir();
  try {
    writeReviewRoutingFixture(testDir);
    writeRepoFixture(testDir, 'package.json');

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      COMMON_AGENTS_INSTRUCTIONS: path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'),
      COMMON_DEVELOPMENT_WORKFLOW: path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'),
      KNOWLEDGE_AUDIT_PROMPT: path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'),
      VERIFY_PROMPT: path.join(testDir, '.github', 'prompts', 'verify.prompt.md'),
      CODER_AGENT: path.join(testDir, '.github', 'agents', 'coder.agent.md'),
      SAFETY_CHECKER_AGENT: path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'),
    });

    assert.strictEqual(result.code, 1, result.stderr);
    assert.ok(result.stderr.includes('P1-011'), 'validator must report the semantic-indexer guidance rule id when README is missing');
    assert.ok(result.stderr.includes('README.md'), 'validator must identify the missing README guidance surface');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations enforces high-risk-only safety boundary anchors', () => {
  const testDir = createTestDir();
  try {
    writeReviewRoutingFixture(testDir, {
      '.github/agents/safety-checker.agent.md': (source) => source
        .replace(
          'Use immediately after high-risk coder edits to inspect risky changes, flag unsafe areas, and create temporary backups for suspicious files before verification.',
          'Use after coder edits to inspect risky changes before verification.'
        )
        .replace(
          'This review runs immediately after high-risk coder edits, before the verification loop resumes.',
          'This review runs after coder edits.'
        ),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      COMMON_AGENTS_INSTRUCTIONS: path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'),
      COMMON_DEVELOPMENT_WORKFLOW: path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'),
      KNOWLEDGE_AUDIT_PROMPT: path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'),
      VERIFY_PROMPT: path.join(testDir, '.github', 'prompts', 'verify.prompt.md'),
      CODER_AGENT: path.join(testDir, '.github', 'agents', 'coder.agent.md'),
      SAFETY_CHECKER_AGENT: path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'),
    });

    assert.strictEqual(result.code, 1, result.stderr);
    const errorLines = result.stderr.trim().split(/\r?\n/).filter(Boolean);
    assert.strictEqual(errorLines.length, 1, result.stderr);
    assert.ok(errorLines[0].includes('P1-010'), 'validator must report the latency boundary rule id');
    assert.ok(errorLines[0].includes('safety-checker.agent.md'), 'validator must identify the broken safety-checker contract file');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations fails closed when a required review-routing contract file is missing', () => {
  const testDir = createTestDir();
  try {
    writeReviewRoutingFixture(testDir);
    fs.rmSync(path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'));

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      COMMON_AGENTS_INSTRUCTIONS: path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'),
      COMMON_DEVELOPMENT_WORKFLOW: path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'),
      KNOWLEDGE_AUDIT_PROMPT: path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'),
      VERIFY_PROMPT: path.join(testDir, '.github', 'prompts', 'verify.prompt.md'),
      CODER_AGENT: path.join(testDir, '.github', 'agents', 'coder.agent.md'),
      SAFETY_CHECKER_AGENT: path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'),
    });

    assert.strictEqual(result.code, 1, result.stderr);
    assert.ok(result.stderr.includes('P1-010'), 'validator must fail with the knowledge-audit boundary rule id');
    assert.ok(result.stderr.includes('knowledge-audit.prompt.md'), 'validator must identify the missing contract file');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations still fails closed when every review-routing signal file is deleted but the root lane remains', () => {
  const testDir = createTestDir();
  try {
    writeReviewRoutingFixture(testDir);
    fs.rmSync(path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'));
    fs.rmSync(path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'));
    fs.rmSync(path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'));
    fs.rmSync(path.join(testDir, '.github', 'prompts', 'verify.prompt.md'));
    fs.rmSync(path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'));

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      COMMON_AGENTS_INSTRUCTIONS: path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'),
      COMMON_DEVELOPMENT_WORKFLOW: path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'),
      KNOWLEDGE_AUDIT_PROMPT: path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'),
      VERIFY_PROMPT: path.join(testDir, '.github', 'prompts', 'verify.prompt.md'),
      CODER_AGENT: path.join(testDir, '.github', 'agents', 'coder.agent.md'),
      SAFETY_CHECKER_AGENT: path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'),
    });

    assert.strictEqual(result.code, 1, result.stderr);
    assert.ok(result.stderr.includes('common-agents.instructions.md'), 'validator must report the deleted source-of-truth instruction');
    assert.ok(result.stderr.includes('knowledge-audit.prompt.md'), 'validator must report the deleted knowledge-audit prompt');
    assert.ok(result.stderr.includes('safety-checker.agent.md'), 'validator must report the deleted safety-checker agent');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations fails closed when review-routing signals and the root lane are both removed in a repo-level fixture', () => {
  const testDir = createTestDir();
  try {
    writeReviewRoutingFixture(testDir, {
      '.github/copilot-instructions.md': (source) => source.replace(
        '**planner → (handoff) → coder → (handoff) → researcher (review)**',
        '**planner → coder**'
      ).replace(
        'Keep researcher as the default implementation review path.',
        'Use code-reviewer after implementation changes.'
      ),
    });
    fs.writeFileSync(path.join(testDir, 'package.json'), '{"name":"fixture"}\n');
    fs.rmSync(path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'));
    fs.rmSync(path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'));
    fs.rmSync(path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'));
    fs.rmSync(path.join(testDir, '.github', 'prompts', 'verify.prompt.md'));
    fs.rmSync(path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'));

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      COMMON_AGENTS_INSTRUCTIONS: path.join(testDir, '.github', 'instructions', 'common-agents.instructions.md'),
      COMMON_DEVELOPMENT_WORKFLOW: path.join(testDir, '.github', 'instructions', 'common-development-workflow.instructions.md'),
      KNOWLEDGE_AUDIT_PROMPT: path.join(testDir, '.github', 'prompts', 'knowledge-audit.prompt.md'),
      VERIFY_PROMPT: path.join(testDir, '.github', 'prompts', 'verify.prompt.md'),
      CODER_AGENT: path.join(testDir, '.github', 'agents', 'coder.agent.md'),
      SAFETY_CHECKER_AGENT: path.join(testDir, '.github', 'agents', 'safety-checker.agent.md'),
    });

    assert.strictEqual(result.code, 1, result.stderr);
    assert.ok(result.stderr.includes('common-agents.instructions.md'), 'validator must fail when the repo-level fixture loses the review-routing instruction');
    assert.ok(result.stderr.includes('verify.prompt.md'), 'validator must fail when the repo-level fixture loses verify.prompt.md');
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

results.push(test('deterministic hooks keep session-scoped cleanup for temporary safety and async typecheck state', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'hooks', 'deterministic-hooks.json'),
    'utf8'
  ));

  const stopCommands = (hooksConfig.hooks.Stop || []).flatMap((entry) =>
    (entry.hooks || []).map((hook) => normalizeHookCommand(hook.command))
  );

  assert.ok(Array.isArray(hooksConfig.hooks.Stop), 'deterministic hooks must keep the Stop event');
  assert.ok(
    stopCommands.some((command) => command.includes('safety-backup.js cleanup')),
    'deterministic hooks must keep the safety-backup cleanup command on Stop'
  );
  assert.ok(
    stopCommands.some((command) => command.includes('post-edit-typecheck.js cleanup')),
    'deterministic hooks must keep the async typecheck cleanup command on Stop'
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

results.push(test('package manifest keeps the shipped Codex runtime surface in the published files surface', () => {
  assert.strictEqual(isPublishedRepoFile('.codex/AGENTS.md'), true, '.codex/AGENTS.md should stay in the published package surface');
  assert.strictEqual(isPublishedRepoFile('.codex/config.toml'), true, '.codex/config.toml should stay in the published package surface');
  assert.strictEqual(isPublishedRepoFile('.codex/hooks.json'), true, '.codex/hooks.json should stay in the published package surface');
  assert.strictEqual(isPublishedRepoFile('.codex/rules/security.rules'), true, '.codex/rules/security.rules should stay in the published package surface');
  assert.strictEqual(isPublishedRepoFile('.codex/agents/explorer.toml'), true, '.codex/agents/explorer.toml should stay in the published package surface');
  assert.strictEqual(isPublishedRepoFile('scripts/codex/codex-flow.js'), true, 'scripts/codex/codex-flow.js should stay in the published package surface');
}));

results.push(test('package manifest keeps every shipped Codex agent registration in the published files surface', () => {
  const codexAgentsDir = path.join(repoRoot, '.codex', 'agents');
  const shippedAgentFiles = fs.readdirSync(codexAgentsDir)
    .filter((entry) => entry.endsWith('.toml'));

  assert.ok(shippedAgentFiles.length > 0, 'expected shipped Codex agent registrations to exist');
  for (const agentFile of shippedAgentFiles) {
    assert.strictEqual(
      isPublishedRepoFile(path.posix.join('.codex', 'agents', agentFile)),
      true,
      `${agentFile} should stay in the published package surface`
    );
  }
}));

results.push(test('README variants document the root AGENTS boundary for Codex project instructions', () => {
  const readmeEn = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const readmeJa = fs.readFileSync(path.join(repoRoot, 'README.ja.md'), 'utf8');
  const readmeZh = fs.readFileSync(path.join(repoRoot, 'README.zh-CN.md'), 'utf8');

  assert.ok(readmeEn.includes('Codex continues to read the root `AGENTS.md` for project instructions'), 'README.md should document the root AGENTS boundary for Codex');
  assert.ok(readmeJa.includes('Codex は project instructions として root の `AGENTS.md` を読み続けます'), 'README.ja.md should document the root AGENTS boundary for Codex');
  assert.ok(readmeZh.includes('Codex 会继续读取根目录 `AGENTS.md` 作为项目 instructions'), 'README.zh-CN.md should document the root AGENTS boundary for Codex');
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

results.push(test('review routing policy keeps researcher as default and code-reviewer as high-risk-only across shipped and compatibility docs', () => {
  const rootAgents = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'instructions', 'common-agents.instructions.md'),
    'utf8'
  );
  const rootWorkflow = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'instructions', 'common-development-workflow.instructions.md'),
    'utf8'
  );
  const copilotInstructions = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'copilot-instructions.md'),
    'utf8'
  );
  const rulesStructure = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'ja-JP', 'RULES-STRUCTURE.md'),
    'utf8'
  );
  const jaCodeReviewer = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'ja-JP', 'agents', 'code-reviewer.md'),
    'utf8'
  );
  const orchestrateDoc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'ja-JP', 'commands', 'orchestrate.md'),
    'utf8'
  );
  const jaAgents = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'ja-JP', 'rules', 'agents.md'),
    'utf8'
  );
  const jaGitWorkflow = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'ja-JP', 'rules', 'git-workflow.md'),
    'utf8'
  );
  const compatibilityInstructions = fs.readFileSync(
    path.join(__dirname, '..', '..', '.opencode', 'instructions', 'INSTRUCTIONS.md'),
    'utf8'
  );
  const compatibilityOrchestrate = fs.readFileSync(
    path.join(__dirname, '..', '..', '.opencode', 'commands', 'orchestrate.md'),
    'utf8'
  );
  const compatibilityCodeReview = fs.readFileSync(
    path.join(__dirname, '..', '..', '.opencode', 'commands', 'code-review.md'),
    'utf8'
  );
  const compatibilityReadme = fs.readFileSync(
    path.join(__dirname, '..', '..', '.opencode', 'README.md'),
    'utf8'
  );
  const compatibilityMigration = fs.readFileSync(
    path.join(__dirname, '..', '..', '.opencode', 'MIGRATION.md'),
    'utf8'
  );
  const compatibilityConfig = fs.readFileSync(
    path.join(__dirname, '..', '..', '.opencode', 'opencode.json'),
    'utf8'
  );
  const compatibilityPlugin = fs.readFileSync(
    path.join(__dirname, '..', '..', '.opencode', 'plugins', 'ecc-hooks.ts'),
    'utf8'
  );
  const compatibilityPackage = fs.readFileSync(
    path.join(__dirname, '..', '..', '.opencode', 'package.json'),
    'utf8'
  );
  const scriptsAgents = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', '.github', 'instructions', 'common-agents.instructions.md'),
    'utf8'
  );
  const scriptsWorkflow = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', '.github', 'instructions', 'common-development-workflow.instructions.md'),
    'utf8'
  );
  const scriptsHooks = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', '.github', 'hooks', 'deterministic-hooks.json'),
    'utf8'
  );
  const scriptsVerifyPrompt = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', '.github', 'prompts', 'verify.prompt.md'),
    'utf8'
  );
  const scriptsVerificationLoop = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', '.github', 'skills', 'verification-loop', 'SKILL.md'),
    'utf8'
  );
  const rootSearchFirst = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'skills', 'search-first', 'SKILL.md'),
    'utf8'
  );
  const scriptsSearchFirst = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', '.github', 'skills', 'search-first', 'SKILL.md'),
    'utf8'
  );

  assert.ok(rootAgents.includes('High-risk code just written/modified'), 'root common-agents instructions must keep high-risk-only code-reviewer routing');
  assert.ok(rootWorkflow.includes('Repo-internal dependency tracing first') && rootWorkflow.includes('default implementation review') && rootWorkflow.includes('high-risk changes'), 'root workflow instructions must keep internal static exploration first and code-reviewer as high-risk-only');
  assert.ok(copilotInstructions.includes('Keep researcher as the default implementation review path'), 'root copilot instructions must keep researcher as the default review path');
  assert.ok(rootAgents.includes('Immediately after high-risk edits'), 'root common-agents instructions must keep the high-risk safety-checker wording aligned');
  assert.ok(rulesStructure.includes('高リスクまたは横断変更時'), 'Japanese rules structure doc must keep high-risk code-reviewer wording');
  assert.ok(jaCodeReviewer.includes('高リスクまたは横断的'), 'Japanese code-reviewer doc must keep the high-risk review scope');
  assert.ok(orchestrateDoc.includes('planner -> coder -> researcher') && orchestrateDoc.includes('高リスク変更では**code-reviewerを含める**'), 'Japanese orchestrate doc must keep the default lane and high-risk code-reviewer guidance');
  assert.ok(jaAgents.includes('planner -> coder -> researcher') && jaAgents.includes('高リスク変更'), 'Japanese agent rules must mention the default lane and high-risk review gating');
  assert.ok(jaGitWorkflow.includes('planner -> coder -> researcher') && jaGitWorkflow.includes('高リスク変更'), 'Japanese git workflow rules must keep the default lane and high-risk review gating');
  assert.ok(compatibilityInstructions.includes('.github/` is the active GitHub Copilot source of truth') && compatibilityInstructions.includes('High-risk code just written/modified'), 'OpenCode compatibility instructions must keep the source-of-truth note and high-risk review gating');
  assert.ok(compatibilityInstructions.includes('doc-updater') && compatibilityInstructions.includes('go-build-resolver') && compatibilityInstructions.includes('database-reviewer'), 'OpenCode compatibility instructions must describe the shipped legacy specialist agents accurately');
  assert.ok(compatibilityInstructions.includes('not running in the `strict` profile') && compatibilityInstructions.includes('`standard` keeps warning-oriented hooks'), 'OpenCode compatibility instructions must describe strict-vs-standard hook behavior accurately');
  assert.ok(compatibilityOrchestrate.includes('planner → tdd-guide → build-error-resolver') && compatibilityOrchestrate.includes('High-Risk Sequential Execution'), 'OpenCode orchestrate guide must keep a legacy-compatible default lane and a separate high-risk review path');
  assert.ok(!compatibilityOrchestrate.includes('researcher'), 'OpenCode orchestrate guide must avoid agents that are not shipped in the legacy catalog');
  assert.ok(compatibilityCodeReview.includes('Review high-risk or cross-cutting changes'), 'OpenCode code-review command must keep the high-risk review wording');
  assert.ok(compatibilityReadme.includes('High-risk or cross-cutting review') && compatibilityReadme.includes('doc-updater') && compatibilityReadme.includes('Commands (26 configured)'), 'OpenCode README must keep the high-risk code-reviewer wording and match the shipped legacy inventory');
  assert.ok(compatibilityReadme.includes('AGENTS.md') && compatibilityReadme.includes('skills/*') && compatibilityReadme.includes('POSIX-style shell utilities') && !compatibilityReadme.includes('Check for secrets'), 'OpenCode README must document the package asset boundary, OS caveat, and actual pre-tool hook behavior');
  assert.ok(compatibilityMigration.includes('High-risk or cross-cutting review') && compatibilityMigration.includes('doc-updater') && compatibilityMigration.includes('26 configured commands') && compatibilityMigration.includes('AGENTS.md') && compatibilityMigration.includes('skills/*') && compatibilityMigration.includes('POSIX-style shell commands') && !compatibilityMigration.includes('Check for secrets before commit'), 'OpenCode migration doc must keep the high-risk code-reviewer wording, package boundary guidance, OS caveat, and shipped hook semantics');
  assert.ok(compatibilityConfig.includes('Reviews high-risk or cross-cutting changes') && compatibilityConfig.includes('Review high-risk or cross-cutting changes'), 'OpenCode config must keep high-risk-only code-review routing for both the agent and command descriptions');
  assert.ok(
    compatibilityPlugin.includes('hookEnabled("post:edit:format", ["strict"])')
      && compatibilityPlugin.includes('hookEnabled("post:edit:typecheck", ["strict"])')
      && !compatibilityPlugin.includes('scanForSecrets')
      && !compatibilityPlugin.includes('Secret Detection'),
    'OpenCode plugin implementation must show strict-only format/typecheck and no built-in secret scan'
  );
  assert.ok(compatibilityPackage.includes('"commands"') && !compatibilityPackage.includes('AGENTS.md') && !compatibilityPackage.includes('CONTRIBUTING.md') && !compatibilityPackage.includes('skills'), 'OpenCode package manifest must continue to omit repo-level docs and skill assets from the published files list');
  assert.ok(scriptsAgents.includes('High-risk code just written/modified') && scriptsAgents.includes('coder') && scriptsAgents.includes('researcher'), 'scripts/.github common-agents copy must stay aligned with the root routing structure');
  assert.ok(scriptsWorkflow.includes('Repo-internal dependency tracing first') && scriptsWorkflow.includes('default implementation review') && scriptsWorkflow.includes('high-risk changes'), 'scripts/.github workflow copy must stay aligned with the root review routing and static exploration priority');
  assert.ok(scriptsHooks.includes('Edit|Write|MultiEdit') && scriptsHooks.includes('post-edit-typecheck.js cleanup') && scriptsHooks.includes('safety-backup.js cleanup'), 'scripts/.github hook mirror must keep the expanded matchers and both session cleanup commands');
  assert.ok(scriptsVerifyPrompt.includes('verification-only mode') && scriptsVerifyPrompt.includes('final verification or high-risk change sets'), 'scripts/.github verify prompt mirror must stay aligned with the verification-only contract');
  assert.ok(scriptsVerificationLoop.includes('checklist') && scriptsVerificationLoop.includes('最終確認') && scriptsVerificationLoop.includes('high-risk'), 'scripts/.github verification-loop mirror must stay aligned with the current staged verification guidance');
  assert.ok(rootSearchFirst.includes('workflow for external reuse') && rootSearchFirst.includes('static exploration such as usage search') && rootSearchFirst.includes('actual references, call paths, or rename impact'), 'root search-first skill must keep external reuse positioning and internal static exploration guidance');
  assert.ok(scriptsSearchFirst.includes('workflow for external reuse') && scriptsSearchFirst.includes('static exploration such as usage search') && scriptsSearchFirst.includes('actual references, call paths, or rename impact'), 'scripts/.github search-first mirror must stay aligned with the root discovery guidance');
}));

results.push(test('knowledge-audit, safety-checker, and verify contracts keep the new latency-sensitive boundaries explicit', () => {
  const knowledgeAuditPrompt = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'prompts', 'knowledge-audit.prompt.md'),
    'utf8'
  );
  const safetyCheckerAgent = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'agents', 'safety-checker.agent.md'),
    'utf8'
  );
  const coderAgent = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'agents', 'coder.agent.md'),
    'utf8'
  );
  const verifyPrompt = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'prompts', 'verify.prompt.md'),
    'utf8'
  );

  assert.ok(knowledgeAuditPrompt.includes('default `researcher`') && knowledgeAuditPrompt.includes('high-risk `code-reviewer`') && knowledgeAuditPrompt.includes('/verify'), 'knowledge-audit prompt must stay separate from researcher review, code-reviewer review, and /verify');
  assert.ok(safetyCheckerAgent.includes('immediately after high-risk coder edits') && safetyCheckerAgent.includes('settings changes'), 'safety-checker agent must keep the high-risk timing and settings-change scope explicit');
  assert.ok(coderAgent.includes('High-risk edit直後に安全性チェックを省略しない') && coderAgent.includes('広い回帰確認は最終確認または high-risk closeout'), 'coder agent must keep the high-risk safety-check and deferred broad regression rules');
  assert.ok(verifyPrompt.includes('final verification or high-risk change sets'), 'verify prompt must keep broad regression checks scoped to final verification or high-risk change sets');
}));

results.push(test('validate-copilot-customizations detects stale .codex/AGENTS.md references', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      agentsDocExtraLines: [
        'Skills are loaded from `.agents/skills/`.',
      ],
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail on stale .codex/AGENTS.md references');
    assert.ok(result.stderr.includes('P1-012'), 'should report P1-012 error');
    assert.ok(result.stderr.includes('.agents/skills/'), 'should identify the stale reference');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires .codex/AGENTS.md to keep the root instruction boundary', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    fs.mkdirSync(path.join(testDir, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(testDir, '.codex', 'config.toml'), 'approval_policy = "on-request"\n');
    fs.writeFileSync(path.join(testDir, '.codex', 'AGENTS.md'), '# Codex CLI guidance\n');
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test\n\n`.codex/` is a compatibility surface.\n');

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when .codex/AGENTS.md drops the Codex boundary guidance');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('.codex/AGENTS.md'), 'should identify the broken Codex guidance file');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires the rest of the Codex runtime surface when .codex exists', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      includeHooks: false,
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when .codex omits documented runtime surface files');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('.codex/hooks.json'), 'should identify the missing Codex hooks surface');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires .codex/config.toml to leave model_instructions_file unset', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      configToml: 'approval_policy = "on-request"\nmodel_instructions_file = "/tmp/override.md"\n',
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when .codex/config.toml overrides root AGENTS instructions');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('model_instructions_file'), 'should identify the unsupported config override');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires checked-in .agents/skills to mirror .github/skills', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
    });
    writeSkill(path.join(testDir, '.github', 'skills', 'mirror-skill', 'SKILL.md'), [
      'name: mirror-skill',
      'description: mirrored source',
    ]);
    writeSkill(path.join(testDir, '.agents', 'skills', 'mirror-skill', 'SKILL.md'), [
      'name: mirror-skill',
      'description: mismatched runtime copy',
    ]);

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
      SKILLS_DIR: path.join(testDir, '.github', 'skills'),
      CODEX_SKILLS_MIRROR_DIR: path.join(testDir, '.agents', 'skills'),
    });

    assert.strictEqual(result.code, 1, 'should fail when .agents/skills drifts from .github/skills');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('.agents/skills'), 'should identify the checked-in Codex skills mirror drift');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations requires README to document .codex boundary', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      readme: '# Test\n\nNo codex mention here.\n',
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when README does not mention .codex');
    assert.ok(result.stderr.includes('P1-012'), 'should report P1-012 error');
    assert.ok(result.stderr.includes('.codex'), 'should mention .codex boundary requirement');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations passes when .codex is clean and README documents it', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
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

results.push(test('validate-copilot-customizations allows .agents/skills/ when path exists', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      agentsDocExtraLines: [
        'Skills from `.agents/skills/` directory.',
      ],
      createSkillsBridge: true,
      readme: '# Test\n\n`.codex/` compatibility surface.\n',
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
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

results.push(test('validate-copilot-customizations rejects .codex hooks Stop handlers that bypass the codex-stop wrapper', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          Stop: [
            {
              description: 'legacy raw stop hooks',
              hooks: [
                {
                  type: 'command',
                  command: 'node ./scripts/hooks/session-stop.js',
                  timeout: 10,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when Stop hooks bypass the codex-stop wrapper');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('.codex/hooks.json'), 'should identify the broken Codex hooks surface');
    assert.ok(result.stderr.includes('codex-stop'), 'should require the codex-stop wrapper');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects .codex hooks that omit Stop entirely', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: 'startup|resume',
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_SESSION_START_COMMAND,
                  timeout: 60,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when Stop is omitted from .codex/hooks.json');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('Stop'), 'should mention the missing Stop contract');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects .codex hooks that omit SessionStart entirely', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_STOP_COMMAND,
                  timeout: 30,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when SessionStart is omitted from .codex/hooks.json');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('SessionStart'), 'should mention the missing SessionStart contract');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects Stop commands that drift from the shipped codex-stop wrapper command', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: 'startup|resume',
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_SESSION_START_COMMAND,
                  timeout: 60,
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `${SHIPPED_CODEX_STOP_COMMAND} && echo unexpected`,
                  timeout: 10,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when the Stop wrapper command drifts from the shipped contract');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('codex-stop'), 'should identify the Stop wrapper contract');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects SessionStart commands that drift from the shipped session-start command', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: 'startup|resume',
              hooks: [
                {
                  type: 'command',
                  command: `${SHIPPED_CODEX_SESSION_START_COMMAND} && echo unexpected`,
                  timeout: 60,
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_STOP_COMMAND,
                  timeout: 30,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when the SessionStart command drifts from the shipped contract');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('SessionStart'), 'should identify the SessionStart contract');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects SessionStart timeouts that drift from the shipped contract', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: 'startup|resume',
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_SESSION_START_COMMAND,
                  timeout: 5,
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_STOP_COMMAND,
                  timeout: 30,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when the SessionStart timeout drifts from the shipped contract');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('SessionStart'), 'should identify the SessionStart contract');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects SessionStart matchers that drift from startup|resume', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: 'startup',
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_SESSION_START_COMMAND,
                  timeout: 60,
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_STOP_COMMAND,
                  timeout: 30,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when the SessionStart matcher drifts from startup|resume');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('SessionStart'), 'should identify the SessionStart contract');
    assert.ok(result.stderr.includes('startup|resume'), 'should mention the required matcher');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects SessionStart matchers with surrounding whitespace', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: ' startup|resume ',
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_SESSION_START_COMMAND,
                  timeout: 60,
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_STOP_COMMAND,
                  timeout: 30,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when the SessionStart matcher contains surrounding whitespace');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('startup|resume'), 'should mention the required matcher');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects .codex/AGENTS.md guidance that claims skills are discovered from .codex/skills', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      createCodexSkillsMirror: true,
      agentsDocExtraLines: [
        'Codex discovers skills from `.codex/skills/`.',
      ],
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
      GITHUB_DIR: path.join(testDir, '.github'),
      README_PATH: path.join(testDir, 'README.md'),
      COPILOT_INSTRUCTIONS: path.join(testDir, '.github', 'copilot-instructions.md'),
      INSTRUCTIONS_DIR: path.join(testDir, '.github', 'instructions'),
      PROMPTS_DIR: path.join(testDir, '.github', 'prompts'),
      AGENTS_DIR: path.join(testDir, '.github', 'agents'),
    });

    assert.strictEqual(result.code, 1, 'should fail when .codex/AGENTS.md rewrites the canonical skills discovery path');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('.codex/skills'), 'should identify the incorrect discovery-path claim');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects Codex hooks that omit apply_patch edit protection', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      hooksJson: JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: 'startup|resume',
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_SESSION_START_COMMAND,
                  timeout: 60,
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: SHIPPED_CODEX_STOP_COMMAND,
                  timeout: 30,
                },
              ],
            },
          ],
        },
      }, null, 2),
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
    });

    assert.strictEqual(result.code, 1, 'should fail when Codex edit hooks are missing');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('apply_patch|Write|Edit'), 'should identify the required edit hook matcher');
  } finally {
    cleanupTestDir(testDir);
  }
}));

results.push(test('validate-copilot-customizations rejects stale Bash-only Codex hook guidance', () => {
  const testDir = createTestDir();
  try {
    writeMinimalRepoFixtures(testDir);
    writeCodexCompatibilitySurface(testDir, {
      createSkillsBridge: true,
      agentsDocExtraLines: [
        'PreToolUse/PostToolUse only intercept Bash tool calls.',
      ],
    });

    const result = runValidatorWithOverrides('validate-copilot-customizations', {
      ROOT: testDir,
    });

    assert.strictEqual(result.code, 1, 'should fail on stale Bash-only Codex hook docs');
    assert.ok(result.stderr.includes('P1-012'), 'should report the Codex contract rule id');
    assert.ok(result.stderr.includes('Bash-only'), 'should explain the stale guidance problem');
  } finally {
    cleanupTestDir(testDir);
  }
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);
if (failed > 0) {
  process.exit(1);
}
