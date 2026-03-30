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

const MIN_OBSERVATIONS = 5; // don't analyze tiny sessions

/**
 * Analyze this session's observations and extract reusable patterns as knowledge entries.
 * Patterns detected:
 *   1. Error → fix sequences (tool output contains error, next tool fixes it)
 *   2. Repeated tool workflows (same tool sequence used 2+ times)
 *   3. Frequently edited files (hotspots)
 */
function extractKnowledgeFromObservations(handle, sid, pid) {
  const count = db.countSessionObservations(handle, sid);
  if (count < MIN_OBSERVATIONS) {
    return;
  }

  const obs = db.getSessionObservations(handle, sid, 500);
  const now = new Date().toISOString();
  const patterns = [];

  // ── Pattern 1: Error → Resolution ──
  for (let i = 0; i < obs.length - 1; i++) {
    const current = obs[i];
    const output = current.tool_output || '';
    if (!looksLikeError(output)) continue;

    // Look at up to 3 following observations for a fix
    for (let j = i + 1; j < Math.min(i + 4, obs.length); j++) {
      const next = obs[j];
      const nextOutput = next.tool_output || '';
      if (looksLikeSuccess(nextOutput)) {
        const errorSnippet = output.slice(0, 200).replace(/\n/g, ' ');
        const fixTool = next.tool_name;
        const fixInput = (next.tool_input || '').slice(0, 200).replace(/\n/g, ' ');
        patterns.push({
          kind: 'error_resolution',
          content: `Error in ${current.tool_name}: "${errorSnippet}" → Fixed with ${fixTool}: "${fixInput}"`,
          confidence: 0.4,
        });
        break;
      }
    }
  }

  // ── Pattern 2: Repeated tool sequences (length 2-3) ──
  const seqCounts = new Map();
  for (let len = 2; len <= 3; len++) {
    for (let i = 0; i <= obs.length - len; i++) {
      const seq = obs.slice(i, i + len).map((o) => o.tool_name).join(' → ');
      seqCounts.set(seq, (seqCounts.get(seq) || 0) + 1);
    }
  }
  for (const [seq, cnt] of seqCounts) {
    if (cnt >= 3) {
      patterns.push({
        kind: 'workflow',
        content: `Repeated workflow (${cnt}x): ${seq}`,
        confidence: Math.min(0.3 + cnt * 0.1, 0.8),
      });
    }
  }

  // ── Pattern 3: File hotspots (files edited 3+ times) ──
  const fileCounts = new Map();
  for (const o of obs) {
    if (!/Edit|Write|MultiEdit/i.test(o.tool_name)) continue;
    const input = o.tool_input || '';
    const match = input.match(/"(?:file_?path|path|target)"\s*:\s*"([^"]+)"/i);
    if (match) {
      const fp = match[1];
      fileCounts.set(fp, (fileCounts.get(fp) || 0) + 1);
    }
  }
  for (const [fp, cnt] of fileCounts) {
    if (cnt >= 3) {
      patterns.push({
        kind: 'hotspot',
        content: `File hotspot: ${fp} was edited ${cnt} times in this session`,
        confidence: 0.3,
      });
    }
  }

  // Deduplicate against existing knowledge (exact content match)
  for (const p of patterns) {
    const existing = db.searchKnowledgeByKeyword(handle, p.content.slice(0, 60), 1);
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

function looksLikeError(text) {
  if (!text) return false;
  return /\b(error|Error|ERR|FAIL|failed|exception|TypeError|ReferenceError|SyntaxError|Cannot find|not found|ENOENT|EACCES|denied|rejected|panic|fatal)\b/.test(text);
}

function looksLikeSuccess(text) {
  if (!text) return false;
  return /\b(success|passed|ok|created|updated|written|done|✓|completed)\b/i.test(text)
    && !looksLikeError(text);
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
