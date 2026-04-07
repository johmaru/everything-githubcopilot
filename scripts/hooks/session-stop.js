#!/usr/bin/env node
'use strict';

/**
 * Stop hook — persist a session summary for cross-session continuity.
 *
 * Reads the transcript tail, extracts key facts, and stores them in SQLite.
 * Falls back to `.github/sessions/latest-summary.md` when the DB is unavailable.
 *
 * Input (stdin JSON): { sessionId, timestamp, cwd, hookEventName, transcript_path, stop_hook_active }
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getContext, emit } = require('./_shared');
const db = require('./db');
const { MIN_OBSERVATIONS, extractObservationPatterns } = require('./session-stop-knowledge');

const SESSIONS_DIR = path.join(process.cwd(), '.github', 'sessions');
const SUMMARY_FILE = path.join(SESSIONS_DIR, 'latest-summary.md');
const SESSION_ID_FILE = path.join(SESSIONS_DIR, '.current-session-id');
const MAX_TRANSCRIPT_BYTES = 64 * 1024; // read at most 64 KB of transcript

const context = getContext();
const payload = context.payload || {};
const timestamp = payload.timestamp || new Date().toISOString();

// Resolve session ID: payload > persisted file from session-start > generate UUID
function resolveSessionId() {
  if (payload.sessionId) {
    return payload.sessionId;
  }
  try {
    const persisted = fs.readFileSync(SESSION_ID_FILE, 'utf8').trim();
    if (persisted) {
      return persisted;
    }
  } catch {
    // file doesn't exist — generate a new one
  }
  return crypto.randomUUID();
}

const sessionId = resolveSessionId();
const transcriptPath = payload.transcript_path || null;

// Read transcript tail for summary extraction
let transcriptTail = '';
if (transcriptPath) {
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.isFile()) {
      const start = Math.max(0, stat.size - MAX_TRANSCRIPT_BYTES);
      const fd = fs.openSync(transcriptPath, 'r');
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_TRANSCRIPT_BYTES));
      fs.readSync(fd, buffer, 0, buffer.length, start);
      fs.closeSync(fd);
      transcriptTail = buffer.toString('utf8');
    }
  } catch {
    // transcript may not exist or be inaccessible — not fatal
  }
}

// Extract assistant messages
const assistantBlocks = transcriptTail
  ? transcriptTail
      .split(/\n(?=assistant:)/i)
      .filter((block) => /^assistant:/i.test(block))
      .slice(-3)
      .map((block) => block.slice(0, 500).trim())
  : [];

// Extract file paths mentioned in transcript (heuristic)
const filePatterns = transcriptTail.matchAll(
  /(?:created?|modif(?:y|ied)|edited?|updated?|deleted?|wrote)\s+[`']?([^\s`']+\.\w{1,10})[`']?/gi
);
const modifiedFiles = [...new Set([...filePatterns].map((m) => m[1]))].slice(0, 50);

// Build summary text
const summaryLines = [
  `- **Session ID**: ${sessionId}`,
  `- **Ended**: ${timestamp}`,
  `- **Working Directory**: ${payload.cwd || process.cwd()}`,
];

if (assistantBlocks.length > 0) {
  summaryLines.push('', '### Last Actions', '');
  for (const block of assistantBlocks) {
    summaryLines.push(`> ${block.replace(/\n/g, '\n> ')}`, '');
  }
}

const summaryText = summaryLines.join('\n');

// Persist to SQLite
const handle = db.open();
const projectId = handle ? db.detectProjectId(payload.cwd || process.cwd()) : null;

if (handle) {
  try {
    db.upsertSession(handle, {
      id: sessionId,
      startedAt: timestamp,
      endedAt: timestamp,
      summary: summaryText,
      transcriptTail: transcriptTail.slice(-8192), // keep last 8KB in DB
      projectId,
    });

    if (modifiedFiles.length > 0) {
      const fileRecords = modifiedFiles.map((fp) => ({
        filePath: fp,
        action: 'modified',
      }));
      db.insertSessionFiles(handle, sessionId, fileRecords);
    }

    // ── Auto-extract knowledge from observations ──
    extractKnowledgeFromObservations(handle, sessionId, projectId);

    // Adopt orphaned observations (session_id not in sessions table)
    try {
      handle.prepare(`
        UPDATE observations SET session_id = ?
        WHERE session_id NOT IN (SELECT id FROM sessions)
      `).run(sessionId);
    } catch {
      // non-fatal
    }

    // Prune observations older than 30 days
    db.pruneOldObservations(handle, 30);
  } catch (err) {
    emit(`session-stop: SQLite write failed: ${err.message}`, 'stderr');
  } finally {
    db.close();
  }
}

// ─────────────────────────────────────────────
// Automatic knowledge extraction from observations
// ─────────────────────────────────────────────

/**
 * Analyze this session's observations and extract reusable patterns as knowledge entries.
 * Patterns detected:
 *   1. Error → fix sequences (tool output contains error, next tool fixes it)
 *   2. Repeated tool workflows (same tool sequence used 2+ times)
 *   3. Successful static usage search workflows for dependency tracing
 *   4. Frequently edited files (hotspots)
 */
function extractKnowledgeFromObservations(handle, sid, pid) {
  const count = db.countSessionObservations(handle, sid);
  if (count < MIN_OBSERVATIONS) {
    return;
  }

  const obs = db.getSessionObservations(handle, sid, 500);
  const now = new Date().toISOString();
  const patterns = extractObservationPatterns(obs);

  // Deduplicate against existing knowledge (exact content match)
  for (const p of patterns) {
    const existing = db
      .searchKnowledgeByKeyword(handle, p.content.slice(0, 60), 10, { projectId: pid })
      .filter((entry) => entry.project_id === pid && entry.content === p.content);
    if (existing.length > 0) continue;

    db.insertKnowledge(handle, {
      source: 'auto-observation',
      kind: p.kind,
      content: p.content,
      createdAt: now,
      sessionId: sid,
      projectId: pid,
      confidence: p.confidence,
      embedding: null, // embedding done async in learn-embed.js if desired
    });
  }
}

// Always write markdown fallback as well
try {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(
    SUMMARY_FILE,
    `# Session Summary\n\n${summaryText}\n`,
    'utf8'
  );
} catch (err) {
  emit(`session-stop: failed to write summary: ${err.message}`, 'stderr');
}

process.exit(0);
