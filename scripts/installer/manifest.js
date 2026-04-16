const path = require('path');

const RUNTIME_DEPENDENCY_NAMES = [
  '@huggingface/transformers',
  'ajv',
  'better-sqlite3',
  'sqlite-vec',
];

function getRuntimeDependencies() {
  const packageJson = require(path.join(__dirname, '..', '..', 'package.json'));

  return RUNTIME_DEPENDENCY_NAMES.map((name) => {
    const version = packageJson.dependencies && packageJson.dependencies[name];

    if (!version) {
      throw new Error(`Missing runtime dependency version for ${name}`);
    }

    return `${name}@${version}`;
  });
}

function getUserInstallManifest() {
  return {
    managedPaths: [
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
    ],
    copyOperations: [
      { src: '.github/instructions', dst: 'instructions', recursive: true },
      { src: '.github/copilot-instructions.md', dst: 'instructions/common-copilot.instructions.md', single: true },
      { src: '.github/agents', dst: 'agents', pattern: '*.md' },
      { src: '.github/skills', dst: 'skills', recursive: true },
      { src: '.github/prompts', dst: 'prompts', pattern: '*.prompt.md' },
      { src: '.github/hooks', dst: 'hooks', pattern: '*.json' },
      { src: 'scripts/hooks', dst: 'scripts/hooks', pattern: '*.js' },
      { src: 'schemas', dst: 'schemas', pattern: '*.json' },
      { src: 'tests/fixtures', dst: 'tests/fixtures', recursive: true },
      { src: 'rust/semantic-indexer', dst: 'rust/semantic-indexer', recursive: true, excludeRelativePaths: ['target'] },
    ],
  };
}

function getProjectInstallManifest() {
  return {
    managedPaths: [
      '.agents/skills',
    ],
    copyOperations: [
      { src: '.github/copilot-instructions.md', dst: '.github/copilot-instructions.md', single: true },
      { src: '.github/instructions', dst: '.github/instructions', recursive: true },
      { src: '.github/prompts', dst: '.github/prompts', pattern: '*.prompt.md' },
      { src: '.github/agents', dst: '.github/agents', pattern: '*.agent.md' },
      { src: '.github/hooks', dst: '.github/hooks', pattern: '*.json' },
      { src: '.github/workflows', dst: '.github/workflows', pattern: '*.yml', copyMissingOnly: true },
      { src: '.github/skills', dst: '.github/skills', recursive: true },
      { src: 'scripts/hooks', dst: 'scripts/hooks', pattern: '*.js' },
      { src: 'scripts/ci', dst: 'scripts/ci', pattern: '*.js' },
      { src: 'schemas', dst: 'schemas', pattern: '*.json' },
      { src: '.vscode/settings.json', dst: '.vscode/settings.json', single: true, skipIfExists: true },
      { src: 'AGENTS.md', dst: 'AGENTS.md', single: true },
      { src: 'tests/fixtures', dst: 'tests/fixtures', recursive: true },
      { src: 'rust/semantic-indexer', dst: 'rust/semantic-indexer', recursive: true, excludeRelativePaths: ['target'] },
      { src: '.codex', dst: '.codex', recursive: true },
    ],
  };
}

function getUserCopilotSettings() {
  return {
    'chat.instructionsFilesLocations': {
      '~/.copilot/instructions': true,
      '.claude/rules': false,
      '~/.claude/rules': false,
    },
    'chat.agentFilesLocations': { '~/.copilot/agents': true },
    'chat.agentSkillsLocations': { '~/.copilot/skills': true },
    'chat.promptFilesLocations': { '~/.copilot/prompts': true },
    'chat.hookFilesLocations': {
      '~/.copilot/hooks': true,
      '.claude/settings.json': false,
      '.claude/settings.local.json': false,
      '~/.claude/settings.json': false,
    },
    'chat.useAgentsMdFile': true,
    'chat.useClaudeMdFile': false,
    'chat.includeApplyingInstructions': true,
    'chat.includeReferencedInstructions': true,
  };
}

module.exports = {
  getProjectInstallManifest,
  getRuntimeDependencies,
  getUserCopilotSettings,
  getUserInstallManifest,
};