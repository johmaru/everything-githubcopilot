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

const fs = require('fs');
const path = require('path');
const { getContext, emit } = require('./_shared');
const db = require('./db');

const SESSIONS_DIR = path.join(process.cwd(), '.github', 'sessions');
const SUMMARY_FILE = path.join(SESSIONS_DIR, 'latest-summary.md');
const MAX_TRANSCRIPT_BYTES = 64 * 1024; // read at most 64 KB of transcript

const context = getContext();
const payload = context.payload || {};
const sessionId = payload.sessionId || 'unknown';
const timestamp = payload.timestamp || new Date().toISOString();
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

if (handle) {
  try {
    db.upsertSession(handle, {
      id: sessionId,
      endedAt: timestamp,
      summary: summaryText,
      transcriptTail: transcriptTail.slice(-8192), // keep last 8KB in DB
    });

    if (modifiedFiles.length > 0) {
      const fileRecords = modifiedFiles.map((fp) => ({
        filePath: fp,
        action: 'modified',
      }));
      db.insertSessionFiles(handle, sessionId, fileRecords);
    }
  } catch (err) {
    emit(`session-stop: SQLite write failed: ${err.message}`, 'stderr');
  } finally {
    db.close();
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
