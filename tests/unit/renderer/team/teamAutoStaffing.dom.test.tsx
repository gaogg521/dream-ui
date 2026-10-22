/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_STAFFING_SYSTEM_NOTE,
  stripSystemNotes,
  withAutoStaffingNote,
} from '@/renderer/pages/team/autoStaffing/systemNote';
import {
  readTeamAutoStaffing,
  setTeamAutoStaffing,
  useTeamAutoStaffing,
} from '@/renderer/pages/team/autoStaffing/useTeamAutoStaffing';

describe('auto-staffing system note', () => {
  it('is a single note block the backend can strip whole', () => {
    // The backend ends a note at the first `]`; an inner one would leak the rest of
    // the note into the user's own bubble.
    expect(AUTO_STAFFING_SYSTEM_NOTE.startsWith('[SYSTEM NOTE:')).toBe(true);
    expect(AUTO_STAFFING_SYSTEM_NOTE.indexOf(']')).toBe(AUTO_STAFFING_SYSTEM_NOTE.length - 1);
  });

  it('round-trips: what the user typed is what the user sees', () => {
    expect(stripSystemNotes(withAutoStaffingNote('做一个消消乐小游戏'))).toBe('做一个消消乐小游戏');
  });

  it('matches the backend strip_system_notes cases', () => {
    expect(stripSystemNotes('Visible\n[SYSTEM NOTE: internal]\ntext')).toBe('Visible\ntext');
    expect(stripSystemNotes('no note here')).toBe('no note here');
    expect(stripSystemNotes('a [SYSTEM NOTE: unterminated')).toBe('a [SYSTEM NOTE: unterminated');
  });
});

describe('useTeamAutoStaffing', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to off, so the leader keeps asking before it staffs', () => {
    const { result } = renderHook(() => useTeamAutoStaffing('team-1'));
    expect(result.current[0]).toBe(false);
    expect(readTeamAutoStaffing('team-1')).toBe(false);
  });

  it('persists per team and updates every subscriber at once', () => {
    const header = renderHook(() => useTeamAutoStaffing('team-1'));
    const other = renderHook(() => useTeamAutoStaffing('team-2'));

    act(() => header.result.current[1](true));

    expect(header.result.current[0]).toBe(true);
    expect(readTeamAutoStaffing('team-1')).toBe(true);
    expect(other.result.current[0]).toBe(false);

    act(() => setTeamAutoStaffing('team-1', false));
    expect(header.result.current[0]).toBe(false);
    expect(localStorage.getItem('team-auto-staffing-team-1')).toBeNull();
  });
});
