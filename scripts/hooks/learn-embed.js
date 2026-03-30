#!/usr/bin/env node
'use strict';

const db = require('./db');
const embedding = require('./embedding');

function parseArgs(argv) {
  const args = {};
  const raw = argv.slice(2);

  for (let i = 0; i < raw.length; i++) {
    const key = raw[i];
    const next = raw[i + 1];

    switch (key) {
      case '--source':
        args.source = next;
        i++;
        break;
      case '--kind':
        args.kind = next;
        i++;
        break;
      case '--content':
        args.content = next;
        i++;
        break;
      case '--session-id':
        args.sessionId = next;
        i++;
        break;
      case '--search':
        args.search = next;
        i++;
        break;
      case '--limit':
        args.limit = parseInt(next, 10) || 5;
        i++;
        break;
      default:
        break;
    }
  }

  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('').trim()));
    process.stdin.on('error', reject);
  });
}

async function runStore(args) {
  const content = args.content || (await readStdin());

  if (!content) {
    process.stderr.write('Error: --content is required (or pipe via stdin)\n');
    process.exit(1);
  }

  if (!args.source) {
    process.stderr.write('Error: --source is required\n');
    process.exit(1);
  }

  const handle = db.open();
  if (!handle) {
    process.stderr.write('Error: database is not available (better-sqlite3 not installed)\n');
    process.exit(1);
  }

  try {
    let vec = null;
    let embedded = false;

    try {
      vec = await embedding.embed(content);
      embedded = vec !== null;
    } catch {
      // Embedding failed — store without vector
    }

    const id = db.insertKnowledge(handle, {
      source: args.source,
      kind: args.kind || 'pattern',
      content,
      createdAt: new Date().toISOString(),
      sessionId: args.sessionId || null,
      embedding: vec,
    });

    process.stdout.write(JSON.stringify({ id, embedded }) + '\n');
  } finally {
    db.close();
  }
}

async function runSearch(args) {
  const query = args.search;
  const limit = args.limit || 5;

  const handle = db.open();
  if (!handle) {
    process.stderr.write('Error: database is not available (better-sqlite3 not installed)\n');
    process.exit(1);
  }

  try {
    let results = [];

    if (db.isVecAvailable()) {
      const vec = await embedding.embed(query);
      if (vec) {
        results = db.searchKnowledge(handle, vec, limit);
      }
    }

    // Fall back to keyword search if vector search returned nothing
    if (results.length === 0) {
      results = db.searchKnowledgeByKeyword(handle, query, limit);
    }

    process.stdout.write(JSON.stringify(results) + '\n');
  } finally {
    db.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.search) {
    await runSearch(args);
  } else {
    await runStore(args);
  }
}

main().catch((err) => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
