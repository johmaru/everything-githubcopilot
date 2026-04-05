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