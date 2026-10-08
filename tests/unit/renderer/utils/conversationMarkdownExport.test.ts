/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import {
  buildConversationMarkdownTranscript,
  buildMarkdownExportFileName,
  type MarkdownTranscriptLabels,
} from '@/renderer/utils/chat/conversationExport';

const labels: MarkdownTranscriptLabels = {
  untitled: 'Untitled',
  exportedAt: 'Exported at',
  messageCount: 'Messages',
  noMessages: 'No messages',
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
};

const conversation = { id: 'conv-1234567890', name: 'Love test: plan/ideas?', type: 'dream' } as TChatConversation;

const at = (h: number, m: number) => new Date(2026, 9, 8, h, m).getTime();

const text = (id: string, position: 'left' | 'right', content: string, created_at: number, extra = {}) =>
  ({ id, type: 'text', position, conversation_id: 'conv-1', created_at, content: { content, ...extra } }) as TMessage;

describe('buildConversationMarkdownTranscript', () => {
  it('keeps only the conversation text, merges split replies and keeps Markdown unfenced', () => {
    const messages = [
      text('1', 'right', 'Build a love test site', at(9, 5)),
      { id: 't', type: 'tool_call', conversation_id: 'conv-1', content: { name: 'Write' } } as unknown as TMessage,
      { id: 'th', type: 'thinking', conversation_id: 'conv-1', content: { content: 'secret' } } as unknown as TMessage,
      text('2', 'left', '## Plan\n- step one', at(9, 6)),
      text('3', 'left', 'Done.', at(9, 8)),
      text('h', 'right', 'hidden instruction', at(9, 9), {}),
      text('4', 'right', '   ', at(9, 10)),
    ];
    (messages[5] as { hidden?: boolean }).hidden = true;

    const markdown = buildConversationMarkdownTranscript(conversation, messages, labels, at(10, 0));

    expect(markdown).toContain('# Love test: plan/ideas?');
    expect(markdown).toContain('> Exported at: 2026-10-08 10:00 · Messages: 3');
    expect(markdown).toContain('## User · 2026-10-08 09:05\n\nBuild a love test site');
    // Assistant text keeps its own Markdown structure instead of a code fence.
    expect(markdown).toContain('## Assistant · 2026-10-08 09:06\n\n## Plan\n- step one\n\nDone.');
    expect(markdown.match(/## Assistant/g)).toHaveLength(1);
    expect(markdown).not.toContain('secret');
    expect(markdown).not.toContain('hidden instruction');
    expect(markdown).not.toContain('```');
  });

  it('labels teammate messages with the teammate name', () => {
    const markdown = buildConversationMarkdownTranscript(
      conversation,
      [text('1', 'left', 'Report ready', at(9, 0), { senderName: 'Researcher' })],
      labels
    );
    expect(markdown).toContain('## Researcher · 2026-10-08 09:00');
  });

  it('writes an explicit empty marker and falls back to the untitled label', () => {
    const markdown = buildConversationMarkdownTranscript({ ...conversation, name: '' }, [], labels);
    expect(markdown).toContain('# Untitled');
    expect(markdown).toContain('No messages');
  });
});

describe('buildMarkdownExportFileName', () => {
  it('dates the file and strips characters Windows rejects', () => {
    expect(buildMarkdownExportFileName(conversation, at(9, 0))).toBe('2026-10-08-Love test_ plan_ideas_.md');
  });
});
