const assert = require('assert');
const packageJson = require('../../package.json');

const {
  getProjectInstallManifest,
  getRuntimeDependencies,
  getUserCodexInstallManifest,
  getUserCopilotSettings,
  getUserInstallManifest,
} = require('../../scripts/installer/manifest');

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

console.log('installer manifest tests');

const results = [];

results.push(test('user install manifest includes the expected managed paths', () => {
  const manifest = getUserInstallManifest();

  assert.deepStrictEqual(manifest.managedPaths, [
    'instructions',
    'agents',
    'skills',
    'prompts',
    'hooks',
    'scripts/hooks',
    'schemas',
    'tests/fixtures',
    'rust/semantic-indexer',
    'package.json',
    'node_modules',
    'package-lock.json',
  ]);
}));

results.push(test('user install manifest maps repo assets into ~/.copilot payload locations', () => {
  const manifest = getUserInstallManifest();
  const bySource = new Map(manifest.copyOperations.map(operation => [operation.src, operation]));

  assert.strictEqual(bySource.get('.github/instructions').dst, 'instructions');
  assert.strictEqual(bySource.get('.github/instructions').recursive, true);
  assert.strictEqual(bySource.get('.github/copilot-instructions.md').dst, 'instructions/common-copilot.instructions.md');
  assert.strictEqual(bySource.get('.github/agents').dst, 'agents');
  assert.strictEqual(bySource.get('.github/skills').dst, 'skills');
  assert.strictEqual(bySource.get('.github/prompts').dst, 'prompts');
  assert.strictEqual(bySource.get('.github/hooks').dst, 'hooks');
  assert.strictEqual(bySource.get('scripts/hooks').dst, 'scripts/hooks');
  assert.strictEqual(bySource.get('schemas').dst, 'schemas');
  assert.strictEqual(bySource.get('tests/fixtures').dst, 'tests/fixtures');
  assert.strictEqual(bySource.get('rust/semantic-indexer').dst, 'rust/semantic-indexer');
  assert.strictEqual(bySource.get('rust/semantic-indexer').recursive, true);
}));

results.push(test('project install manifest includes the current shipped project payload', () => {
  const manifest = getProjectInstallManifest();
  const sources = manifest.copyOperations.map(operation => operation.src).sort();
  const instructionsOperation = manifest.copyOperations.find(operation => operation.src === '.github/instructions');
  const codexFlowOperation = manifest.copyOperations.find(operation => operation.src === 'scripts/codex/codex-flow.js');

  assert.deepStrictEqual(sources, [
    '.codex',
    '.github/agents',
    '.github/copilot-instructions.md',
    '.github/hooks',
    '.github/instructions',
    '.github/prompts',
    '.github/skills',
    '.github/workflows',
    '.vscode/settings.json',
    'AGENTS.md',
    'rust/semantic-indexer',
    'schemas',
    'scripts/ci',
    'scripts/codex/codex-flow.js',
    'scripts/hooks',
    'tests/fixtures',
  ]);
  assert.strictEqual(instructionsOperation.recursive, true);
  assert.strictEqual(codexFlowOperation.dst, 'scripts/codex-flow.js');
  assert.strictEqual(codexFlowOperation.single, true);
  assert.deepStrictEqual(manifest.managedPaths, ['.agents/skills', '.codex/skills']);
}));

results.push(test('user install manifest does not include .codex (Codex reads from project root, not ~/.copilot)', () => {
  const manifest = getUserInstallManifest();
  const sources = manifest.copyOperations.map(operation => operation.src);
  const managedPaths = manifest.managedPaths;

  assert.ok(!sources.some(src => src.startsWith('.codex')), 'user install should not copy .codex');
  assert.ok(!managedPaths.some(p => p.startsWith('.codex')), 'user install should not manage .codex paths');
}));

results.push(test('user Codex install manifest maps assets into a namespaced ~/.codex payload', () => {
  const manifest = getUserCodexInstallManifest();
  const bySource = new Map(manifest.copyOperations.map(operation => [operation.src, operation]));

  assert.deepStrictEqual(manifest.managedPaths, [
    'everything-githubcopilot',
    'skills/everything-githubcopilot',
  ]);
  assert.strictEqual(bySource.get('.codex/config.toml').dst, 'everything-githubcopilot/config.toml');
  assert.strictEqual(bySource.get('.codex/hooks.json').dst, 'everything-githubcopilot/hooks.json');
  assert.strictEqual(bySource.get('.codex/agents').dst, 'everything-githubcopilot/agents');
  assert.strictEqual(bySource.get('.codex/rules').dst, 'everything-githubcopilot/rules');
  assert.strictEqual(bySource.get('scripts/hooks').dst, 'everything-githubcopilot/scripts/hooks');
  assert.strictEqual(bySource.get('scripts/codex/codex-flow.js').dst, 'everything-githubcopilot/scripts/codex-flow.js');
  assert.strictEqual(bySource.get('.github/skills').dst, 'skills/everything-githubcopilot');
  assert.deepStrictEqual(manifest.activeFiles.map(operation => operation.dst), [
    'config.toml',
    'hooks.json',
    'rules/everything-githubcopilot-security.rules',
  ]);
}));

results.push(test('runtime dependencies include all hook and validator dependencies', () => {
  assert.deepStrictEqual(getRuntimeDependencies(), [
    `@huggingface/transformers@${packageJson.dependencies['@huggingface/transformers']}`,
    `ajv@${packageJson.dependencies.ajv}`,
    `better-sqlite3@${packageJson.dependencies['better-sqlite3']}`,
    `sqlite-vec@${packageJson.dependencies['sqlite-vec']}`,
  ]);
}));

results.push(test('user copilot settings mirror the repo baseline discovery settings', () => {
  const settings = getUserCopilotSettings();

  assert.deepStrictEqual(settings['chat.agentFilesLocations'], { '~/.copilot/agents': true });
  assert.deepStrictEqual(settings['chat.agentSkillsLocations'], { '~/.copilot/skills': true });
  assert.deepStrictEqual(settings['chat.promptFilesLocations'], { '~/.copilot/prompts': true });
  assert.deepStrictEqual(settings['chat.hookFilesLocations'], {
    '~/.copilot/hooks': true,
    '.claude/settings.json': false,
    '.claude/settings.local.json': false,
    '~/.claude/settings.json': false,
  });
  assert.deepStrictEqual(settings['chat.instructionsFilesLocations'], {
    '~/.copilot/instructions': true,
    '.claude/rules': false,
    '~/.claude/rules': false,
  });
  assert.strictEqual(settings['chat.useAgentsMdFile'], true);
  assert.strictEqual(settings['chat.useClaudeMdFile'], false);
  assert.strictEqual(settings['chat.includeApplyingInstructions'], true);
  assert.strictEqual(settings['chat.includeReferencedInstructions'], true);
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}
