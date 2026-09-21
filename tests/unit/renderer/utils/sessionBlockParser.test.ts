/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseSessionDeliveryBlock,
  SESSION_MESSAGE_MARKER,
  SESSIONS_MARKER,
  SESSION_SHARE_MARKER,
} from '@/renderer/utils/chat/sessionBlockParser';

const inboundPayload = {
  from_conversation_id: 'conv_a',
  from_title: 'A 会话',
  same_workspace: false,
  from_workspace: 'C:/ws-a',
  to_workspace: 'C:/ws-b',
  body: 'deliver this',
  reply_requested: false,
};

const sessionsPayload = {
  targets: [{ id: 'conv_b', title: 'B 会话', workspace: 'C:/ws-b' }],
  from_workspace: 'C:/ws-a',
  body: 'deliver this',
  reply_requested: false,
};

describe('parseSessionDeliveryBlock', () => {
  it('parses an inbound block that starts at the marker with empty head', () => {
    const parsed = parseSessionDeliveryBlock(`${SESSION_MESSAGE_MARKER}\n${JSON.stringify(inboundPayload)}`);
    expect(parsed).not.toBeNull();
    expect(parsed?.marker).toBe(SESSION_MESSAGE_MARKER);
    expect(parsed?.head).toBe('');
    if (parsed?.marker === SESSION_MESSAGE_MARKER) {
      expect(parsed.payload.from_title).toBe('A 会话');
      expect(parsed.payload.same_workspace).toBe(false);
      expect(parsed.payload.reply_to_conversation_id).toBeUndefined();
    }
  });

  it('parses an outbound block after user text and keeps the head', () => {
    const content = `看看这个 @@conv:conv_b\n\n${SESSIONS_MARKER}\n${JSON.stringify(sessionsPayload)}`;
    const parsed = parseSessionDeliveryBlock(content);
    expect(parsed?.marker).toBe(SESSIONS_MARKER);
    expect(parsed?.head).toBe('看看这个 @@conv:conv_b');
    if (parsed?.marker === SESSIONS_MARKER) {
      expect(parsed.payload.targets[0]?.title).toBe('B 会话');
    }
  });

  it('keeps the reply address on the inbound payload when reply_requested', () => {
    const payload = { ...inboundPayload, reply_requested: true, reply_to_conversation_id: 'conv_a' };
    const parsed = parseSessionDeliveryBlock(`${SESSION_MESSAGE_MARKER}\n${JSON.stringify(payload)}`);
    if (parsed?.marker === SESSION_MESSAGE_MARKER) {
      expect(parsed.payload.reply_to_conversation_id).toBe('conv_a');
    } else {
      expect.unreachable();
    }
  });

  it('returns null for ordinary text', () => {
    expect(parseSessionDeliveryBlock('普通消息，没有块')).toBeNull();
    expect(parseSessionDeliveryBlock('')).toBeNull();
  });

  it('returns null when the marker exists but the payload is not valid JSON', () => {
    expect(parseSessionDeliveryBlock(`${SESSION_MESSAGE_MARKER}\n{broken`)).toBeNull();
  });

  it('returns null when required payload fields are missing (forged marker)', () => {
    expect(parseSessionDeliveryBlock(`${SESSION_MESSAGE_MARKER}\n{"evil":true}`)).toBeNull();
    expect(
      parseSessionDeliveryBlock(`${SESSIONS_MARKER}\n{"targets":[],"body":"x","reply_requested":false}`)
    ).toBeNull();
  });

  it('does not match a marker that is not on its own line', () => {
    const content = `前缀 ${SESSION_MESSAGE_MARKER} ${JSON.stringify(inboundPayload)}`;
    expect(parseSessionDeliveryBlock(content)).toBeNull();
  });
});

describe('SESSION_SHARE personal share block', () => {
  const sharePayload = {
    name: 'A 会话',
    sharedAt: 1700000000000,
    messages: [
      { type: 'text', content: JSON.stringify({ content: 'hello' }), position: 'right', createdAt: 1 },
      { type: 'text', content: JSON.stringify({ content: 'hi' }), position: 'left', createdAt: 2 },
    ],
  };

  it('parses a personal share block and validates required fields', () => {
    const parsed = parseSessionDeliveryBlock(`${SESSION_SHARE_MARKER}
${JSON.stringify(sharePayload)}`);
    expect(parsed?.marker).toBe(SESSION_SHARE_MARKER);
    if (parsed?.marker === SESSION_SHARE_MARKER) {
      expect(parsed.payload.name).toBe('A 会话');
      expect(parsed.payload.messages.length).toBe(2);
    }
  });

  it('rejects a share block with no messages array', () => {
    expect(
      parseSessionDeliveryBlock(`${SESSION_SHARE_MARKER}
{"name":"x"}`)
    ).toBeNull();
  });
});
