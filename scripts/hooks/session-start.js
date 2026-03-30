#!/usr/bin/env node
'use strict';

/**
 * SessionStart hook — inject prior session context into a new Copilot session.
 *
 * Queries SQLite for recent session summaries and pending tasks.
 * Falls back to `.github/sessions/latest-summary.md` when the DB is unavailable.
 *
 * Input (stdin JSON): { sessionId, timestamp, cwd, hookEventName, transcript_path }
 * Output (stdout JSON): { hookSpecificOutput: { additionalContext: "..." } }
 */

const path = require('path');
const { emit, getContext, fileExists, readFile } = require('./_shared');
const db = require('./db');

const SESSIONS_DIR = path.join(process.cwd(), '.github', 'sessions');
const SUMMARY_FILE = path.join(SESSIONS_DIR, 'latest-summary.md');

const context = getContext();
const sessionId = context.payload && context.payload.sessionId;

const parts = [];

// Ensure DB dependencies are installed (auto-install if missing)
db.ensureDependencies();

// Try SQLite first, fall back to markdown
const handle = db.open();

if (handle) {
  // Register this session
  if (sessionId) {
    db.upsertSession(handle, {
      id: sessionId,
      startedAt: new Date().toISOString(),
    });
  }

  // Fetch recent session summaries
  const recent = db.getRecentSessions(handle, 3);
  if (recent.length > 0) {
    const summaryLines = recent.map((s) => {
      const branch = s.branch ? ` (branch: ${s.branch})` : '';
      return `### ${s.ended_at || s.started_at}${branch}\n\n${s.summary}`;
    });
    parts.push(`## Prior Session Summaries\n\n${summaryLines.join('\n\n---\n\n')}`);
  }

  // Fetch pending tasks
  const tasks = db.getPendingTasks(handle);
  if (tasks.length > 0) {
    const taskLines = tasks.map((t) => `- [ ] ${t.description}`);
    parts.push(`## Pending Tasks\n\n${taskLines.join('\n')}`);
  }

  // Inject relevant knowledge entries (keyword search — no embedding in hooks)
  const knowledge = db.getAllKnowledge(handle, 10);
  if (knowledge.length > 0) {
    const knowledgeLines = knowledge.map(
      (k) => `- **[${k.kind}]** ${k.content} _(${k.source})_`
    );
    parts.push(`## Accumulated Knowledge\n\n${knowledgeLines.join('\n')}`);
  }

  db.close();
} else if (fileExists(SUMMARY_FILE)) {
  // Markdown fallback
  const summary = readFile(SUMMARY_FILE);
  if (summary && summary.trim()) {
    parts.push(`## Prior Session Summary\n\n${summary.trim()}`);
  }
}

if (parts.length === 0) {
  process.exit(0);
}

const output = {
  hookSpecificOutput: {
    additionalContext: parts.join('\n\n'),
  },
};

emit(JSON.stringify(output));
process.exit(0);
