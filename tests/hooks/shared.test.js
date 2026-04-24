const assert = require('assert');

const shared = require('../../scripts/hooks/_shared');

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

console.log('_shared hook helper tests');

const originalEnv = process.env.TOOL_INPUT_FILE_PATH;
const results = [];

results.push(test('getFilePaths prefers explicit edit file paths and ignores unrelated nested path metadata', () => {
  const filePaths = shared.getFilePaths({
    payload: {
      tool_input: {
        edits: [
          { filePath: 'src/edited.ts' },
        ],
        metadata: {
          path: 'docs/guide.md',
        },
      },
      path: 'package.json',
    },
  });

  assert.deepStrictEqual(filePaths, ['src/edited.ts']);
}));

results.push(test('getFilePaths falls back to tool input file path environment variables when payload has no explicit file path', () => {
  process.env.TOOL_INPUT_FILE_PATH = 'src/from-env.ts';

  const filePaths = shared.getFilePaths({ payload: null });
  assert.deepStrictEqual(filePaths, ['src/from-env.ts']);
}));

results.push(test('getFilePaths extracts changed file paths from Codex apply_patch command payloads', () => {
  const filePaths = shared.getFilePaths({
    payload: {
      tool_name: 'apply_patch',
      tool_input: {
        command: [
          '*** Begin Patch',
          '*** Add File: src/new.ts',
          '+export const value = 1;',
          '*** Update File: src/existing.ts',
          '@@',
          '-old',
          '+new',
          '*** Delete File: docs/old.md',
          '*** End Patch',
        ].join('\n'),
      },
    },
  });

  assert.deepStrictEqual(filePaths, ['src/new.ts', 'src/existing.ts', 'docs/old.md']);
}));

results.push(test('getFilePaths extracts source and destination paths from Codex apply_patch move payloads', () => {
  const filePaths = shared.getFilePaths({
    payload: {
      tool_name: 'apply_patch',
      tool_input: {
        command: [
          '*** Begin Patch',
          '*** Update File: src/old-name.ts',
          '*** Move to: src/new-name.ts',
          '@@',
          '-export const oldName = true;',
          '+export const newName = true;',
          '*** End Patch',
        ].join('\n'),
      },
    },
  });

  assert.deepStrictEqual(filePaths, ['src/old-name.ts', 'src/new-name.ts']);
}));

if (originalEnv === undefined) {
  delete process.env.TOOL_INPUT_FILE_PATH;
} else {
  process.env.TOOL_INPUT_FILE_PATH = originalEnv;
}

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}
