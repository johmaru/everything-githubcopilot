const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const Module = require('module');

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
    return fs.mkdtempSync(path.join(os.tmpdir(), 'egc-session-start-'));
}

function cleanupTestDir(testDir) {
    fs.rmSync(testDir, { recursive: true, force: true });
}

function fileExists(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function writeSessionArtifact(testDir, fileName, content) {
    const sessionsDir = path.join(testDir, '.github', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, fileName), content);
}

function runSessionStart({ cwd, payload, dbStub, moduleOverrides = {} }) {
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'session-start.js');
    const dbPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'db.js');
    const resolvedScriptPath = require.resolve(scriptPath);
    const resolvedDbPath = require.resolve(dbPath);
    const originalCwd = process.cwd();
    const originalLoad = Module._load;
    const originalExit = process.exit;
    const emitted = [];
    let exitCode = null;
    let usedExplicitExit = false;

    class ExitSignal extends Error {
        constructor(code) {
            super(`Exited with code ${code}`);
            this.code = code;
        }
    }

    const sharedStub = {
        emit(message) {
            emitted.push(message);
        },
        getContext() {
            return { payload };
        },
        fileExists,
        readFile,
    };

    delete require.cache[resolvedScriptPath];
    delete require.cache[resolvedDbPath];

    try {
        process.chdir(cwd);

        Module._load = function patchedLoad(request, parent, isMain) {
            if (Object.prototype.hasOwnProperty.call(moduleOverrides, request)) {
                const override = moduleOverrides[request];
                if (override instanceof Error) {
                    throw override;
                }
                return override;
            }

            if (parent && parent.filename === resolvedScriptPath) {
                if (request === './_shared') {
                    return sharedStub;
                }

                if (request === './db' && dbStub) {
                    return dbStub;
                }
            }

            return originalLoad.call(this, request, parent, isMain);
        };

        process.exit = (code = 0) => {
            usedExplicitExit = true;
            exitCode = code;
            throw new ExitSignal(code);
        };

        require(resolvedScriptPath);
        if (exitCode === null) {
            exitCode = 0;
        }
    } catch (err) {
        if (!(err instanceof ExitSignal)) {
            throw err;
        }
    } finally {
        process.exit = originalExit;
        Module._load = originalLoad;
        process.chdir(originalCwd);
        delete require.cache[resolvedScriptPath];
        delete require.cache[resolvedDbPath];
    }

    return { emitted, exitCode, usedExplicitExit };
}

console.log('session-start.js hook tests');

const results = [];

results.push(
    test('uses the real db.open fallback when native dependencies are unavailable', () => {
        const testDir = createTestDir();

        try {
            const sessionsDir = path.join(testDir, '.github', 'sessions');
            const summaryPath = path.join(sessionsDir, 'latest-summary.md');
            fs.mkdirSync(sessionsDir, { recursive: true });
            fs.writeFileSync(summaryPath, 'Recovered from real db fallback.\n');

            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-real-db-fallback' },
                moduleOverrides: {
                    'better-sqlite3': new Error('native module unavailable'),
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.usedExplicitExit, false, 'success path should flush and exit naturally');
            assert.strictEqual(result.emitted.length, 1, 'real DB fallback should emit one JSON payload');

            const output = JSON.parse(result.emitted[0]);
            assert.ok(output.hookSpecificOutput.additionalContext.includes('Recovered from real db fallback.'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('falls back to markdown summary without calling ensureDependencies', () => {
        const testDir = createTestDir();

        try {
            const sessionsDir = path.join(testDir, '.github', 'sessions');
            const summaryPath = path.join(sessionsDir, 'latest-summary.md');
            fs.mkdirSync(sessionsDir, { recursive: true });
            fs.writeFileSync(summaryPath, 'Recovered from markdown fallback.\n');

            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-fallback' },
                dbStub: {
                    ensureDependencies() {
                        throw new Error('ensureDependencies should not be called by session-start');
                    },
                    open() {
                        return null;
                    },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1, 'fallback should emit one JSON payload');

            const output = JSON.parse(result.emitted[0]);
            assert.ok(output.hookSpecificOutput.additionalContext.includes('## Prior Session Summary'));
            assert.ok(output.hookSpecificOutput.additionalContext.includes('Recovered from markdown fallback.'));
            assert.ok(!output.hookSpecificOutput.additionalContext.includes('## Resume Metadata'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('falls back to markdown summary when opening the DB throws', () => {
        const testDir = createTestDir();

        try {
            const sessionsDir = path.join(testDir, '.github', 'sessions');
            const summaryPath = path.join(sessionsDir, 'latest-summary.md');
            fs.mkdirSync(sessionsDir, { recursive: true });
            fs.writeFileSync(summaryPath, 'Recovered after DB open failure.\n');

            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-db-open-failure' },
                dbStub: {
                    open() {
                        throw new Error('database disk image is malformed');
                    },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1, 'DB exceptions should still produce valid SessionStart JSON');

            const output = JSON.parse(result.emitted[0]);
            assert.strictEqual(output.hookSpecificOutput.hookEventName, 'SessionStart');
            assert.ok(output.hookSpecificOutput.additionalContext.includes('Recovered after DB open failure.'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('returns no output when neither DB nor markdown fallback is available', () => {
        const testDir = createTestDir();

        try {
            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-empty' },
                dbStub: {
                    ensureDependencies() {
                        throw new Error('ensureDependencies should not be called by session-start');
                    },
                    open() {
                        return null;
                    },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 0, 'empty fallback should stay silent');
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('prefers DB context when the database is already available', () => {
        const testDir = createTestDir();
        const upsertedSessions = [];

        try {
            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-db' },
                dbStub: {
                    ensureDependencies() {
                        throw new Error('ensureDependencies should not be called by session-start');
                    },
                    open() {
                        return {
                            prepare() {
                                return {
                                    all() {
                                        return [];
                                    },
                                };
                            },
                        };
                    },
                    detectProjectId() {
                        return 'proj-123';
                    },
                    upsertSession(_handle, session) {
                        upsertedSessions.push(session);
                    },
                    getRecentProjectSessions() {
                        return [{ started_at: '2026-04-03T12:00:00Z', summary: 'Recovered from DB.' }];
                    },
                    getPendingTasks(_handle, options) {
                        assert.strictEqual(options.projectId, 'proj-123');
                        return [{ description: 'Validate retry path', status: 'in-progress' }];
                    },
                    searchKnowledgeByKeywords() {
                        return [];
                    },
                    getProjectKnowledge() {
                        return [];
                    },
                    close() { },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(upsertedSessions.length, 1, 'session should be registered in the DB path');
            assert.strictEqual(result.emitted.length, 1, 'DB path should emit one JSON payload');

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(additionalContext.includes('## Prior Session Summaries'));
            assert.ok(additionalContext.includes('Recovered from DB.'));
            assert.ok(additionalContext.includes('## Active Tasks'));
            assert.ok(additionalContext.includes('Validate retry path'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('fills remaining knowledge slots even when project fallback returns duplicate entries first', () => {
        const testDir = createTestDir();

        try {
            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-knowledge-fill' },
                dbStub: {
                    open() {
                        return {
                            prepare() {
                                return {
                                    all() {
                                        return [];
                                    },
                                };
                            },
                        };
                    },
                    detectProjectId() {
                        return 'proj-knowledge';
                    },
                    upsertSession() { },
                    getRecentProjectSessions() {
                        return [];
                    },
                    getPendingTasks() {
                        return [];
                    },
                    searchKnowledgeByKeywords() {
                        return Array.from({ length: 7 }, (_, index) => ({
                            id: index + 1,
                            kind: 'pattern',
                            content: `Keyword knowledge ${index + 1}`,
                            source: 'keywords',
                            confidence: 0.9,
                        }));
                    },
                    getProjectKnowledge(_handle, options) {
                        assert.strictEqual(options.projectId, 'proj-knowledge');
                        assert.strictEqual(options.limit, 12, 'session-start should over-fetch to avoid duplicate underfill');
                        return [
                            { id: 1, kind: 'pattern', content: 'Keyword knowledge 1', source: 'project', confidence: 0.95 },
                            { id: 8, kind: 'workflow', content: 'Unique fallback knowledge', source: 'project', confidence: 0.7 },
                        ];
                    },
                    close() { },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(additionalContext.includes('## Accumulated Knowledge'));
            assert.ok(additionalContext.includes('Unique fallback knowledge'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('ranks hybrid knowledge candidates and suppresses low-confidence generic entries', () => {
        const testDir = createTestDir();

        try {
            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-hybrid-knowledge' },
                dbStub: {
                    open() {
                        return {
                            prepare() {
                                return {
                                    all() {
                                        return [];
                                    },
                                };
                            },
                        };
                    },
                    detectProjectId() {
                        return 'proj-hybrid';
                    },
                    upsertSession() { },
                    getRecentProjectSessions() {
                        return [];
                    },
                    getPendingTasks() {
                        return [];
                    },
                    searchKnowledgeByKeywords() {
                        return [
                            {
                                id: 1,
                                kind: 'workflow',
                                content: 'Repeated workflow (77x): Bash -> Bash',
                                source: 'auto-observation',
                                confidence: 0.8,
                                project_id: 'proj-hybrid',
                                created_at: '2026-04-01T10:00:00Z',
                            },
                            {
                                id: 2,
                                kind: 'error_resolution',
                                content: 'Fix sqlite-vec load failures by preserving keyword fallback',
                                source: 'auto-observation',
                                confidence: 0.5,
                                project_id: 'proj-hybrid',
                                created_at: '2026-04-01T10:01:00Z',
                            },
                        ];
                    },
                    getEmbeddedProjectKnowledge() {
                        return [
                            {
                                id: 3,
                                kind: 'pattern',
                                content: 'SessionStart must not load the embedding model during startup',
                                source: 'manual',
                                confidence: 0.7,
                                project_id: 'proj-hybrid',
                                embedded_at: '2026-04-01T10:02:00Z',
                                hit_count: 4,
                                last_seen_at: '2026-04-01T10:03:00Z',
                            },
                        ];
                    },
                    getProjectKnowledge() {
                        return [
                            {
                                id: 4,
                                kind: 'hotspot',
                                content: 'README.md edited 3 times',
                                source: 'auto-observation',
                                confidence: 0.2,
                                project_id: 'proj-hybrid',
                            },
                        ];
                    },
                    close() { },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(additionalContext.includes('SessionStart must not load the embedding model'));
            assert.ok(additionalContext.includes('Fix sqlite-vec load failures'));
            assert.ok(!additionalContext.includes('Bash -> Bash'));
            assert.ok(!additionalContext.includes('README.md edited 3 times'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('injects only active tasks from the current project', () => {
        const testDir = createTestDir();

        try {
            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-active-scope' },
                dbStub: {
                    open() {
                        return {};
                    },
                    detectProjectId() {
                        return 'proj-scope';
                    },
                    upsertSession() { },
                    getRecentProjectSessions() {
                        return [];
                    },
                    getPendingTasks(_handle, options) {
                        assert.strictEqual(options.projectId, 'proj-scope');
                        return [
                            { description: 'Track pending item', status: 'pending' },
                            { description: 'Track running item', status: 'in-progress' },
                        ];
                    },
                    searchKnowledgeByKeywords() {
                        return [];
                    },
                    getProjectKnowledge() {
                        return [];
                    },
                    close() { },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(additionalContext.includes('## Resume Metadata'));
            assert.ok(additionalContext.includes('- Active Task Count: 2'));
            assert.ok(additionalContext.includes('## Active Tasks'));
            assert.ok(additionalContext.includes('- [ ] Track pending item'));
            assert.ok(additionalContext.includes('- [~] Track running item'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('reports total active task count separately when the displayed task list is truncated', () => {
        const testDir = createTestDir();

        try {
            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-active-truncated' },
                dbStub: {
                    open() {
                        return {};
                    },
                    detectProjectId() {
                        return 'proj-scope';
                    },
                    upsertSession() { },
                    getRecentProjectSessions() {
                        return [];
                    },
                    getPendingTasks(_handle, options) {
                        assert.strictEqual(options.projectId, 'proj-scope');
                        return Array.from({ length: 20 }, (_, index) => ({
                            description: `Displayed task ${index + 1}`,
                            status: index === 0 ? 'in-progress' : 'pending',
                        }));
                    },
                    countPendingTasks(_handle, options) {
                        assert.strictEqual(options.projectId, 'proj-scope');
                        return 24;
                    },
                    searchKnowledgeByKeywords() {
                        return [];
                    },
                    getProjectKnowledge() {
                        return [];
                    },
                    close() { },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(additionalContext.includes('## Resume Metadata'));
            assert.ok(additionalContext.includes('- Active Task Count: 24'));
            assert.ok(additionalContext.includes('- Displayed Task Count: 20'));
            assert.ok(additionalContext.includes('- Active Tasks Truncated: true'));
            assert.ok(additionalContext.includes('## Active Tasks'));
            assert.ok(additionalContext.includes('Displayed task 20'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('injects checkpoint context before DB summaries when checkpoint.md exists', () => {
        const testDir = createTestDir();

        try {
            writeSessionArtifact(testDir, 'checkpoint.md', '# Checkpoint\n\n- Resume with phase 2 implementation.\n');

            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-checkpoint-db' },
                dbStub: {
                    open() {
                        return {
                            prepare() {
                                return {
                                    all() {
                                        return [];
                                    },
                                };
                            },
                        };
                    },
                    detectProjectId() {
                        return 'proj-checkpoint';
                    },
                    upsertSession() { },
                    getRecentProjectSessions() {
                        return [{ started_at: '2026-04-03T12:00:00Z', summary: 'Recovered from DB.' }];
                    },
                    getPendingTasks() {
                        return [];
                    },
                    searchKnowledgeByKeywords() {
                        return [];
                    },
                    getProjectKnowledge() {
                        return [];
                    },
                    close() { },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(additionalContext.includes('## Resume Metadata'));
            assert.ok(additionalContext.includes('- Consumed Artifacts: checkpoint.md'));
            assert.ok(additionalContext.includes('## Checkpoint Resume'));
            assert.ok(additionalContext.includes('Resume with phase 2 implementation.'));
            assert.ok(additionalContext.includes('## Prior Session Summaries'));
            assert.ok(
                additionalContext.indexOf('## Checkpoint Resume') < additionalContext.indexOf('## Prior Session Summaries'),
                'checkpoint context should appear before DB summaries'
            );
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('injects compact snapshot context before DB summaries when compact-snapshot.md exists', () => {
        const testDir = createTestDir();

        try {
            writeSessionArtifact(
                testDir,
                'compact-snapshot.md',
                '# Pre-Compact Snapshot\n\n- **Branch**: feat/phase2\n\n## Modified Files\n\n- scripts/hooks/session-start.js\n'
            );

            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-snapshot-db' },
                dbStub: {
                    open() {
                        return {
                            prepare() {
                                return {
                                    all() {
                                        return [];
                                    },
                                };
                            },
                        };
                    },
                    detectProjectId() {
                        return 'proj-snapshot';
                    },
                    upsertSession() { },
                    getRecentProjectSessions() {
                        return [{ started_at: '2026-04-03T12:00:00Z', summary: 'Recovered from DB.' }];
                    },
                    getPendingTasks() {
                        return [];
                    },
                    searchKnowledgeByKeywords() {
                        return [];
                    },
                    getProjectKnowledge() {
                        return [];
                    },
                    close() { },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(additionalContext.includes('## Resume Metadata'));
            assert.ok(additionalContext.includes('- Consumed Artifacts: compact-snapshot.md'));
            assert.ok(additionalContext.includes('## Pre-Compact Snapshot'));
            assert.ok(additionalContext.includes('feat/phase2'));
            assert.ok(additionalContext.includes('scripts/hooks/session-start.js'));
            assert.ok(
                additionalContext.indexOf('## Pre-Compact Snapshot') < additionalContext.indexOf('## Prior Session Summaries'),
                'compact snapshot should appear before DB summaries'
            );
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('prefers checkpoint and compact snapshot before markdown fallback summary when DB is unavailable', () => {
        const testDir = createTestDir();

        try {
            writeSessionArtifact(testDir, 'checkpoint.md', '# Checkpoint\n\n- Resume with checkpoint context.\n');
            writeSessionArtifact(
                testDir,
                'compact-snapshot.md',
                '# Pre-Compact Snapshot\n\n- **Branch**: feat/fallback\n\n## Modified Files\n\n- PRODUCT.md\n'
            );
            writeSessionArtifact(testDir, 'latest-summary.md', 'Recovered from markdown fallback.\n');

            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-fallback-order' },
                dbStub: {
                    open() {
                        return null;
                    },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(additionalContext.includes('- Consumed Artifacts: checkpoint.md, compact-snapshot.md'));
            assert.ok(additionalContext.includes('## Checkpoint Resume'));
            assert.ok(additionalContext.includes('## Pre-Compact Snapshot'));
            assert.ok(additionalContext.includes('## Prior Session Summary'));
            assert.ok(
                additionalContext.indexOf('## Checkpoint Resume') < additionalContext.indexOf('## Pre-Compact Snapshot') &&
                additionalContext.indexOf('## Pre-Compact Snapshot') < additionalContext.indexOf('## Prior Session Summary'),
                'resume artifacts should appear before markdown fallback summary'
            );
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('ignores blank checkpoint and compact snapshot artifacts', () => {
        const testDir = createTestDir();

        try {
            writeSessionArtifact(testDir, 'checkpoint.md', '   \n');
            writeSessionArtifact(testDir, 'compact-snapshot.md', '\n\n');

            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-blank-artifacts' },
                dbStub: {
                    open() {
                        return {
                            prepare() {
                                return {
                                    all() {
                                        return [];
                                    },
                                };
                            },
                        };
                    },
                    detectProjectId() {
                        return 'proj-blank';
                    },
                    upsertSession() { },
                    getRecentProjectSessions() {
                        return [{ started_at: '2026-04-03T12:00:00Z', summary: 'Recovered from DB.' }];
                    },
                    getPendingTasks() {
                        return [];
                    },
                    searchKnowledgeByKeywords() {
                        return [];
                    },
                    getProjectKnowledge() {
                        return [];
                    },
                    close() { },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);

            const output = JSON.parse(result.emitted[0]);
            const additionalContext = output.hookSpecificOutput.additionalContext;
            assert.ok(!additionalContext.includes('## Checkpoint Resume'));
            assert.ok(!additionalContext.includes('## Pre-Compact Snapshot'));
            assert.ok(additionalContext.includes('## Prior Session Summaries'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('consumes checkpoint and compact snapshot artifacts after injection', () => {
        const testDir = createTestDir();

        try {
            writeSessionArtifact(testDir, 'checkpoint.md', '# Checkpoint\n\n- Resume exactly once.\n');
            writeSessionArtifact(
                testDir,
                'compact-snapshot.md',
                '# Pre-Compact Snapshot\n\n- **Branch**: feat/consume-once\n'
            );

            const result = runSessionStart({
                cwd: testDir,
                payload: { sessionId: 'sess-consume-artifacts' },
                dbStub: {
                    open() {
                        return null;
                    },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(result.emitted.length, 1);
            assert.ok(!fileExists(path.join(testDir, '.github', 'sessions', 'checkpoint.md')));
            assert.ok(!fileExists(path.join(testDir, '.github', 'sessions', 'compact-snapshot.md')));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('the shipped .codex SessionStart command emits a valid SessionStart JSON payload', () => {
        const testDir = createTestDir();

        try {
            const hooksConfig = JSON.parse(
                fs.readFileSync(path.join(__dirname, '..', '..', '.codex', 'hooks.json'), 'utf8')
            );
            const sessionStartCommand = hooksConfig.hooks.SessionStart[0].hooks[0].command;
            const scriptsDir = path.join(testDir, 'scripts', 'hooks');
            const transcriptPath = path.join(testDir, 'transcript.jsonl');

            fs.mkdirSync(path.join(testDir, '.codex'), { recursive: true });
            fs.mkdirSync(path.join(testDir, '.github', 'sessions'), { recursive: true });
            fs.mkdirSync(scriptsDir, { recursive: true });
            fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# test\n', 'utf8');
            fs.writeFileSync(path.join(testDir, '.codex', 'hooks.json'), JSON.stringify(hooksConfig, null, 2), 'utf8');
            fs.writeFileSync(path.join(testDir, '.github', 'sessions', 'latest-summary.md'), 'Recovered from markdown fallback.\n', 'utf8');
            fs.writeFileSync(transcriptPath, '', 'utf8');
            fs.writeFileSync(path.join(scriptsDir, '_shared.js'), [
                'function getContext() {',
                '  const raw = process.stdin.isTTY ? "" : require("fs").readFileSync(0, "utf8");',
                '  return { raw, payload: raw.trim() ? JSON.parse(raw) : {} };',
                '}',
                'function fileExists(filePath) {',
                '  try {',
                '    return require("fs").statSync(filePath).isFile();',
                '  } catch {',
                '    return false;',
                '  }',
                '}',
                'function readFile(filePath) {',
                '  try {',
                '    return require("fs").readFileSync(filePath, "utf8");',
                '  } catch {',
                '    return null;',
                '  }',
                '}',
                'function emit(message) {',
                '  process.stdout.write(`${message}\\n`);',
                '}',
                'module.exports = { emit, fileExists, getContext, readFile };',
                '',
            ].join('\n'), 'utf8');
            fs.copyFileSync(
                path.join(__dirname, '..', '..', 'scripts', 'hooks', 'session-start.js'),
                path.join(scriptsDir, 'session-start.js')
            );
            fs.writeFileSync(path.join(scriptsDir, 'db.js'), 'module.exports = { open() { return null; } };\n', 'utf8');

            const stdout = execSync(sessionStartCommand, {
                cwd: testDir,
                encoding: 'utf8',
                input: JSON.stringify({
                    cwd: testDir,
                    hook_event_name: 'SessionStart',
                    model: 'gpt-5',
                    permission_mode: 'on-request',
                    session_id: 'sess-shipped-session-start',
                    source: 'startup',
                    transcript_path: transcriptPath,
                }),
                shell: true,
            });

            const output = JSON.parse(stdout.trim());
            assert.strictEqual(output.hookSpecificOutput.hookEventName, 'SessionStart');
            assert.ok(output.hookSpecificOutput.additionalContext.includes('Recovered from markdown fallback.'));
        } finally {
            cleanupTestDir(testDir);
        }
    })
);

results.push(
    test('prefers snake_case session_id payload when persisting the current session id', () => {
        const testDir = createTestDir();

        try {
            const result = runSessionStart({
                cwd: testDir,
                payload: { session_id: 'sess-snake-case' },
                dbStub: {
                    open() {
                        return null;
                    },
                },
            });

            assert.strictEqual(result.exitCode, 0);
            assert.strictEqual(
                fs.readFileSync(path.join(testDir, '.github', 'sessions', '.current-session-id'), 'utf8'),
                'sess-snake-case'
            );
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
