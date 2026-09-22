/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildSessionConvInsertion,
  getActiveSessionAtQuery,
  resolveSessionAtMenuKey,
} from '@/renderer/utils/chat/sessionAtQuery';

describe('getActiveSessionAtQuery', () => {
  it('detects @@ query at caret', () => {
    const value = 'hello @@conv:abc rest';
    const query = getActiveSessionAtQuery(value, 15);
    expect(query?.start).toBe(6);
    expect(query?.token).toBe('@@conv:abc');
    expect(query?.query).toBe('conv:abc');
  });

  it('returns null when caret is outside token', () => {
    expect(getActiveSessionAtQuery('@@conv:abc', 0)).toBeNull();
  });
});

describe('buildSessionConvInsertion', () => {
  it('builds conv token', () => {
    expect(buildSessionConvInsertion('sess-1')).toBe('@@conv:sess-1');
  });
});

describe('resolveSessionAtMenuKey', () => {
  it('maps navigation keys when items exist', () => {
    expect(resolveSessionAtMenuKey('ArrowDown', true)).toBe('down');
    expect(resolveSessionAtMenuKey('Enter', true)).toBe('accept');
    expect(resolveSessionAtMenuKey('Escape', false)).toBe('dismiss');
  });
});
