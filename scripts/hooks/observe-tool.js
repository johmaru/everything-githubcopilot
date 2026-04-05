#!/usr/bin/env node
'use strict';

/**
 * PostToolUse observation hook — records tool usage to SQLite for pattern analysis.
 *
 * Captures tool name, input, and output for each tool invocation.
 * This data feeds the automatic knowledge extraction in session-stop.js.
 *
 * Designed to be lightweight: no embedding, no analysis, just append.
 * Runs async so it does not block the user's workflow.
 *
 * Input (stdin JSON): { tool_name, tool_input, tool_response, session_id, cwd, ... }
 */

const fs = require('fs');
const path = require('path');
const { getContext } = require('./_shared');
const db = require('./db');

const SESSIONS_DIR = path.join(process.cwd(), '.github', 'sessions');
const SESSION_ID_FILE = path.join(SESSIONS_DIR, '.current-session-id');

function parseStructuredValue(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isTodoTool(toolName) {
  const normalized = String(toolName || '').trim().toLowerCase();
  return normalized === 'todo'
    || normalized === 'todo_write'
    || normalized === 'manage_todo_list';
}

function extractTaskList(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value.todoList)) {
    return value.todoList;
  }

  if (Array.isArray(value.todos)) {
    return value.todos;
  }

  if (Array.isArray(value.tasks)) {
    return value.tasks;
  }

  return [];
}

function extractTaskDescription(task) {
  const candidates = [task.title, task.description, task.content, task.text, task.name];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function extractTaskStatus(task) {
  const normalize = (value) => String(value || 'pending').trim().toLowerCase().replace(/[_\s]+/g, '-');

  if (typeof task.status === 'string' && task.status.trim()) {
    return normalize(task.status);
  }

  if (typeof task.state === 'string' && task.state.trim()) {
    return normalize(task.state);
  }

  if (task.completed === true || task.done === true) {
    return 'completed';
  }

  if (task.completed === false || task.done === false) {
    return 'pending';
  }

  return 'pending';
}

function extractTaskKey(task, description) {
  const buildDescriptionToken = () => {
    const slug = description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (slug) {
      return slug;
    }

    return Buffer.from(description, 'utf8').toString('hex').slice(0, 24);
  };

  if (task.id !== undefined && task.id !== null && String(task.id).trim()) {
    const key = String(task.id).trim();
    return /^\d+$/.test(key) ? `${key}:${buildDescriptionToken()}` : key;
  }

  if (task.key !== undefined && task.key !== null && String(task.key).trim()) {
    const key = String(task.key).trim();
    return /^\d+$/.test(key) ? `${key}:${buildDescriptionToken()}` : key;
  }

  return `task-${buildDescriptionToken()}`;
}

function extractTodoTasks(toolName, toolInput, toolOutput) {
  if (!isTodoTool(toolName)) {
    return [];
  }

  const inputValue = parseStructuredValue(toolInput);
  const outputValue = parseStructuredValue(toolOutput);
  const rawTasks = extractTaskList(inputValue).length > 0
    ? extractTaskList(inputValue)
    : extractTaskList(outputValue);

  return rawTasks
    .filter((task) => task && typeof task === 'object')
    .map((task) => {
      const description = extractTaskDescription(task);
      return {
        taskKey: extractTaskKey(task, description),
        description,
        status: extractTaskStatus(task),
      };
    })
    .filter((task) => task.description && task.taskKey);
}

// Read session ID from persisted file (written by session-start.js)
function readSessionId() {
  try {
    const id = fs.readFileSync(SESSION_ID_FILE, 'utf8').trim();
    return id || null;
  } catch {
    return null;
  }
}

const context = getContext();
const payload = context.payload || {};

// Extract tool info from Copilot's PostToolUse payload
const toolName = payload.tool_name || payload.toolName || payload.tool || '';
if (!toolName) {
  process.exit(0);
}

const toolInput = payload.tool_input || payload.input || '';
const toolOutput = payload.tool_response || payload.tool_output || payload.output || '';
const sessionId = payload.session_id || payload.sessionId || readSessionId();

// Skip if DB is not available (no-op, no install attempt in hot path)
if (!db.isAvailable()) {
  process.exit(0);
}

const handle = db.open();
if (!handle) {
  process.exit(0);
}

try {
  const projectId = db.detectProjectId(payload.cwd || process.cwd());
  const createdAt = new Date().toISOString();

  // Ensure the session exists before inserting observations.
  // Prevents orphaned observations when session-start failed or was skipped.
  if (sessionId) {
    const existing = handle.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
    if (!existing) {
      db.upsertSession(handle, {
        id: sessionId,
        startedAt: createdAt,
        projectId,
      });
    }
  }

  db.insertObservation(handle, {
    sessionId,
    projectId,
    toolName,
    toolInput: typeof toolInput === 'object' ? JSON.stringify(toolInput) : String(toolInput),
    toolOutput: typeof toolOutput === 'object' ? JSON.stringify(toolOutput) : String(toolOutput),
    eventType: 'tool_complete',
    createdAt,
  });

  const activeTasks = extractTodoTasks(toolName, toolInput, toolOutput);
  for (const task of activeTasks) {
    db.upsertPendingTask(handle, {
      sessionId,
      projectId,
      taskKey: task.taskKey,
      description: task.description,
      status: task.status,
      createdAt,
      updatedAt: createdAt,
    });
  }
} catch {
  // Observation is best-effort — never block the user
} finally {
  db.close();
}

process.exit(0);
