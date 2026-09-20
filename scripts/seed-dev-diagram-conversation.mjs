#!/usr/bin/env bun
/**
 * Dev-only: upsert CDP-Diagram-Acceptance conversation with assistant-side markdown diagrams.
 * Prints conversation id to stdout.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';

const CONV_MARKER = 'CDP-Diagram-Acceptance (dev)';
const USERDATA_SUBDIR = '1one';
const preferredId = process.env.DREAM_CDP_CONVERSATION_ID || null;

const DIAGRAM_CONTENT = [
  '# CDP acceptance (dev)',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Chat UI] --> B[Pan/Zoom]',
  '```',
  '',
  '```wavedrom',
  '{ "signal": [ { "name": "clk", "wave": "p....." } ] }',
  '```',
].join('\n');

function randomHexId() {
  return crypto.randomBytes(4).toString('hex');
}

function resolveDevDbPath() {
  const override = process.env.DREAM_DEV_USERDATA;
  if (override) {
    return path.join(override, USERDATA_SUBDIR, 'one-backend.db');
  }
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'dream-ui-Dev', USERDATA_SUBDIR, 'one-backend.db');
}

const dbPath = resolveDevDbPath();
if (!fs.existsSync(dbPath)) {
  console.error(`[seed-dev-diagram] missing db: ${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath);
try {
  const latestUser = db.query('SELECT user_id FROM conversations ORDER BY updated_at DESC LIMIT 1').get()?.user_id;
  const userId = latestUser || 'system_default_user';
  const now = Date.now();

  let conversationId = preferredId;
  if (conversationId) {
    const row = db.query('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
    if (!row) conversationId = null;
  }

  if (!conversationId) {
    const byName = db
      .query('SELECT id FROM conversations WHERE user_id = ? AND name = ? ORDER BY updated_at DESC LIMIT 1')
      .get(userId, CONV_MARKER);
    conversationId = byName?.id ?? null;
  }

  if (!conversationId) {
    conversationId = randomHexId();
    db.run(
      `INSERT INTO conversations (id, user_id, name, type, extra, status, created_at, updated_at)
       VALUES (?, ?, ?, 'dream', '{}', 'finished', ?, ?)`,
      conversationId,
      userId,
      CONV_MARKER,
      now,
      now
    );
  } else {
    db.run('UPDATE conversations SET updated_at = ?, status = ? WHERE id = ?', now, 'finished', conversationId);
  }

  const hasLeftDiagram = db
    .query(
      `SELECT id FROM messages
       WHERE conversation_id = ? AND position = 'left' AND type = 'text' AND content LIKE '%mermaid%' AND content LIKE '%wavedrom%'
       LIMIT 1`
    )
    .get(conversationId);

  if (!hasLeftDiagram) {
    const messageId = randomHexId();
    const content = JSON.stringify({ content: DIAGRAM_CONTENT });
    db.run(
      `INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, hidden, created_at)
       VALUES (?, ?, ?, 'text', ?, 'left', 'finish', 0, ?)`,
      messageId,
      conversationId,
      messageId,
      content,
      now
    );
  }

  process.stdout.write(conversationId);
} finally {
  db.close();
}
