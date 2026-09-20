const SESSION_AT_PREFIX = '@@';
const BOUNDARY_RE = /[\s,;!?()[\]{}]/;

export type ActiveSessionAtQuery = {
  start: number;
  end: number;
  query: string;
  token: string;
};

function isBoundary(char: string): boolean {
  return BOUNDARY_RE.test(char);
}

/** Active `@@` mention query at the caret (for cross-session picker). */
export function getActiveSessionAtQuery(value: string, caretPosition: number): ActiveSessionAtQuery | null {
  if (!value) {
    return null;
  }
  const safeCaret = Math.max(0, Math.min(caretPosition, value.length));
  let atIndex = -1;
  for (let index = safeCaret - 1; index >= 0; index -= 1) {
    if (value.startsWith(SESSION_AT_PREFIX, index)) {
      const previousChar = index > 0 ? value[index - 1] : '';
      if (!previousChar || isBoundary(previousChar)) {
        atIndex = index;
        break;
      }
    }
    const char = value[index];
    if (isBoundary(char)) {
      return null;
    }
  }
  if (atIndex === -1) {
    return null;
  }
  let tokenEnd = value.length;
  for (let index = atIndex + SESSION_AT_PREFIX.length; index < value.length; index += 1) {
    if (isBoundary(value[index])) {
      tokenEnd = index;
      break;
    }
  }
  if (safeCaret < atIndex || safeCaret > tokenEnd) {
    return null;
  }
  const rawQuery = value.slice(atIndex + SESSION_AT_PREFIX.length, tokenEnd);
  return {
    start: atIndex,
    end: tokenEnd,
    query: rawQuery.trim().toLowerCase(),
    token: value.slice(atIndex, tokenEnd),
  };
}

export function buildSessionConvInsertion(conversationId: string): string {
  return `@@conv:${conversationId}`;
}

export type SessionAtMenuKeyAction = 'dismiss' | 'up' | 'down' | 'accept' | null;

export function resolveSessionAtMenuKey(key: string, hasItems: boolean): SessionAtMenuKeyAction {
  if (key === 'Escape') return 'dismiss';
  if (!hasItems) return null;
  if (key === 'ArrowDown') return 'down';
  if (key === 'ArrowUp') return 'up';
  if (key === 'Enter' || key === 'Tab') return 'accept';
  return null;
}
