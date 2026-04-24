const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codexFlow = require('../../scripts/codex/codex-flow');

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

function createTestDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

console.log('codex flow tests');

const results = [];

results.push(test('runFlow executes plan, implement, and review in order and writes phase artifacts under .github/sessions/codex-flow', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const calls = [];

  try {
    const result = codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-001',
      execFileSync(command, args, options) {
        calls.push({ command, args, options });
        return `phase-output-${calls.length}`;
      },
    });

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-001');
    const latestRunFile = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'latest-run.json');
    const planTaskFile = path.join(runRoot, 'plan', 'task.md');
    const implementTaskFile = path.join(runRoot, 'implement', 'task.md');
    const reviewTaskFile = path.join(runRoot, 'review', 'task.md');

    assert.strictEqual(result.runRoot, runRoot);
    assert.deepStrictEqual(calls.map((call) => call.args), [
      ['-p', 'strict', 'exec', '--cwd', targetDir, '--task-file', planTaskFile],
      ['exec', '--cwd', targetDir, '--task-file', implementTaskFile],
      ['-p', 'strict', 'exec', '--cwd', targetDir, '--task-file', reviewTaskFile],
    ]);
    assert.ok(fs.existsSync(planTaskFile), 'plan task file should be written');
    assert.ok(fs.existsSync(implementTaskFile), 'implement task file should be written');
    assert.ok(fs.existsSync(reviewTaskFile), 'review task file should be written');
    assert.ok(fs.existsSync(path.join(runRoot, 'plan', 'stdout.md')), 'plan stdout should be written');
    assert.ok(fs.existsSync(path.join(runRoot, 'implement', 'stdout.md')), 'implement stdout should be written');
    assert.ok(fs.existsSync(path.join(runRoot, 'review', 'stdout.md')), 'review stdout should be written');
    assert.ok(fs.existsSync(latestRunFile), 'latest run pointer should be written inside the artifact root');

    const runMetadata = JSON.parse(fs.readFileSync(path.join(runRoot, 'run.json'), 'utf8'));
    const latestRunMetadata = JSON.parse(fs.readFileSync(latestRunFile, 'utf8'));
    assert.strictEqual(runMetadata.workflow, 'default', 'default workflow should be recorded in run metadata');
    assert.strictEqual(
      runMetadata.runRoot,
      path.join('.github', 'sessions', 'codex-flow', 'run-001'),
      'run metadata should store the artifact root relative to the project root'
    );
    assert.strictEqual(
      latestRunMetadata.runId,
      'run-001',
      'latest run metadata should point at the active run id'
    );
    assert.strictEqual(
      latestRunMetadata.runFile,
      path.join('.github', 'sessions', 'codex-flow', 'run-001', 'run.json'),
      'latest run metadata should stay inside the artifact root'
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(latestRunMetadata, 'taskDescription'),
      false,
      'latest run metadata should not duplicate the task description'
    );
    assert.strictEqual(
      fs.existsSync(path.join(targetDir, '.github', 'sessions', 'latest-run.json')),
      false,
      'latest run metadata should not spill into the parent sessions directory'
    );
    assert.strictEqual(
      runMetadata.phases[0].taskFile,
      path.join('.github', 'sessions', 'codex-flow', 'run-001', 'plan', 'task.md'),
      'run metadata should store relative artifact file paths'
    );
    assert.strictEqual(
      runMetadata.phases[1].handoffFile,
      path.join('.github', 'sessions', 'codex-flow', 'run-001', 'implement', 'handoff.md'),
      'run metadata should keep handoff artifacts inside the codex-flow artifact root'
    );
    assert.deepStrictEqual(runMetadata.phases.map((phase) => ({
      name: phase.name,
      profile: phase.profile,
      status: phase.status,
    })), [
      { name: 'plan', profile: 'strict', status: 'completed' },
      { name: 'implement', profile: null, status: 'completed' },
      { name: 'review', profile: 'strict', status: 'completed' },
    ]);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow supports workflow presets and records the selected phase route', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const calls = [];

  try {
    codexFlow.runFlow('Fix a regression', {
      cwd: targetDir,
      runId: 'run-bugfix',
      workflow: 'bugfix',
      execFileSync(command, args) {
        calls.push({ command, args });
        return `phase-output-${calls.length}`;
      },
    });

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-bugfix');
    const runMetadata = JSON.parse(fs.readFileSync(path.join(runRoot, 'run.json'), 'utf8'));

    assert.deepStrictEqual(runMetadata.phases.map((phase) => phase.name), [
      'inspect',
      'implement',
      'verify',
      'repair',
      'review',
    ]);
    assert.deepStrictEqual(calls.map((call) => call.args[call.args.length - 1]), [
      path.join(runRoot, 'inspect', 'task.md'),
      path.join(runRoot, 'implement', 'task.md'),
      path.join(runRoot, 'verify', 'task.md'),
      path.join(runRoot, 'repair', 'task.md'),
      path.join(runRoot, 'review', 'task.md'),
    ]);
    assert.strictEqual(runMetadata.workflow, 'bugfix');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('main accepts --workflow before the task description', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const calls = [];
  const originalConsoleLog = console.log;

  try {
    console.log = () => {};
    const exitCode = codexFlow.main(['node', 'scripts/codex-flow.js', '--workflow', 'review', 'Review this change'], {
      cwd: targetDir,
      runId: 'run-review-workflow',
      execFileSync(command, args) {
        calls.push({ command, args });
        return `review-workflow-output-${calls.length}`;
      },
    });

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-review-workflow');
    assert.strictEqual(exitCode, 0);
    assert.deepStrictEqual(calls.map((call) => call.args[call.args.length - 1]), [
      path.join(runRoot, 'inspect', 'task.md'),
      path.join(runRoot, 'review', 'task.md'),
    ]);
  } finally {
    console.log = originalConsoleLog;
    cleanupTestDir(targetDir);
  }
}));

results.push(test('main resumes the latest failed run from the first incomplete phase', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const initialCalls = [];
  const resumedCalls = [];

  try {
    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        runId: 'run-resume-latest',
        execFileSync(command, args) {
          initialCalls.push({ command, args });
          if (initialCalls.length === 1) {
            return 'plan output';
          }

          const error = new Error('implement failed');
          error.status = 1;
          error.stdout = 'implement partial output';
          error.stderr = 'implement failure details';
          throw error;
        },
      });
    }, /implement phase failed/i);

    const originalConsoleLog = console.log;
    console.log = () => {};

    try {
      const exitCode = codexFlow.main(['node', 'scripts/codex-flow.js', '--resume-latest'], {
        cwd: targetDir,
        execFileSync(command, args) {
          resumedCalls.push({ command, args });
          return `resumed-output-${resumedCalls.length}`;
        },
      });

      assert.strictEqual(exitCode, 0, 'resume mode should exit successfully when the remaining phases complete');
    } finally {
      console.log = originalConsoleLog;
    }

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-resume-latest');
    assert.deepStrictEqual(resumedCalls.map((call) => call.args), [
      ['exec', '--cwd', targetDir, '--task-file', path.join(runRoot, 'implement', 'task.md')],
      ['-p', 'strict', 'exec', '--cwd', targetDir, '--task-file', path.join(runRoot, 'review', 'task.md')],
    ]);

    const runMetadata = JSON.parse(fs.readFileSync(path.join(runRoot, 'run.json'), 'utf8'));
    assert.deepStrictEqual(
      runMetadata.phases.map((phase) => phase.status),
      ['completed', 'completed', 'completed'],
      'resume mode should complete the remaining phases in place'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('main reruns only the review phase for the latest completed run', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const reviewCalls = [];

  try {
    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-review-latest',
      execFileSync() {
        return 'phase output';
      },
    });

    const originalConsoleLog = console.log;
    console.log = () => {};

    try {
      const exitCode = codexFlow.main(['node', 'scripts/codex-flow.js', '--review-latest'], {
        cwd: targetDir,
        execFileSync(command, args) {
          reviewCalls.push({ command, args });
          return 'refreshed review output';
        },
      });

      assert.strictEqual(exitCode, 0, 'review-latest should exit successfully');
    } finally {
      console.log = originalConsoleLog;
    }

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-review-latest');
    assert.deepStrictEqual(reviewCalls.map((call) => call.args), [
      ['-p', 'strict', 'exec', '--cwd', targetDir, '--task-file', path.join(runRoot, 'review', 'task.md')],
    ]);
    assert.strictEqual(
      fs.readFileSync(path.join(runRoot, 'review', 'stdout.md'), 'utf8'),
      'refreshed review output',
      'review-latest should refresh only the review artifact'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('main fails closed when resume mode has no latest run metadata', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const originalConsoleError = console.error;
  const errors = [];

  try {
    console.error = (message) => {
      errors.push(String(message));
    };

    const exitCode = codexFlow.main(['node', 'scripts/codex-flow.js', '--resume-latest'], {
      cwd: targetDir,
    });

    assert.strictEqual(exitCode, 1, 'resume mode should fail when no latest run metadata exists');
    assert.ok(errors.some((message) => message.includes('latest run metadata')), 'resume mode should explain the missing latest run metadata');
  } finally {
    console.error = originalConsoleError;
    cleanupTestDir(targetDir);
  }
}));

results.push(test('main fails closed on unknown options instead of starting a new run', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const originalConsoleError = console.error;
  const errors = [];

  try {
    console.error = (message) => {
      errors.push(String(message));
    };

    const exitCode = codexFlow.main(['node', 'scripts/codex-flow.js', '--review-lates'], {
      cwd: targetDir,
      execFileSync() {
        throw new Error('unknown options must not start codex execution');
      },
    });

    assert.strictEqual(exitCode, 1, 'unknown options should fail closed');
    assert.ok(errors.some((message) => message.includes('unknown option: --review-lates')));
    assert.strictEqual(
      fs.existsSync(path.join(targetDir, '.github', 'sessions', 'codex-flow')),
      false,
      'unknown options must not create launcher artifacts'
    );
  } finally {
    console.error = originalConsoleError;
    cleanupTestDir(targetDir);
  }
}));

results.push(test('main fails closed when option-like tokens appear after the task description', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const originalConsoleError = console.error;
  const errors = [];

  try {
    console.error = (message) => {
      errors.push(String(message));
    };

    const exitCode = codexFlow.main(['node', 'scripts/codex-flow.js', 'add launcher', '--review-lates'], {
      cwd: targetDir,
      execFileSync() {
        throw new Error('trailing option-like tokens must not start codex execution');
      },
    });

    assert.strictEqual(exitCode, 1, 'trailing option-like tokens should fail closed');
    assert.ok(errors.some((message) => message.includes('unexpected option after task description: --review-lates')));
    assert.strictEqual(
      fs.existsSync(path.join(targetDir, '.github', 'sessions', 'codex-flow')),
      false,
      'trailing option-like tokens must not create launcher artifacts'
    );
  } finally {
    console.error = originalConsoleError;
    cleanupTestDir(targetDir);
  }
}));

results.push(test('readLatestRunState rejects mismatched latest-run pointers', () => {
  const targetDir = createTestDir('egc-codex-flow-');

  try {
    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-pointer-a',
      execFileSync() {
        return 'phase output';
      },
    });

    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-pointer-b',
      execFileSync() {
        return 'phase output';
      },
    });

    const latestRunFile = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'latest-run.json');
    fs.writeFileSync(latestRunFile, JSON.stringify({
      runId: 'run-pointer-a',
      runFile: path.join('.github', 'sessions', 'codex-flow', 'run-pointer-b', 'run.json'),
      updatedAt: new Date().toISOString(),
    }, null, 2));

    assert.throws(() => {
      codexFlow.readLatestRunState({ cwd: targetDir });
    }, /runFile must match runId/i);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow writes structured handoff artifacts and cleans up the transient checkpoint artifact', () => {
  const targetDir = createTestDir('egc-codex-flow-');

  try {
    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-handoff-artifacts',
      execFileSync() {
        return 'phase output';
      },
    });

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-handoff-artifacts');
    const implementTaskFile = path.join(runRoot, 'implement', 'task.md');
    const reviewTaskFile = path.join(runRoot, 'review', 'task.md');
    const implementHandoffFile = path.join(runRoot, 'implement', 'handoff.md');
    const reviewHandoffFile = path.join(runRoot, 'review', 'handoff.md');
    const checkpointFile = path.join(targetDir, '.github', 'sessions', 'checkpoint.md');

    assert.ok(fs.existsSync(implementHandoffFile), 'implement phase should have a structured handoff artifact');
    assert.ok(fs.existsSync(reviewHandoffFile), 'review phase should have a structured handoff artifact');
    assert.ok(
      fs.readFileSync(implementTaskFile, 'utf8').includes(path.join('.github', 'sessions', 'codex-flow', 'run-handoff-artifacts', 'implement', 'handoff.md')),
      'implement prompt should reference the structured handoff artifact'
    );
    assert.ok(
      fs.readFileSync(reviewTaskFile, 'utf8').includes(path.join('.github', 'sessions', 'codex-flow', 'run-handoff-artifacts', 'review', 'handoff.md')),
      'review prompt should reference the structured handoff artifact'
    );
    assert.ok(
      fs.readFileSync(implementHandoffFile, 'utf8').includes('Current Phase: implement'),
      'implement handoff should identify the current phase'
    );
    assert.ok(
      fs.readFileSync(implementHandoffFile, 'utf8').includes(path.join('.github', 'sessions', 'codex-flow', 'run-handoff-artifacts', 'plan', 'stdout.md')),
      'implement handoff should point to the plan output artifact'
    );
    assert.strictEqual(
      fs.existsSync(checkpointFile),
      false,
      'launcher should clean up the shared checkpoint bridge after each phase'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow preserves a preexisting checkpoint after transient bridge cleanup', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const checkpointFile = path.join(targetDir, '.github', 'sessions', 'checkpoint.md');
  const originalCheckpoint = '# Existing Checkpoint\n\nDo not overwrite permanently.\n';

  try {
    fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
    fs.writeFileSync(checkpointFile, originalCheckpoint, 'utf8');

    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-preserve-checkpoint',
      execFileSync() {
        return 'phase output';
      },
    });

    assert.strictEqual(
      fs.readFileSync(checkpointFile, 'utf8'),
      originalCheckpoint,
      'launcher should restore any preexisting checkpoint after each transient bridge write'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow does not restore a stale codex-flow checkpoint bridge', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const checkpointFile = path.join(targetDir, '.github', 'sessions', 'checkpoint.md');
  const staleCheckpoint = [
    '# Checkpoint Resume',
    '',
    'X-Codex-Flow-Checkpoint: 1',
    'Owner: codex-flow/stale-run/implement/stale-owner',
    '',
    'Current Phase: implement',
  ].join('\n');

  try {
    fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
    fs.writeFileSync(checkpointFile, staleCheckpoint, 'utf8');

    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-drop-stale-checkpoint',
      execFileSync() {
        return 'phase output';
      },
    });

    assert.strictEqual(
      fs.existsSync(checkpointFile),
      false,
      'launcher should not restore a previous transient codex-flow checkpoint bridge'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow preserves a preexisting checkpoint when phase setup fails before execution', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const escapedDir = createTestDir('egc-codex-flow-escape-');
  const checkpointFile = path.join(targetDir, '.github', 'sessions', 'checkpoint.md');
  const originalCheckpoint = '# Existing Checkpoint\n\nPreserve on setup failure.\n';
  const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-checkpoint-setup-failure');
  const redirectedTaskFile = path.join(runRoot, 'implement', 'task.md');
  const redirectedTarget = path.join(escapedDir, 'implement-task.md');
  const calls = [];

  try {
    fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
    fs.writeFileSync(checkpointFile, originalCheckpoint, 'utf8');
    fs.mkdirSync(path.dirname(redirectedTaskFile), { recursive: true });

    try {
      fs.symlinkSync(redirectedTarget, redirectedTaskFile, process.platform === 'win32' ? 'file' : 'file');
    } catch {
      return;
    }

    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        runId: 'run-checkpoint-setup-failure',
        execFileSync(command, args) {
          calls.push({ command, args });
          return 'phase output';
        },
      });
    }, /artifact file must not resolve through symbolic links or junctions/i);

    assert.strictEqual(calls.length, 1, 'implement execution must not start when phase setup fails');
    assert.strictEqual(
      fs.readFileSync(checkpointFile, 'utf8'),
      originalCheckpoint,
      'preexisting checkpoint should remain intact when phase setup fails before execution'
    );
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(escapedDir);
  }
}));

results.push(test('runFlow rejects redirected checkpoint leaf files before reading them', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const escapedDir = createTestDir('egc-codex-flow-escape-');
  const checkpointFile = path.join(targetDir, '.github', 'sessions', 'checkpoint.md');
  const redirectedCheckpoint = path.join(escapedDir, 'checkpoint.md');
  const calls = [];

  try {
    fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });

    try {
      fs.symlinkSync(redirectedCheckpoint, checkpointFile, process.platform === 'win32' ? 'file' : 'file');
    } catch {
      return;
    }

    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        runId: 'run-checkpoint-leaf-redirect',
        execFileSync(command, args) {
          calls.push({ command, args });
          return 'phase output';
        },
      });
    }, /checkpoint file must not resolve through symbolic links or junctions/i);

    assert.strictEqual(calls.length, 1, 'launcher should stop before implement execution when checkpoint leaf is redirected');
    assert.strictEqual(fs.existsSync(redirectedCheckpoint), false, 'launcher must not read or write through a redirected checkpoint leaf');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(escapedDir);
  }
}));

results.push(test('runFlow restores a preexisting user checkpoint across overlapping launcher bridges', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const checkpointFile = path.join(targetDir, '.github', 'sessions', 'checkpoint.md');
  const originalCheckpoint = '# Existing Checkpoint\n\nRestore me after overlap.\n';
  let callCount = 0;
  let launchedNestedRun = false;

  try {
    fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
    fs.writeFileSync(checkpointFile, originalCheckpoint, 'utf8');

    codexFlow.runFlow('Outer task', {
      cwd: targetDir,
      runId: 'run-overlap-a',
      execFileSync() {
        callCount += 1;

        if (callCount === 2 && !launchedNestedRun) {
          launchedNestedRun = true;
          codexFlow.runFlow('Nested task', {
            cwd: targetDir,
            runId: 'run-overlap-b',
            execFileSync() {
              return 'nested phase output';
            },
          });
        }

        return 'phase output';
      },
    });

    assert.strictEqual(
      fs.readFileSync(checkpointFile, 'utf8'),
      originalCheckpoint,
      'the original non-launcher checkpoint should survive overlapping transient bridges'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow keeps latest-run pinned to the latest launched flow', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  let launchedNestedRun = false;

  try {
    codexFlow.runFlow('Older task', {
      cwd: targetDir,
      runId: 'run-older',
      execFileSync() {
        if (!launchedNestedRun) {
          launchedNestedRun = true;
          codexFlow.runFlow('Newer task', {
            cwd: targetDir,
            runId: 'run-newer',
            execFileSync() {
              return 'nested phase output';
            },
          });
        }

        return 'phase output';
      },
    });

    const latestRunMetadata = JSON.parse(fs.readFileSync(
      path.join(targetDir, '.github', 'sessions', 'codex-flow', 'latest-run.json'),
      'utf8'
    ));

    assert.strictEqual(
      latestRunMetadata.runId,
      'run-newer',
      'phase updates from an older flow must not reclaim the latest-run pointer'
    );
    assert.strictEqual(
      latestRunMetadata.runFile,
      path.join('.github', 'sessions', 'codex-flow', 'run-newer', 'run.json'),
      'latest-run should stay attached to the latest launched flow metadata'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('resumeLatestRun fails closed when the same run is already active', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  let callCount = 0;
  let nestedCheckPerformed = false;

  try {
    codexFlow.runFlow('Outer task', {
      cwd: targetDir,
      runId: 'run-active-lock',
      execFileSync() {
        callCount += 1;

        if (callCount === 2 && !nestedCheckPerformed) {
          nestedCheckPerformed = true;
          assert.throws(() => {
            codexFlow.resumeLatestRun({
              cwd: targetDir,
              execFileSync() {
                throw new Error('resume should not reach codex execution while the run lock is held');
              },
            });
          }, /run is already active: run-active-lock/i);
        }

        return 'phase output';
      },
    });

    assert.strictEqual(
      fs.existsSync(path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-active-lock', 'active.lock')),
      false,
      'the per-run lock should be cleaned up after the owning invocation completes'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('reviewLatestRun recovers a stale run lock left by a dead process', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const reviewCalls = [];

  try {
    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-stale-lock',
      execFileSync() {
        return 'phase output';
      },
    });

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-stale-lock');
    const lockFile = path.join(runRoot, 'active.lock');
    fs.writeFileSync(lockFile, JSON.stringify({
      lockId: 'stale-lock',
      runId: 'run-stale-lock',
      pid: 999999,
      mode: 'review-latest',
      startedAt: new Date().toISOString(),
    }, null, 2));

    const exitCode = codexFlow.main(['node', 'scripts/codex-flow.js', '--review-latest'], {
      cwd: targetDir,
      execFileSync(command, args) {
        reviewCalls.push({ command, args });
        return 'fresh review output';
      },
    });

    assert.strictEqual(exitCode, 0, 'review-latest should recover stale locks from dead processes');
    assert.deepStrictEqual(reviewCalls.map((call) => call.args), [
      ['-p', 'strict', 'exec', '--cwd', targetDir, '--task-file', path.join(runRoot, 'review', 'task.md')],
    ]);
    assert.strictEqual(fs.existsSync(lockFile), false, 'stale run locks should be replaced and cleaned up after success');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('reviewLatestRun recovers a malformed stale run lock', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const reviewCalls = [];

  try {
    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-malformed-lock',
      execFileSync() {
        return 'phase output';
      },
    });

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-malformed-lock');
    const lockFile = path.join(runRoot, 'active.lock');
    fs.writeFileSync(lockFile, '{ not-json');

    const exitCode = codexFlow.main(['node', 'scripts/codex-flow.js', '--review-latest'], {
      cwd: targetDir,
      execFileSync(command, args) {
        reviewCalls.push({ command, args });
        return 'fresh review output';
      },
    });

    assert.strictEqual(exitCode, 0, 'review-latest should recover malformed stale locks');
    assert.deepStrictEqual(reviewCalls.map((call) => call.args), [
      ['-p', 'strict', 'exec', '--cwd', targetDir, '--task-file', path.join(runRoot, 'review', 'task.md')],
    ]);
    assert.strictEqual(fs.existsSync(lockFile), false, 'malformed stale locks should be replaced and cleaned up after success');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow stops before implement when the codex binary is missing', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const calls = [];

  try {
    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        runId: 'run-enoent',
        execFileSync(command, args) {
          calls.push({ command, args });
          const error = new Error('spawn codex ENOENT');
          error.code = 'ENOENT';
          throw error;
        },
      });
    }, /codex binary not found/i);

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-enoent');
    assert.strictEqual(calls.length, 1, 'only the plan phase should attempt execution');
    assert.ok(fs.existsSync(path.join(runRoot, 'plan', 'task.md')), 'plan task file should still be written');
    assert.ok(!fs.existsSync(path.join(runRoot, 'implement')), 'implement artifacts should not be created');

    const runMetadata = JSON.parse(fs.readFileSync(path.join(runRoot, 'run.json'), 'utf8'));
    assert.strictEqual(runMetadata.phases[0].status, 'failed');
    assert.strictEqual(runMetadata.phases[1].status, 'pending');
    assert.strictEqual(runMetadata.phases[2].status, 'pending');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow stops after a failed plan phase and does not start implement or review', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const calls = [];

  try {
    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        runId: 'run-plan-failure',
        execFileSync(command, args) {
          calls.push({ command, args });
          const error = new Error('plan failed');
          error.status = 1;
          error.stdout = 'partial plan output';
          error.stderr = 'plan failure details';
          throw error;
        },
      });
    }, /plan phase failed/i);

    const runRoot = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'run-plan-failure');
    assert.strictEqual(calls.length, 1, 'later phases must not run after a plan failure');
    assert.strictEqual(fs.readFileSync(path.join(runRoot, 'plan', 'stdout.md'), 'utf8'), 'partial plan output');
    assert.strictEqual(fs.readFileSync(path.join(runRoot, 'plan', 'stderr.md'), 'utf8'), 'plan failure details');
    assert.ok(!fs.existsSync(path.join(runRoot, 'implement')), 'implement artifacts should not be created after a failed plan');
    assert.ok(!fs.existsSync(path.join(runRoot, 'review')), 'review artifacts should not be created after a failed plan');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow rejects artifact roots that escape the project root', () => {
  const targetDir = createTestDir('egc-codex-flow-');

  try {
    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        artifactRoot: path.join(targetDir, '..', 'escaped-artifacts'),
        runId: 'run-escape',
        execFileSync() {
          throw new Error('should not execute');
        },
      });
    }, /artifact root must stay inside the project root/i);
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow resolves a relative artifact root from the project root', () => {
  const targetDir = createTestDir('egc-codex-flow-');

  try {
    const result = codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      artifactRoot: path.join('.github', 'custom-artifacts'),
      runId: 'run-relative-root',
      execFileSync() {
        return 'phase output';
      },
    });

    assert.strictEqual(
      result.runRoot,
      path.join(targetDir, '.github', 'custom-artifacts', 'run-relative-root')
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow rejects artifact paths when .github resolves outside the project root', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const escapedDir = createTestDir('egc-codex-flow-escape-');
  const linkedGithubDir = path.join(targetDir, '.github');

  try {
    try {
      fs.symlinkSync(escapedDir, linkedGithubDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        runId: 'run-symlink-escape',
        execFileSync() {
          throw new Error('should not execute');
        },
      });
    }, /artifact root must not resolve through symbolic links or junctions/i);
    assert.deepStrictEqual(fs.readdirSync(escapedDir), [], 'no artifacts should be written through the escaped .github link');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(escapedDir);
  }
}));

results.push(test('runFlow rejects artifact paths when .github redirects inside the project root', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const redirectedDir = path.join(targetDir, 'redirected-github');
  const linkedGithubDir = path.join(targetDir, '.github');

  try {
    fs.mkdirSync(redirectedDir, { recursive: true });

    try {
      fs.symlinkSync(redirectedDir, linkedGithubDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        runId: 'run-symlink-inside-root',
        execFileSync() {
          throw new Error('should not execute');
        },
      });
    }, /artifact root must not resolve through symbolic links or junctions/i);

    assert.deepStrictEqual(
      fs.readdirSync(redirectedDir),
      [],
      'no artifacts should be written through an in-repo redirected artifact ancestor'
    );
  } finally {
    cleanupTestDir(targetDir);
  }
}));

results.push(test('runFlow rejects artifact leaf files that redirect outside the project root', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const escapedDir = createTestDir('egc-codex-flow-escape-');
  const latestRunFile = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'latest-run.json');
  const redirectedFile = path.join(escapedDir, 'latest-run.json');

  try {
    fs.mkdirSync(path.dirname(latestRunFile), { recursive: true });

    try {
      fs.symlinkSync(redirectedFile, latestRunFile, process.platform === 'win32' ? 'file' : 'file');
    } catch {
      return;
    }

    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        runId: 'run-leaf-symlink-escape',
        execFileSync() {
          throw new Error('should not execute');
        },
      });
    }, /artifact file must not resolve through symbolic links or junctions/i);

    assert.strictEqual(
      fs.existsSync(redirectedFile),
      false,
      'no artifacts should be written through a redirected leaf file'
    );
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(escapedDir);
  }
}));

results.push(test('runFlow breaks preexisting hard-linked artifact leaves before writing', () => {
  const targetDir = createTestDir('egc-codex-flow-');
  const escapedDir = createTestDir('egc-codex-flow-escape-');
  const latestRunFile = path.join(targetDir, '.github', 'sessions', 'codex-flow', 'latest-run.json');
  const externalFile = path.join(escapedDir, 'latest-run.json');

  try {
    fs.mkdirSync(path.dirname(latestRunFile), { recursive: true });
    fs.writeFileSync(externalFile, 'external sentinel', 'utf8');

    try {
      fs.linkSync(externalFile, latestRunFile);
    } catch {
      return;
    }

    codexFlow.runFlow('Add a launcher command', {
      cwd: targetDir,
      runId: 'run-hard-link-leaf',
      execFileSync() {
        return 'phase output';
      },
    });

    assert.strictEqual(
      fs.readFileSync(externalFile, 'utf8'),
      'external sentinel',
      'writing artifact files should not mutate an existing external hard-linked target'
    );

    const latestRunMetadata = JSON.parse(fs.readFileSync(latestRunFile, 'utf8'));
    assert.strictEqual(latestRunMetadata.runId, 'run-hard-link-leaf');
  } finally {
    cleanupTestDir(targetDir);
    cleanupTestDir(escapedDir);
  }
}));

results.push(test('runFlow rejects run identifiers that are not simple path segments', () => {
  const targetDir = createTestDir('egc-codex-flow-');

  try {
    assert.throws(() => {
      codexFlow.runFlow('Add a launcher command', {
        cwd: targetDir,
        artifactRoot: '.',
        runId: '.',
        execFileSync() {
          throw new Error('should not execute');
        },
      });
    }, /runId must be a simple path segment/i);
    assert.strictEqual(fs.existsSync(path.join(targetDir, 'run.json')), false, 'invalid run identifiers must not write project-root artifacts');
  } finally {
    cleanupTestDir(targetDir);
  }
}));

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\n  ${passed} passing, ${failed} failing`);

if (failed > 0) {
  process.exit(1);
}
