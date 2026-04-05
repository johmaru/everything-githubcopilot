const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const entryPoints = require('../../scripts/hooks/codebase-entry-points');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-entry-points-'));
}

function createWorkspaceTestDir() {
  const baseDir = path.join(__dirname, '..', '..', '.github', 'sessions', '.test-entry-points');
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.mkdtempSync(path.join(baseDir, 'case-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

console.log('codebase-entry-points.js helper tests');

const results = [];

results.push(
  test('collectSourceFiles keeps .github skills but excludes .github sessions backups', () => {
    const testDir = createTestDir();

    try {
      fs.mkdirSync(path.join(testDir, '.github', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(testDir, '.github', 'sessions', 'safety-backups'), {
        recursive: true,
      });
      fs.mkdirSync(path.join(testDir, '.opencode'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'node_modules', 'pkg'), { recursive: true });

      fs.writeFileSync(
        path.join(testDir, '.github', 'skills', 'parser.py'),
        'def parse():\n    return True\n'
      );
      fs.writeFileSync(
        path.join(testDir, '.github', 'sessions', 'safety-backups', 'shadow.rs'),
        'pub fn hidden() {}\n'
      );
      fs.writeFileSync(
        path.join(testDir, '.opencode', 'index.ts'),
        'export const value = 1;\n'
      );
      fs.writeFileSync(
        path.join(testDir, 'node_modules', 'pkg', 'skip.ts'),
        'export const skip = 1;\n'
      );

      const files = entryPoints.collectSourceFiles(testDir).map((file) => file.relativePath);

      assert.deepStrictEqual(files, ['.github/skills/parser.py', '.opencode/index.ts']);
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('detectIndexChanges reports changed and removed files from manifest data', () => {
    const previousManifest = {
      'src/a.ts': { mtimeMs: 10, size: 20 },
      'src/removed.py': { mtimeMs: 5, size: 9 },
    };
    const currentFiles = [
      { relativePath: 'src/a.ts', absolutePath: '/tmp/src/a.ts', mtimeMs: 11, size: 20 },
      { relativePath: 'src/new.rs', absolutePath: '/tmp/src/new.rs', mtimeMs: 1, size: 2 },
    ];

    const changes = entryPoints.detectIndexChanges(previousManifest, currentFiles);

    assert.deepStrictEqual(
      changes.changedFiles.map((file) => file.relativePath),
      ['src/a.ts', 'src/new.rs']
    );
    assert.deepStrictEqual(changes.removedFiles, ['src/removed.py']);
  })
);

results.push(
  test('ensureWithinWorkspace rejects paths outside the repository workspace', () => {
    const outsidePath = path.resolve(os.tmpdir(), 'outside-entry-points.json');

    assert.throws(
      () => entryPoints.ensureWithinWorkspace(outsidePath, 'index path'),
      /must stay within the workspace/
    );
  })
);

results.push(
  test('rankEntryPoints orders results by cosine score and respects topK', () => {
    const entries = [
      {
        stable_symbol_id: 'a',
        file_path: 'src/a.ts',
        embedding: [1, 0, 0],
        kind: 'function',
        name: 'alpha',
      },
      {
        stable_symbol_id: 'b',
        file_path: 'src/b.py',
        embedding: [0.5, 0.5, 0],
        kind: 'function',
        name: 'beta',
      },
      {
        stable_symbol_id: 'c',
        file_path: 'src/c.rs',
        embedding: [0, 1, 0],
        kind: 'struct',
        name: 'gamma',
      },
    ];

    const ranked = entryPoints.rankEntryPoints([0.9, 0.1, 0], entries, 2);

    assert.strictEqual(ranked.length, 2);
    assert.strictEqual(ranked[0].stable_symbol_id, 'a');
    assert.strictEqual(ranked[1].stable_symbol_id, 'b');
    assert.ok(ranked[0].score > ranked[1].score);
  })
);

results.push(
  test('rankEntryPointsByKeyword falls back to lexical overlap when embeddings are unavailable', () => {
    const entries = [
      {
        stable_symbol_id: 'a',
        file_path: 'src/a.ts',
        name: 'semanticIndexer',
        text: 'semantic indexer rust parser symbol extraction',
      },
      {
        stable_symbol_id: 'b',
        file_path: 'src/b.py',
        name: 'knowledgeSearch',
        text: 'knowledge retrieval embedding lookup',
      },
    ];

    const ranked = entryPoints.rankEntryPointsByKeyword(
      'semantic rust parser',
      entries,
      1
    );

    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].stable_symbol_id, 'a');
    assert.ok(ranked[0].score > 0);
  })
);

results.push(
  test('evaluateQueries counts hits when expected symbols appear within topK', () => {
    const entries = [
      {
        stable_symbol_id: 'typescript:src/a.ts:function:alpha:0',
        file_path: 'src/a.ts',
        name: 'alpha',
        embedding: [1, 0],
      },
      {
        stable_symbol_id: 'python:src/b.py:function:beta:0',
        file_path: 'src/b.py',
        name: 'beta',
        embedding: [0, 1],
      },
    ];
    const cases = [
      {
        query: 'alpha workflow',
        queryEmbedding: [1, 0],
        expected: { file_path: 'src/a.ts', name: 'alpha' },
      },
      {
        query: 'beta workflow',
        queryEmbedding: [0, 1],
        expected: { file_path: 'src/b.py', name: 'beta' },
      },
    ];

    const report = entryPoints.evaluateQueries(cases, entries, 1);

    assert.strictEqual(report.total, 2);
    assert.strictEqual(report.hits, 2);
    assert.strictEqual(report.missCount, 0);
    assert.ok(report.hitRate > 0.9);
  })
);

results.push(
  test('runEvalCommand uses the shipped eval fixture when cases are omitted', () => {
    const testDir = createWorkspaceTestDir();
    const repoRoot = path.join(__dirname, '..', '..');
    const indexFile = path.join(testDir, 'entry-points-index.json');

    try {
      fs.writeFileSync(indexFile, JSON.stringify({
        entries: [
          {
            file_path: '.opencode/index.ts',
            name: 'metadata',
            text: 'plugin metadata ecc universal description author features',
          },
          {
            file_path: '.opencode/plugins/ecc-hooks.ts',
            name: 'ECCHooksPlugin',
            text: 'opencode hook plugin tool execute before session idle file edited',
          },
          {
            file_path: '.github/skills/skill-comply/scripts/parser.py',
            name: 'parse_spec',
            text: 'parse yaml compliance spec threshold promote to hook',
          },
          {
            file_path: 'rust/semantic-indexer/src/lib.rs',
            name: 'extract_symbols_from_source_with_language',
            text: 'extract symbols from source with language tree sitter typescript python rust',
          },
        ],
      }, null, 2));

      const output = execFileSync(
        'node',
        [
          path.join(repoRoot, 'scripts', 'hooks', 'codebase-entry-points.js'),
          'eval',
          '--root',
          repoRoot,
          '--index-file',
          indexFile,
          '--top-k',
          '1',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 120000,
        }
      );
      const report = JSON.parse(output);

      assert.strictEqual(report.total, 4);
      assert.strictEqual(report.hits, 4);
      assert.strictEqual(report.missCount, 0);
      assert.strictEqual(report.hitRate, 1);
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

results.push(
  test('package entry-points:eval script points to the shipped eval fixture', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
    );

    assert.ok(
      packageJson.scripts['entry-points:eval'].includes('--cases tests/fixtures/entry-points/eval-cases.json')
    );
  })
);

results.push(
  test('resolveRequestedFiles reports missing explicit files for targeted removals', () => {
    const testDir = createWorkspaceTestDir();

    try {
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src', 'present.ts'), 'export const present = true;\n');
      const currentFiles = entryPoints.collectSourceFiles(testDir);

      const resolved = entryPoints.resolveRequestedFiles(testDir, currentFiles, [
        'src/present.ts',
        'src/missing.ts',
      ]);

      assert.deepStrictEqual(
        resolved.selectedFiles.map((file) => file.relativePath),
        ['src/present.ts']
      );
      assert.deepStrictEqual(resolved.missingRelativePaths, ['src/missing.ts']);
    } finally {
      cleanupTestDir(testDir);
    }
  })
);

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);
if (failed > 0) {
  process.exit(1);
}