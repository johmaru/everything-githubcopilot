#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync: defaultExecFileSync } = require('child_process');

const PHASE_DEFINITIONS = new Map([
  ['plan', { name: 'plan', profile: 'strict' }],
  ['inspect', { name: 'inspect', profile: 'strict' }],
  ['implement', { name: 'implement', profile: null }],
  ['verify', { name: 'verify', profile: null }],
  ['review', { name: 'review', profile: 'strict' }],
  ['repair', { name: 'repair', profile: null }],
]);

const WORKFLOW_PRESETS = {
  default: ['plan', 'implement', 'review'],
  bugfix: ['inspect', 'implement', 'verify', 'repair', 'review'],
  refactor: ['plan', 'inspect', 'implement', 'verify', 'review'],
  review: ['inspect', 'review'],
};

const DEFAULT_ARTIFACT_ROOT = path.join('.github', 'sessions', 'codex-flow');
const LATEST_RUN_FILE_NAME = 'latest-run.json';

function normalizeComparablePath(targetPath) {
  return process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
}

function pathIsInsideRoot(rootPath, candidatePath) {
  const normalizedRootPath = normalizeComparablePath(rootPath);
  const normalizedCandidatePath = normalizeComparablePath(candidatePath);

  return normalizedCandidatePath === normalizedRootPath
    || normalizedCandidatePath.startsWith(`${normalizedRootPath}${path.sep}`);
}

function pathEntryExists(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getLinkTargetPath(targetPath) {
  try {
    const rawTarget = fs.readlinkSync(targetPath);
    return path.isAbsolute(rawTarget)
      ? path.normalize(rawTarget)
      : path.resolve(path.dirname(targetPath), rawTarget);
  } catch {
    return null;
  }
}

function printUsage() {
  console.log([
    'Usage:',
    '  node scripts/codex-flow.js "task description"',
    '  node scripts/codex-flow.js --workflow default "task description"',
    '  node scripts/codex-flow.js --workflow bugfix "task description"',
    '  node scripts/codex-flow.js --workflow refactor "task description"',
    '  node scripts/codex-flow.js --workflow review "task description"',
    '  node scripts/codex-flow.js --resume-latest',
    '  node scripts/codex-flow.js --review-latest',
  ].join('\n'));
}

function generateRunId(now = new Date()) {
  return now.toISOString().replace(/[.:]/g, '-');
}

function ensurePathInsideProjectRoot(projectRoot, candidatePath, label) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const normalizedCandidatePath = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(normalizedProjectRoot, candidatePath);

  if (!pathIsInsideRoot(normalizedProjectRoot, normalizedCandidatePath)) {
    throw new Error(`${label} must stay inside the project root`);
  }

  return normalizedCandidatePath;
}

function ensureExistingPathChainResolvesInsideProjectRoot(projectRoot, targetPath, label, options = {}) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const normalizedTargetPath = path.resolve(targetPath);
  const realProjectRoot = fs.realpathSync.native(normalizedProjectRoot);
  const relativeTargetPath = path.relative(normalizedProjectRoot, normalizedTargetPath);
  const rejectLinks = options.rejectLinks === true;

  if (!relativeTargetPath) {
    return;
  }

  let currentPath = normalizedProjectRoot;

  for (const segment of relativeTargetPath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);

    if (!pathEntryExists(currentPath)) {
      continue;
    }

    const linkTarget = getLinkTargetPath(currentPath);
    if (linkTarget) {
      if (rejectLinks) {
        throw new Error(`${label} must not resolve through symbolic links or junctions`);
      }

      if (!pathIsInsideRoot(realProjectRoot, path.resolve(linkTarget))) {
        throw new Error(`${label} must stay inside the project root`);
      }

      continue;
    }

    const realCurrentPath = fs.realpathSync.native(currentPath);
    if (!pathIsInsideRoot(realProjectRoot, realCurrentPath)) {
      throw new Error(`${label} must stay inside the project root`);
    }
  }
}

function ensureWritableArtifactPath(projectRoot, filePath, label) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const normalizedFilePath = ensurePathInsideProjectRoot(normalizedProjectRoot, filePath, label);

  ensureExistingPathChainResolvesInsideProjectRoot(normalizedProjectRoot, path.dirname(normalizedFilePath), label, {
    rejectLinks: true,
  });

  if (!pathEntryExists(normalizedFilePath)) {
    return normalizedFilePath;
  }

  const linkTarget = getLinkTargetPath(normalizedFilePath);
  if (linkTarget) {
    throw new Error(`${label} must not resolve through symbolic links or junctions`);
  }

  const realFilePath = fs.realpathSync.native(normalizedFilePath);
  if (!pathIsInsideRoot(fs.realpathSync.native(normalizedProjectRoot), realFilePath)) {
    throw new Error(`${label} must stay inside the project root`);
  }

  return normalizedFilePath;
}

function validateRunId(runId) {
  if (!runId
    || typeof runId !== 'string'
    || runId === '.'
    || runId === '..'
    || runId !== path.basename(runId)
    || runId.includes('..')) {
    throw new Error('runId must be a simple path segment');
  }

  return runId;
}

function normalizeWorkflowName(workflowName) {
  const normalizedWorkflowName = typeof workflowName === 'string' && workflowName.trim()
    ? workflowName.trim()
    : 'default';

  if (!Object.prototype.hasOwnProperty.call(WORKFLOW_PRESETS, normalizedWorkflowName)) {
    throw new Error(`unknown workflow: ${normalizedWorkflowName}`);
  }

  return normalizedWorkflowName;
}

function getWorkflowPhaseDefinitions(workflowName) {
  return WORKFLOW_PRESETS[normalizeWorkflowName(workflowName)].map((phaseName) => {
    const phaseDefinition = PHASE_DEFINITIONS.get(phaseName);
    if (!phaseDefinition) {
      throw new Error(`workflow references unknown phase: ${phaseName}`);
    }

    return phaseDefinition;
  });
}

function resolveArtifactBaseDir(cwd, artifactRoot) {
  const artifactBaseDir = ensurePathInsideProjectRoot(
    cwd,
    artifactRoot || path.join(cwd, DEFAULT_ARTIFACT_ROOT),
    'artifact root'
  );
  ensureExistingPathChainResolvesInsideProjectRoot(cwd, artifactBaseDir, 'artifact root', {
    rejectLinks: true,
  });
  return artifactBaseDir;
}

function buildRunContext(taskDescription, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const artifactBaseDir = resolveArtifactBaseDir(cwd, options.artifactRoot);
  const runId = validateRunId(options.runId || generateRunId(options.now || new Date()));
  const runRoot = path.join(artifactBaseDir, runId);
  const workflow = normalizeWorkflowName(options.workflow);
  const phases = getWorkflowPhaseDefinitions(workflow).map((phaseDefinition) => {
    const phaseDir = path.join(runRoot, phaseDefinition.name);

    return {
      name: phaseDefinition.name,
      profile: phaseDefinition.profile,
      phaseDir,
      handoffFile: path.join(phaseDir, 'handoff.md'),
      taskFile: path.join(phaseDir, 'task.md'),
      stdoutFile: path.join(phaseDir, 'stdout.md'),
      stderrFile: path.join(phaseDir, 'stderr.md'),
      status: 'pending',
      errorMessage: null,
    };
  });

  return {
    cwd,
    artifactBaseDir,
    runId,
    runRoot,
    runFile: path.join(runRoot, 'run.json'),
    taskDescription,
    workflow,
    createdAt: options.now instanceof Date
      ? options.now.toISOString()
      : typeof options.now === 'string'
        ? options.now
        : new Date().toISOString(),
    phases,
  };
}

function ensureRunRoot(runContext) {
  fs.mkdirSync(runContext.runRoot, { recursive: true });
}

function toProjectRelativePath(projectRoot, targetPath) {
  return path.relative(projectRoot, targetPath) || '.';
}

function artifactRelativePath(runContext, filePath) {
  return toProjectRelativePath(runContext.cwd, filePath);
}

function writeTextFile(filePath, content, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const safeFilePath = ensureWritableArtifactPath(projectRoot, filePath, options.label || 'artifact file');
  const tempFilePath = ensureWritableArtifactPath(
    projectRoot,
    path.join(path.dirname(safeFilePath), `.${path.basename(safeFilePath)}.${crypto.randomUUID()}.tmp`),
    `${options.label || 'artifact file'} temp file`
  );
  fs.mkdirSync(path.dirname(safeFilePath), { recursive: true });

  if (pathEntryExists(safeFilePath)) {
    const existingEntry = fs.lstatSync(safeFilePath);
    if (existingEntry.isDirectory()) {
      throw new Error(`${options.label || 'artifact file'} must be a file`);
    }
  }

  try {
    fs.writeFileSync(tempFilePath, content, 'utf8');
    fs.renameSync(tempFilePath, safeFilePath);
  } finally {
    fs.rmSync(tempFilePath, { force: true });
  }
}

function readTextFileIfPresent(projectRoot, filePath, label) {
  const safeFilePath = ensurePathInsideProjectRoot(projectRoot, filePath, label);

  if (!fs.existsSync(safeFilePath)) {
    return null;
  }

  ensureExistingPathChainResolvesInsideProjectRoot(projectRoot, safeFilePath, label, {
    rejectLinks: true,
  });

  return fs.readFileSync(safeFilePath, 'utf8');
}

function getLatestRunFilePath(runContext) {
  return path.join(runContext.artifactBaseDir, LATEST_RUN_FILE_NAME);
}

function getSessionsDir(cwd) {
  return path.join(cwd, '.github', 'sessions');
}

function getCheckpointFilePath(cwd) {
  return path.join(getSessionsDir(cwd), 'checkpoint.md');
}

function getRunLockFilePath(runContext) {
  return path.join(runContext.runRoot, 'active.lock');
}

function getRunLockRecoveryFilePath(runContext) {
  return path.join(runContext.runRoot, 'active.lock.recover');
}

function writeLatestRunMetadata(runContext) {
  const latestRunMetadata = {
    runId: runContext.runId,
    runRoot: artifactRelativePath(runContext, runContext.runRoot),
    runFile: artifactRelativePath(runContext, runContext.runFile),
    updatedAt: new Date().toISOString(),
  };

  writeTextFile(
    getLatestRunFilePath(runContext),
    JSON.stringify(latestRunMetadata, null, 2),
    { projectRoot: runContext.cwd }
  );
}

function writeRunMetadata(runContext) {
  ensureRunRoot(runContext);

  const metadata = {
    runId: runContext.runId,
    taskDescription: runContext.taskDescription,
    workflow: runContext.workflow,
    createdAt: runContext.createdAt,
    runRoot: artifactRelativePath(runContext, runContext.runRoot),
    phases: runContext.phases.map((phase) => ({
      name: phase.name,
      profile: phase.profile,
      status: phase.status,
      errorMessage: phase.errorMessage,
      handoffFile: artifactRelativePath(runContext, phase.handoffFile),
      taskFile: artifactRelativePath(runContext, phase.taskFile),
      stdoutFile: artifactRelativePath(runContext, phase.stdoutFile),
      stderrFile: artifactRelativePath(runContext, phase.stderrFile),
    })),
  };

  writeTextFile(runContext.runFile, JSON.stringify(metadata, null, 2), {
    projectRoot: runContext.cwd,
  });
}

function buildPhasePrompt(phase, runContext) {
  const previousOutputs = runContext.phases
    .filter((candidate) => candidate !== phase)
    .filter((candidate) => candidate.status === 'completed' || candidate.name !== phase.name)
    .filter((candidate) => runContext.phases.indexOf(candidate) < runContext.phases.indexOf(phase))
    .map((candidate) => `- ${candidate.name} output: ${artifactRelativePath(runContext, candidate.stdoutFile)}`);

  if (phase.name === 'plan') {
    return [
      'You are planning a Codex-only implementation workflow.',
      '',
      `Task: ${runContext.taskDescription}`,
      `Workflow: ${runContext.workflow}`,
      'Constraints:',
      '- Do not modify files in this phase.',
      '- Produce a concise implementation plan with risks and focused verification steps.',
    ].join('\n');
  }

  if (phase.name === 'inspect') {
    return [
      'You are inspecting the current workspace before a Codex workflow continues.',
      '',
      `Task: ${runContext.taskDescription}`,
      `Workflow: ${runContext.workflow}`,
      '- Do not modify files in this phase.',
      '- Identify the relevant files, current behavior, risks, and focused verification path.',
    ].join('\n');
  }

  if (phase.name === 'implement') {
    return [
      'You are implementing a task from a prior plan.',
      '',
      `Task: ${runContext.taskDescription}`,
      `Workflow: ${runContext.workflow}`,
      `Read the phase handoff first: ${artifactRelativePath(runContext, phase.handoffFile)}`,
      ...previousOutputs,
      '- Implement the necessary changes in the current workspace.',
      '- Run focused verification before finishing.',
      '- Output a concise implementation summary.',
    ].join('\n');
  }

  if (phase.name === 'verify') {
    return [
      'You are verifying a completed Codex implementation.',
      '',
      `Task: ${runContext.taskDescription}`,
      `Workflow: ${runContext.workflow}`,
      `Read the phase handoff first: ${artifactRelativePath(runContext, phase.handoffFile)}`,
      ...previousOutputs,
      '- Run focused validation and tests for the changed behavior.',
      '- Do not broaden scope beyond verification unless a trivial fix is required to make the intended change work.',
      '- Output commands run, results, and any remaining failures.',
    ].join('\n');
  }

  if (phase.name === 'repair') {
    return [
      'You are repairing issues found during Codex verification.',
      '',
      `Task: ${runContext.taskDescription}`,
      `Workflow: ${runContext.workflow}`,
      `Read the phase handoff first: ${artifactRelativePath(runContext, phase.handoffFile)}`,
      ...previousOutputs,
      '- Make only targeted fixes for verification findings.',
      '- Re-run the focused checks affected by the repair.',
      '- Output a concise repair summary.',
    ].join('\n');
  }

  if (phase.name === 'review') {
    return [
      'You are reviewing a completed Codex workflow.',
      '',
      `Task: ${runContext.taskDescription}`,
      `Workflow: ${runContext.workflow}`,
      `Read the phase handoff first: ${artifactRelativePath(runContext, phase.handoffFile)}`,
      ...previousOutputs,
      '- Review for correctness, regression risk, and missing tests.',
      '- Output findings first, then a short closeout summary.',
    ].join('\n');
  }

  throw new Error(`unknown phase: ${phase.name}`);
}

function buildPhaseHandoff(phase, runContext) {
  const lines = [
    '# Phase Handoff',
    '',
    `Current Phase: ${phase.name}`,
    `Run ID: ${runContext.runId}`,
    `Run Metadata: ${artifactRelativePath(runContext, runContext.runFile)}`,
    '',
    'Artifacts:',
  ];

  for (const previousPhase of runContext.phases.slice(0, runContext.phases.indexOf(phase))) {
    lines.push(`- ${previousPhase.name} output: ${artifactRelativePath(runContext, previousPhase.stdoutFile)}`);
  }

  if (phase.name === 'implement') {
    lines.push('- Goal: implement the planned or inspected changes and write a concise summary.');
  } else if (phase.name === 'verify') {
    lines.push('- Goal: run focused validation and report exact results.');
  } else if (phase.name === 'repair') {
    lines.push('- Goal: repair only issues discovered by verification.');
  } else if (phase.name === 'review') {
    lines.push('- Goal: review the current workspace, findings first.');
  }

  return lines.join('\n');
}

function buildCheckpointArtifact(phase, runContext, checkpointOwner, restoreState) {
  const handoffBody = buildPhaseHandoff(phase, runContext)
    .replace(/^#\s+Phase Handoff\s*/u, '')
    .trim();

  const lines = [
    '# Checkpoint Resume',
    '',
    'X-Codex-Flow-Checkpoint: 1',
    `Owner: codex-flow/${runContext.runId}/${phase.name}/${checkpointOwner}`,
    `Restore-Mode: ${restoreState.mode}`,
  ];

  if (restoreState.mode === 'restore' && typeof restoreState.content === 'string') {
    lines.push(`Restore-Content-Base64: ${Buffer.from(restoreState.content, 'utf8').toString('base64')}`);
  }

  lines.push('', handoffBody);
  return lines.join('\n');
}

function writePhaseHandoffArtifacts(runContext, phase) {
  if (phase.name === 'plan') {
    return null;
  }

  writeTextFile(phase.handoffFile, buildPhaseHandoff(phase, runContext), {
    projectRoot: runContext.cwd,
  });

  const checkpointFilePath = getCheckpointFilePath(runContext.cwd);
  const checkpointOwner = crypto.randomUUID();
  const previousCheckpointContent = readTextFileIfPresent(runContext.cwd, checkpointFilePath, 'checkpoint file');
  const restoreState = deriveCheckpointRestoreState(previousCheckpointContent);
  const nextCheckpointContent = buildCheckpointArtifact(phase, runContext, checkpointOwner, restoreState);

  writeTextFile(checkpointFilePath, nextCheckpointContent, {
    projectRoot: runContext.cwd,
  });

  return {
    checkpointFilePath,
    restoreState,
    nextCheckpointContent,
    projectRoot: runContext.cwd,
  };
}

function isLauncherOwnedCheckpoint(content) {
  return typeof content === 'string'
    && /^X-Codex-Flow-Checkpoint: 1$/mu.test(content)
    && /^Owner: codex-flow\//mu.test(content);
}

function readLauncherCheckpointRestoreState(content) {
  if (!isLauncherOwnedCheckpoint(content)) {
    return null;
  }

  const restoreModeMatch = content.match(/^Restore-Mode: (delete|restore)$/mu);
  const restoreContentMatch = content.match(/^Restore-Content-Base64: ([A-Za-z0-9+/=]+)$/mu);

  if (!restoreModeMatch) {
    return { mode: 'delete', content: null };
  }

  if (restoreModeMatch[1] === 'restore' && restoreContentMatch) {
    return {
      mode: 'restore',
      content: Buffer.from(restoreContentMatch[1], 'base64').toString('utf8'),
    };
  }

  return { mode: 'delete', content: null };
}

function deriveCheckpointRestoreState(previousCheckpointContent) {
  if (previousCheckpointContent === null) {
    return { mode: 'delete', content: null };
  }

  const launcherRestoreState = readLauncherCheckpointRestoreState(previousCheckpointContent);
  if (launcherRestoreState) {
    return launcherRestoreState;
  }

  return {
    mode: 'restore',
    content: previousCheckpointContent,
  };
}

function cleanupTransientCheckpoint(checkpointState) {
  if (!checkpointState) {
    return;
  }

  try {
    const {
      checkpointFilePath,
      restoreState,
      nextCheckpointContent,
      projectRoot,
    } = checkpointState;
    const currentCheckpointContent = readTextFileIfPresent(projectRoot, checkpointFilePath, 'checkpoint file');

    if (currentCheckpointContent !== nextCheckpointContent) {
      return;
    }

    if (restoreState.mode === 'delete' || typeof restoreState.content !== 'string') {
      fs.rmSync(checkpointFilePath, { force: true });
      return;
    }

    writeTextFile(checkpointFilePath, restoreState.content, { projectRoot });
  } catch {
    // best-effort cleanup only
  }
}

function acquireRunLock(runContext, mode) {
  const lockFilePath = ensureWritableArtifactPath(runContext.cwd, getRunLockFilePath(runContext), 'run lock');
  const recoveryLockFilePath = ensureWritableArtifactPath(
    runContext.cwd,
    getRunLockRecoveryFilePath(runContext),
    'run lock recovery guard'
  );
  const lockContent = JSON.stringify({
    lockId: crypto.randomUUID(),
    runId: runContext.runId,
    pid: process.pid,
    mode,
    startedAt: new Date().toISOString(),
  }, null, 2);
  const tempLockFilePath = ensureWritableArtifactPath(
    runContext.cwd,
    path.join(path.dirname(lockFilePath), `.${path.basename(lockFilePath)}.${crypto.randomUUID()}.tmp`),
    'run lock temp file'
  );

  fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
  fs.writeFileSync(tempLockFilePath, lockContent, 'utf8');

  try {
    fs.linkSync(tempLockFilePath, lockFilePath);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      let recoveryGuardHandle = null;

      try {
        recoveryGuardHandle = fs.openSync(recoveryLockFilePath, 'wx');
      } catch (recoveryError) {
        if (recoveryError && recoveryError.code === 'EEXIST') {
          throw new Error(`run is already active: ${runContext.runId}`);
        }

        throw recoveryError;
      }

      try {
        if (!tryRecoverStaleRunLock(lockFilePath)) {
          throw new Error(`run is already active: ${runContext.runId}`);
        }

        fs.linkSync(tempLockFilePath, lockFilePath);
      } finally {
        if (recoveryGuardHandle !== null) {
          fs.closeSync(recoveryGuardHandle);
        }

        fs.rmSync(recoveryLockFilePath, { force: true });
      }
    } else {
      throw error;
    }
  } finally {
    fs.rmSync(tempLockFilePath, { force: true });
  }

  return {
    lockFilePath,
    lockContent,
  };
}

function releaseRunLock(lockState) {
  if (!lockState) {
    return;
  }

  try {
    if (!fs.existsSync(lockState.lockFilePath)) {
      return;
    }

    const currentLockContent = fs.readFileSync(lockState.lockFilePath, 'utf8');
    if (currentLockContent !== lockState.lockContent) {
      return;
    }

    fs.rmSync(lockState.lockFilePath, { force: true });
  } catch {
    // best-effort cleanup only
  }
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code !== 'ESRCH';
  }
}

function tryRecoverStaleRunLock(lockFilePath) {
  try {
    if (!fs.existsSync(lockFilePath)) {
      return false;
    }

    let lockData = null;

    try {
      lockData = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
    } catch {
      fs.rmSync(lockFilePath, { force: true });
      return true;
    }

    if (isProcessRunning(lockData.pid)) {
      return false;
    }

    fs.rmSync(lockFilePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function buildCodexArgs({ cwd, profile, taskFile }) {
  const args = [];

  if (profile) {
    args.push('-p', profile);
  }

  args.push('exec', '--cwd', cwd, '--task-file', taskFile);
  return args;
}

function normalizeCommandOutput(output) {
  if (output === undefined || output === null) {
    return '';
  }

  return typeof output === 'string' ? output : String(output);
}

function runPhase(runContext, phase, options = {}) {
  const execFileSyncFn = options.execFileSync || defaultExecFileSync;
  const codexBinary = options.codexBinary || 'codex';
  const prompt = buildPhasePrompt(phase, runContext);
  const args = buildCodexArgs({
    cwd: runContext.cwd,
    profile: phase.profile,
    taskFile: phase.taskFile,
  });
  let checkpointState = null;

  try {
    writeTextFile(phase.taskFile, prompt, { projectRoot: runContext.cwd });
    writeRunMetadata(runContext);
    checkpointState = writePhaseHandoffArtifacts(runContext, phase);
    phase.errorMessage = null;
    const stdout = normalizeCommandOutput(execFileSyncFn(codexBinary, args, {
      cwd: runContext.cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }));

    writeTextFile(phase.stdoutFile, stdout, { projectRoot: runContext.cwd });
    phase.status = 'completed';
    phase.errorMessage = null;
    writeRunMetadata(runContext);
    return stdout;
  } catch (error) {
    const stdout = normalizeCommandOutput(error.stdout);
    const stderr = normalizeCommandOutput(error.stderr);

    phase.status = 'failed';

    if (stdout) {
      writeTextFile(phase.stdoutFile, stdout, { projectRoot: runContext.cwd });
    }

    if (stderr) {
      writeTextFile(phase.stderrFile, stderr, { projectRoot: runContext.cwd });
    }

    if (error.code === 'ENOENT') {
      phase.errorMessage = `codex binary not found: ${codexBinary}`;
      writeRunMetadata(runContext);

      const missingBinaryError = new Error(phase.errorMessage);
      missingBinaryError.cause = error;
      throw missingBinaryError;
    }

    phase.errorMessage = `${phase.name} phase failed${stderr ? `: ${stderr.trim()}` : ''}`;
    writeRunMetadata(runContext);

    const phaseFailureError = new Error(phase.errorMessage);
    phaseFailureError.cause = error;
    throw phaseFailureError;
  } finally {
    cleanupTransientCheckpoint(checkpointState);
  }
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
}

function readLatestRunState(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const artifactBaseDir = resolveArtifactBaseDir(cwd, options.artifactRoot);
  const latestRunFile = path.join(artifactBaseDir, LATEST_RUN_FILE_NAME);

  if (!fs.existsSync(latestRunFile)) {
    throw new Error('latest run metadata not found');
  }

  ensureExistingPathChainResolvesInsideProjectRoot(cwd, latestRunFile, 'latest run metadata', {
    rejectLinks: true,
  });

  const latestRunMetadata = readJsonFile(latestRunFile, 'latest run metadata');
  const latestRunId = validateRunId(latestRunMetadata.runId);

  if (typeof latestRunMetadata.runFile !== 'string' || !latestRunMetadata.runFile.trim()) {
    throw new Error('latest run metadata is invalid: runFile is required');
  }

  const declaredRunFile = ensurePathInsideProjectRoot(cwd, latestRunMetadata.runFile, 'latest run file');
  const runFile = path.join(artifactBaseDir, latestRunId, 'run.json');

  if (path.resolve(declaredRunFile) !== path.resolve(runFile)) {
    throw new Error('latest run metadata is invalid: runFile must match runId');
  }

  ensureExistingPathChainResolvesInsideProjectRoot(cwd, runFile, 'latest run file', {
    rejectLinks: true,
  });

  if (!fs.existsSync(runFile)) {
    throw new Error(`latest run metadata points to a missing run file: ${runFile}`);
  }

  const runMetadata = readJsonFile(runFile, 'latest run file');
  if (typeof runMetadata.taskDescription !== 'string' || !Array.isArray(runMetadata.phases)) {
    throw new Error('latest run file is invalid: taskDescription and phases are required');
  }

  if (runMetadata.runId !== latestRunId) {
    throw new Error('latest run file is invalid: runId must match latest run metadata');
  }

  return {
    cwd,
    artifactBaseDir,
    latestRunFile,
    latestRunId,
    latestRunMetadata,
    runFile,
    runMetadata,
  };
}

function hydrateRunContext(runContext, runMetadata) {
  runContext.workflow = typeof runMetadata.workflow === 'string' && runMetadata.workflow
    ? normalizeWorkflowName(runMetadata.workflow)
    : runContext.workflow;
  runContext.createdAt = typeof runMetadata.createdAt === 'string' && runMetadata.createdAt
    ? runMetadata.createdAt
    : runContext.createdAt;

  runContext.phases.forEach((phase, index) => {
    const persistedPhase = runMetadata.phases[index];
    if (!persistedPhase || typeof persistedPhase !== 'object') {
      return;
    }

    if (typeof persistedPhase.status === 'string' && persistedPhase.status) {
      phase.status = persistedPhase.status;
    }

    if (typeof persistedPhase.errorMessage === 'string') {
      phase.errorMessage = persistedPhase.errorMessage;
    } else {
      phase.errorMessage = null;
    }
  });

  return runContext;
}

function buildFlowResult(runContext, reviewOutput = '') {
  return {
    runId: runContext.runId,
    runRoot: runContext.runRoot,
    workflow: runContext.workflow,
    reviewOutput,
    phases: runContext.phases.map((phase) => ({
      name: phase.name,
      profile: phase.profile,
      status: phase.status,
      taskFile: phase.taskFile,
      stdoutFile: phase.stdoutFile,
      stderrFile: phase.stderrFile,
    })),
  };
}

function resumeLatestRun(options = {}) {
  const latestRunState = readLatestRunState(options);
  const runContext = hydrateRunContext(
    buildRunContext(latestRunState.runMetadata.taskDescription, {
      cwd: latestRunState.cwd,
      artifactRoot: latestRunState.artifactBaseDir,
      runId: latestRunState.latestRunId,
      now: latestRunState.runMetadata.createdAt,
      workflow: latestRunState.runMetadata.workflow || 'default',
    }),
    latestRunState.runMetadata
  );
  const lockState = acquireRunLock(runContext, 'resume-latest');

  try {
    const startPhaseIndex = runContext.phases.findIndex((phase) => phase.status !== 'completed');
    let reviewOutput = '';

    if (startPhaseIndex === -1) {
      return buildFlowResult(runContext, reviewOutput);
    }

    for (const phase of runContext.phases.slice(startPhaseIndex)) {
      const phaseOutput = runPhase(runContext, phase, options);
      if (phase.name === 'review') {
        reviewOutput = phaseOutput;
      }
    }

    return buildFlowResult(runContext, reviewOutput);
  } finally {
    releaseRunLock(lockState);
  }
}

function reviewLatestRun(options = {}) {
  const latestRunState = readLatestRunState(options);
  const runContext = hydrateRunContext(
    buildRunContext(latestRunState.runMetadata.taskDescription, {
      cwd: latestRunState.cwd,
      artifactRoot: latestRunState.artifactBaseDir,
      runId: latestRunState.latestRunId,
      now: latestRunState.runMetadata.createdAt,
      workflow: latestRunState.runMetadata.workflow || 'default',
    }),
    latestRunState.runMetadata
  );
  const lockState = acquireRunLock(runContext, 'review-latest');

  try {
    const reviewPhaseIndex = runContext.phases.findIndex((phase) => phase.name === 'review');
    if (reviewPhaseIndex === -1) {
      throw new Error('latest run has no review phase');
    }

    if (runContext.phases.slice(0, reviewPhaseIndex).some((phase) => phase.status !== 'completed')) {
      throw new Error('latest run is not ready for review');
    }

    const reviewPhase = runContext.phases[reviewPhaseIndex];
    reviewPhase.status = 'pending';
    reviewPhase.errorMessage = null;
    const reviewOutput = runPhase(runContext, reviewPhase, options);

    return buildFlowResult(runContext, reviewOutput);
  } finally {
    releaseRunLock(lockState);
  }
}

function parseCliArgs(argv = process.argv) {
  const args = argv.slice(2);
  let workflow = 'default';

  if (args[0] === '--help' || args[0] === '-h') {
    return { mode: 'help', taskDescription: '', workflow };
  }

  if (args[0] === '--resume-latest') {
    if (args.length > 1) {
      throw new Error('--resume-latest does not accept a task description');
    }

    return { mode: 'resume-latest', taskDescription: '', workflow };
  }

  if (args[0] === '--review-latest') {
    if (args.length > 1) {
      throw new Error('--review-latest does not accept a task description');
    }

    return { mode: 'review-latest', taskDescription: '', workflow };
  }

  if (args[0] === '--workflow') {
    if (!args[1] || args[1].startsWith('-')) {
      throw new Error('--workflow requires a workflow name');
    }

    workflow = normalizeWorkflowName(args[1]);
    args.splice(0, 2);
  }

  if (typeof args[0] === 'string' && args[0].startsWith('-')) {
    throw new Error(`unknown option: ${args[0]}`);
  }

  const trailingOption = args.slice(1).find((arg) => typeof arg === 'string' && arg.startsWith('-'));
  if (trailingOption) {
    throw new Error(`unexpected option after task description: ${trailingOption}`);
  }

  return {
    mode: 'run',
    taskDescription: args.join(' ').trim(),
    workflow,
  };
}

function runFlow(taskDescription, options = {}) {
  const normalizedTaskDescription = typeof taskDescription === 'string'
    ? taskDescription.trim()
    : '';

  if (!normalizedTaskDescription) {
    throw new Error('task description is required');
  }

  const runContext = buildRunContext(normalizedTaskDescription, options);
  ensureRunRoot(runContext);
  const lockState = acquireRunLock(runContext, 'run');

  try {
    writeRunMetadata(runContext);
    writeLatestRunMetadata(runContext);

    let reviewOutput = '';

    for (const phase of runContext.phases) {
      const phaseOutput = runPhase(runContext, phase, options);
      if (phase.name === 'review') {
        reviewOutput = phaseOutput;
      }
    }

    return buildFlowResult(runContext, reviewOutput);
  } finally {
    releaseRunLock(lockState);
  }
}

function main(argv = process.argv, options = {}) {
  let parsedArgs = null;

  try {
    parsedArgs = parseCliArgs(argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    return 1;
  }

  if (parsedArgs.mode === 'run' && !parsedArgs.taskDescription) {
    printUsage();
    return 1;
  }

  if (parsedArgs.mode === 'help') {
    printUsage();
    return 0;
  }

  try {
    const result = parsedArgs.mode === 'resume-latest'
      ? resumeLatestRun(options)
      : parsedArgs.mode === 'review-latest'
        ? reviewLatestRun(options)
        : runFlow(parsedArgs.taskDescription, { ...options, workflow: parsedArgs.workflow });
    console.log(`Codex flow complete: ${result.runRoot}`);

    if (result.reviewOutput) {
      console.log(result.reviewOutput.trim());
    }

    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  buildCodexArgs,
  buildPhasePrompt,
  buildRunContext,
  generateRunId,
  getWorkflowPhaseDefinitions,
  main,
  normalizeWorkflowName,
  parseCliArgs,
  printUsage,
  readLatestRunState,
  resumeLatestRun,
  reviewLatestRun,
  runFlow,
};
