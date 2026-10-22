/**
 * Copyright 2026 One Work
 */

/**
 * Must not contain `]`: the backend's `strip_system_notes` ends a note at the first one,
 * and anything after it would leak into the user's own bubble.
 */
export const AUTO_STAFFING_SYSTEM_NOTE =
  '[SYSTEM NOTE: Auto-staffing is on for this team, so the user has pre-confirmed any lineup. ' +
  'If more teammates would help, pick them with team_list_assistants and create them with team_spawn_agent ' +
  'in this turn — do not send a staffing proposal or ask for confirmation. In your reply, say briefly who you ' +
  'added and why; the user can remove or replace anyone later.]';

/** Append the auto-staffing note to a message bound for the leader. */
export function withAutoStaffingNote(input: string): string {
  return `${input}\n\n${AUTO_STAFFING_SYSTEM_NOTE}`;
}

/**
 * Frontend mirror of the backend's `strip_system_notes`. Conversation bubbles are already
 * stripped server-side, but the activity board renders raw mailbox rows, which keep the note
 * because the leader has to read it.
 */
export function stripSystemNotes(text: string): string {
  let result = '';
  let rest = text;
  let start = rest.indexOf('[SYSTEM NOTE:');
  while (start !== -1) {
    result += rest.slice(0, start);
    const end = rest.indexOf(']', start);
    if (end === -1) {
      rest = rest.slice(start);
      break;
    }
    let next = rest.slice(end + 1);
    if (result.endsWith('\n') && next.startsWith('\n')) next = next.slice(1);
    rest = next;
    start = rest.indexOf('[SYSTEM NOTE:');
  }
  return (result + rest).trim();
}
