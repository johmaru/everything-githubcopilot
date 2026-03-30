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

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { emit, getContext, fileExists, readFile } = require('./_shared');
const db = require('./db');

const SESSIONS_DIR = path.join(process.cwd(), '.github', 'sessions');
const SUMMARY_FILE = path.join(SESSIONS_DIR, 'latest-summary.md');
const SESSION_ID_FILE = path.join(SESSIONS_DIR, '.current-session-id');

const context = getContext();

// Resolve session ID: payload > generate UUID, then persist for session-stop
const sessionId = (context.payload && context.payload.sessionId) || crypto.randomUUID();
try {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(SESSION_ID_FILE, sessionId, 'utf8');
} catch {
  // non-fatal — session-stop will generate its own UUID if needed
}

const parts = [];

// Ensure DB dependencies are installed (auto-install if missing)
db.ensureDependencies();

// Try SQLite first, fall back to markdown
const handle = db.open();

if (handle) {
  const projectId = db.detectProjectId(process.cwd());

  // Register this session
  db.upsertSession(handle, {
    id: sessionId,
    startedAt: new Date().toISOString(),
    projectId,
  });

  // Fetch recent session summaries (same project first)
  const recent = db.getRecentProjectSessions(handle, { projectId, limit: 3 });
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

  // ── Smart knowledge retrieval ──
  // 1. Collect search hints from environment: branch, cwd basename, recent files
  const searchHints = [];

  try {
    const branch = require('child_process')
      .execSync('git branch --show-current', { cwd: process.cwd(), timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      .trim();
    if (branch) searchHints.push(branch);
  } catch { /* not a git repo */ }

  const cwdBase = path.basename(process.cwd());
  if (cwdBase) searchHints.push(cwdBase);

  // Recent file paths from last session's session_files
  try {
    const recentFiles = handle.prepare(`
      SELECT DISTINCT sf.file_path FROM session_files sf
      INNER JOIN sessions s ON s.id = sf.session_id
      ORDER BY s.started_at DESC LIMIT 10
    `).all();
    for (const f of recentFiles) {
      const base = path.basename(f.file_path, path.extname(f.file_path));
      if (base && base.length > 2) searchHints.push(base);
    }
  } catch { /* non-fatal */ }

  // 2. Keyword-matched knowledge (branch, filenames, project name)
  const uniqueHints = [...new Set(searchHints)].slice(0, 8);
  let knowledge = [];

  if (uniqueHints.length > 0) {
    knowledge = db.searchKnowledgeByKeywords(handle, uniqueHints, { projectId, limit: 8 });
  }

  // 3. Fill remaining slots with project-scoped, confidence-filtered knowledge
  if (knowledge.length < 8) {
    const seenIds = new Set(knowledge.map((k) => k.id));
    const projectKnowledge = db.getProjectKnowledge(handle, {
      projectId,
      minConfidence: 0.4,
      limit: 8 - knowledge.length,
    });
    for (const k of projectKnowledge) {
      if (!seenIds.has(k.id)) {
        knowledge.push(k);
        seenIds.add(k.id);
      }
    }
  }

  if (knowledge.length > 0) {
    const knowledgeLines = knowledge.map((k) => {
      const conf = typeof k.confidence === 'number' ? ` [${Math.round(k.confidence * 100)}%]` : '';
      return `- **[${k.kind}]**${conf} ${k.content} _(${k.source})_`;
    });
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
