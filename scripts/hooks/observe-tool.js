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

  // Ensure the session exists before inserting observations.
  // Prevents orphaned observations when session-start failed or was skipped.
  if (sessionId) {
    const existing = handle.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
    if (!existing) {
      db.upsertSession(handle, {
        id: sessionId,
        startedAt: new Date().toISOString(),
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
    createdAt: new Date().toISOString(),
  });
} catch {
  // Observation is best-effort — never block the user
} finally {
  db.close();
}

process.exit(0);
