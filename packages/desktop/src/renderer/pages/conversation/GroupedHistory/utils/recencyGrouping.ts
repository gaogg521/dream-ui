/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';

export type RecencyBucket =
  | { kind: 'recent'; conversations: TChatConversation[] }
  | { kind: 'day'; label: string; sortKey: number; conversations: TChatConversation[] }
  | { kind: 'month'; label: string; sortKey: number; conversations: TChatConversation[] }
  | { kind: 'year'; label: string; sortKey: number; conversations: TChatConversation[] };

/** Calendar-day key, e.g. `2026-8-10` — not zero-padded, only used as a Map key. */
const dayKey = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const monthKey = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth()}`;
};

const yearKey = (time: number): string => String(new Date(time).getFullYear());

const toSortedBuckets = (
  kind: 'day' | 'month' | 'year',
  map: Map<string, { time: number; conversations: TChatConversation[] }>,
  formatter: Intl.DateTimeFormat
): RecencyBucket[] =>
  [...map.values()]
    .toSorted((a, b) => b.time - a.time)
    .map(
      (bucket): RecencyBucket => ({
        kind,
        label: formatter.format(bucket.time),
        sortKey: bucket.time,
        conversations: bucket.conversations,
      })
    );

/**
 * Age tier for a conversation relative to `now`, using whole calendar units
 * (not 30/365-day approximations) so "1 month ago today" and "1 year ago
 * today" land on the coarser tier rather than lingering in the finer one.
 */
const ageTier = (time: number, now: number): 'day' | 'month' | 'year' => {
  const then = new Date(time);
  const current = new Date(now);
  const monthsApart =
    (current.getFullYear() - then.getFullYear()) * 12 +
    (current.getMonth() - then.getMonth()) -
    (current.getDate() < then.getDate() ? 1 : 0);
  if (monthsApart < 1) return 'day';
  if (monthsApart < 12) return 'month';
  return 'year';
};

/**
 * Group conversations for the Session Center's "history" list: the most
 * recent `recentCount` are shown flat (no date label — they're the ones a
 * user is most likely scanning for), everything older is bucketed by
 * calendar day if under a month old, by month if under a year old, and by
 * year beyond that — coarser the further back you go, so the list doesn't
 * turn into hundreds of individually-dated rows.
 *
 * `now` is injectable (defaults to `Date.now()`) purely so month/year
 * boundary behavior can be pinned down in tests.
 */
export function groupConversationsByRecency(
  conversations: TChatConversation[],
  locale: string,
  now: number = Date.now(),
  recentCount = 10
): RecencyBucket[] {
  const sorted = conversations.toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
  const recent = sorted.slice(0, recentCount);
  const rest = sorted.slice(recentCount);

  const buckets: RecencyBucket[] = [];
  if (recent.length > 0) {
    buckets.push({ kind: 'recent', conversations: recent });
  }

  const dayFormatter = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' });
  const monthFormatter = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' });
  const yearFormatter = new Intl.DateTimeFormat(locale, { year: 'numeric' });

  const dayBuckets = new Map<string, { time: number; conversations: TChatConversation[] }>();
  const monthBuckets = new Map<string, { time: number; conversations: TChatConversation[] }>();
  const yearBuckets = new Map<string, { time: number; conversations: TChatConversation[] }>();

  for (const conversation of rest) {
    const time = getActivityTime(conversation);
    const tier = ageTier(time, now);
    const map = tier === 'day' ? dayBuckets : tier === 'month' ? monthBuckets : yearBuckets;
    const key = tier === 'day' ? dayKey(time) : tier === 'month' ? monthKey(time) : yearKey(time);
    const existing = map.get(key);
    if (existing) {
      existing.conversations.push(conversation);
      existing.time = Math.max(existing.time, time);
    } else {
      map.set(key, { time, conversations: [conversation] });
    }
  }

  buckets.push(
    ...toSortedBuckets('day', dayBuckets, dayFormatter),
    ...toSortedBuckets('month', monthBuckets, monthFormatter),
    ...toSortedBuckets('year', yearBuckets, yearFormatter)
  );

  return buckets;
}
