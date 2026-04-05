#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const db = require('./db');

const DEFAULT_EVAL_CASES_PATH = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'verification', 'eval-cases.json');
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const TODO_TOOL_NAME = 'manage_todo_list';
const PROJECT_ID = 'proj-verification-eval';
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    branch TEXT,
    summary TEXT,
    transcript_tail TEXT,
    project_id TEXT
  );

  CREATE TABLE IF NOT EXISTS pending_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    project_id TEXT,
    task_key TEXT,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    project_id TEXT,
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    tool_output TEXT,
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pending_status
    ON pending_tasks(status, updated_at DESC, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_pending_project_status
    ON pending_tasks(project_id, status, updated_at DESC, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_observations_session
    ON observations(session_id, created_at DESC);
`;

function createInMemoryDb() {
  const Database = require('better-sqlite3');
  const handle = new Database(':memory:');
  handle.exec(SCHEMA_SQL);
  return handle;
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function buildCaseState(testCase, index) {
  const sessionId = testCase.sessionId || `verification-eval-${index + 1}`;
  const session = testCase.session || {};
  const baseTime = `2026-04-05T10:${String(index).padStart(2, '0')}:00Z`;

  return {
    sessionId,
    startedAt: session.startedAt || baseTime,
    todoTool: session.todoTool || null,
    tasks: Array.isArray(session.tasks) ? session.tasks : [],
    otherSessions: Array.isArray(session.otherSessions) ? session.otherSessions : [],
  };
}

function seedSession(handle, testCase, index) {
  const state = buildCaseState(testCase, index);

  db.upsertSession(handle, {
    id: state.sessionId,
    startedAt: state.startedAt,
    projectId: PROJECT_ID,
  });

  if (state.todoTool) {
    db.insertObservation(handle, {
      sessionId: state.sessionId,
      projectId: PROJECT_ID,
      toolName: state.todoTool || TODO_TOOL_NAME,
      toolInput: '{}',
      toolOutput: '{}',
      eventType: 'tool_complete',
      createdAt: state.startedAt,
    });
  }

  state.tasks.forEach((task, taskIndex) => {
    const createdAt = task.createdAt || `2026-04-05T10:${String(index).padStart(2, '0')}:${String(taskIndex).padStart(2, '0')}Z`;
    const updatedAt = task.updatedAt || createdAt;
    db.upsertPendingTask(handle, {
      sessionId: state.sessionId,
      projectId: PROJECT_ID,
      taskKey: task.taskKey || `${state.sessionId}-task-${taskIndex + 1}`,
      description: task.description || `Task ${taskIndex + 1}`,
      status: task.status || 'pending',
      createdAt,
      updatedAt,
    });
  });

  state.otherSessions.forEach((otherSession, otherIndex) => {
    const otherSessionId = otherSession.sessionId || `${state.sessionId}-other-${otherIndex + 1}`;
    const otherStartedAt = otherSession.startedAt || `2026-04-05T11:${String(index).padStart(2, '0')}:${String(otherIndex).padStart(2, '0')}Z`;

    db.upsertSession(handle, {
      id: otherSessionId,
      startedAt: otherStartedAt,
      projectId: PROJECT_ID,
    });

    (otherSession.tasks || []).forEach((task, taskIndex) => {
      const createdAt = task.createdAt || `2026-04-05T11:${String(index).padStart(2, '0')}:${String(taskIndex + 10).padStart(2, '0')}Z`;
      const updatedAt = task.updatedAt || createdAt;
      db.upsertPendingTask(handle, {
        sessionId: otherSessionId,
        projectId: PROJECT_ID,
        taskKey: task.taskKey || `${otherSessionId}-task-${taskIndex + 1}`,
        description: task.description || `Other task ${taskIndex + 1}`,
        status: task.status || 'pending',
        createdAt,
        updatedAt,
      });
    });
  });

  return state.sessionId;
}

function matchesExpectedState(actualState, expectedState = {}) {
  if (expectedState.status !== undefined && actualState.status !== expectedState.status) {
    return false;
  }

  if (expectedState.incompleteCount !== undefined && actualState.incompleteCount !== expectedState.incompleteCount) {
    return false;
  }

  if (expectedState.blockReason !== undefined && actualState.blockReason !== expectedState.blockReason) {
    return false;
  }

  if (expectedState.todoToolUsed !== undefined && actualState.todoToolUsed !== expectedState.todoToolUsed) {
    return false;
  }

  return true;
}

function evaluateVerificationCases(cases) {
  const evaluatedCases = (cases || []).map((testCase, index) => {
    const handle = createInMemoryDb();

    try {
      const sessionId = seedSession(handle, testCase, index);
      const actualState = db.getVerificationCompletionState(handle, { sessionId });
      const hit = matchesExpectedState(actualState, testCase.expected || {});

      return {
        name: testCase.name || null,
        hit,
        expected: testCase.expected || {},
        actualState,
      };
    } finally {
      handle.close();
    }
  });

  const hits = evaluatedCases.filter((testCase) => testCase.hit).length;
  const total = evaluatedCases.length;

  return {
    total,
    hits,
    missCount: total - hits,
    hitRate: total === 0 ? 0 : hits / total,
    cases: evaluatedCases,
  };
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'eval',
    root: DEFAULT_ROOT,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--cases') {
      args.casesFile = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg === '--root') {
      args.root = path.resolve(next);
      index += 1;
    }
  }

  return args;
}

function runCli(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.command !== 'eval') {
    throw new Error(`Unsupported command: ${args.command}`);
  }

  const casesPath = args.casesFile || DEFAULT_EVAL_CASES_PATH;
  const cases = JSON.parse(readUtf8(casesPath));
  const report = evaluateVerificationCases(cases);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

module.exports = {
  evaluateVerificationCases,
  matchesExpectedState,
  runCli,
};

if (require.main === module) {
  process.exitCode = runCli(process.argv);
}
