/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import { groupConversationsByRecency } from '@/renderer/pages/conversation/GroupedHistory/utils/recencyGrouping';

// Fixed "now" so month/year boundary math is deterministic across test runs.
const NOW = new Date(2026, 7, 12, 12, 0, 0).getTime(); // 2026-08-12 12:00

const conversation = (id: string, modified_at: number): TChatConversation =>
  ({
    id,
    name: id,
    type: 'acp',
    created_at: modified_at,
    modified_at,
    extra: { backend: 'aioncore' },
  }) as TChatConversation;

describe('groupConversationsByRecency', () => {
  it('puts everything in the recent bucket when there are fewer than recentCount conversations', () => {
    const conversations = [
      conversation('a', NOW),
      conversation('b', NOW - 1000),
      conversation('c', new Date(2020, 0, 1).getTime()), // very old, but still under the cap
    ];

    const buckets = groupConversationsByRecency(conversations, 'en-US', NOW, 10);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ kind: 'recent' });
    expect(buckets[0].conversations.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('caps the recent bucket by count, not by age — the 11th most-recent conversation is bucketed even if it is only a day old', () => {
    // 11 conversations, each a minute apart, all "today" — none would land in
    // an older tier by age alone.
    const conversations = Array.from({ length: 11 }, (_, i) => conversation(`c${i}`, NOW - i * 60_000));

    const buckets = groupConversationsByRecency(conversations, 'en-US', NOW, 10);

    expect(buckets[0].kind).toBe('recent');
    expect(buckets[0].conversations).toHaveLength(10);
    expect(buckets[0].conversations.map((c) => c.id)).toEqual([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
      'c8',
      'c9',
    ]);

    // The 11th (oldest) conversation falls outside the recent cap and is
    // still same-day, so it lands in a day bucket rather than being dropped.
    expect(buckets).toHaveLength(2);
    expect(buckets[1]).toMatchObject({ kind: 'day' });
    expect(buckets[1].conversations.map((c) => c.id)).toEqual(['c10']);
  });

  it('buckets by exact calendar day for conversations under a month old', () => {
    const conversations = [
      // 10 recent fillers so the ones below fall past the recent cap.
      ...Array.from({ length: 10 }, (_, i) => conversation(`filler${i}`, NOW - i * 1000)),
      conversation('yesterday-1', new Date(2026, 7, 11, 9, 0).getTime()),
      conversation('yesterday-2', new Date(2026, 7, 11, 18, 0).getTime()),
      conversation('twenty-nine-days-ago', new Date(2026, 6, 14).getTime()),
    ];

    const buckets = groupConversationsByRecency(conversations, 'en-US', NOW, 10);
    const dayBuckets = buckets.filter((b) => b.kind === 'day');

    // Same-day conversations merge into a single bucket.
    expect(dayBuckets).toHaveLength(2);
    expect(dayBuckets[0].conversations.map((c) => c.id).toSorted()).toEqual(['yesterday-1', 'yesterday-2']);
    expect(dayBuckets[1].conversations.map((c) => c.id)).toEqual(['twenty-nine-days-ago']);
  });

  it('promotes a conversation to the month bucket once a full calendar month has passed', () => {
    const conversations = [
      ...Array.from({ length: 10 }, (_, i) => conversation(`filler${i}`, NOW - i * 1000)),
      // Exactly one calendar month before NOW (2026-07-12) — a full month has
      // elapsed, so this should NOT be a day bucket.
      conversation('exactly-one-month', new Date(2026, 6, 12, 12, 0).getTime()),
      // One day short of a full month (2026-07-14) — still within the day tier.
      conversation('just-under-one-month', new Date(2026, 6, 14, 12, 0).getTime()),
    ];

    const buckets = groupConversationsByRecency(conversations, 'en-US', NOW, 10);

    const monthBucket = buckets.find((b) => b.kind === 'month');
    const dayBucket = buckets.find((b) => b.kind === 'day');

    expect(monthBucket?.conversations.map((c) => c.id)).toEqual(['exactly-one-month']);
    expect(dayBucket?.conversations.map((c) => c.id)).toEqual(['just-under-one-month']);
  });

  it('promotes a conversation to the year bucket once a full calendar year has passed', () => {
    const conversations = [
      ...Array.from({ length: 10 }, (_, i) => conversation(`filler${i}`, NOW - i * 1000)),
      // Exactly one year before NOW.
      conversation('exactly-one-year', new Date(2025, 7, 12, 12, 0).getTime()),
      // 11 months before NOW — still within the month tier.
      conversation('eleven-months-ago', new Date(2025, 8, 12, 12, 0).getTime()),
    ];

    const buckets = groupConversationsByRecency(conversations, 'en-US', NOW, 10);

    const yearBucket = buckets.find((b) => b.kind === 'year');
    const monthBucket = buckets.find((b) => b.kind === 'month');

    expect(yearBucket?.conversations.map((c) => c.id)).toEqual(['exactly-one-year']);
    expect(monthBucket?.conversations.map((c) => c.id)).toEqual(['eleven-months-ago']);
  });

  it('orders day/month/year buckets newest-first and formats labels via Intl.DateTimeFormat', () => {
    const conversations = [
      ...Array.from({ length: 10 }, (_, i) => conversation(`filler${i}`, NOW - i * 1000)),
      // Both within the last month (18 and 11 days before NOW), so both land
      // in the day tier — on different calendar days, so two separate buckets.
      conversation('older', new Date(2026, 6, 25).getTime()),
      conversation('newer', new Date(2026, 7, 1).getTime()),
    ];

    const buckets = groupConversationsByRecency(conversations, 'en-US', NOW, 10);
    const dayBuckets = buckets.filter((b) => b.kind === 'day');

    expect(dayBuckets.map((b) => b.conversations[0].id)).toEqual(['newer', 'older']);
    expect(dayBuckets[0]).toMatchObject({ label: 'August 1' });
    expect(dayBuckets[1]).toMatchObject({ label: 'July 25' });
  });

  it('returns an empty array for an empty input', () => {
    expect(groupConversationsByRecency([], 'en-US', NOW, 10)).toEqual([]);
  });
});
