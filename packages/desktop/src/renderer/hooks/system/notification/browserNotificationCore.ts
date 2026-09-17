/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Framework-free core for WebUI browser notifications: pure gating and a
 * controller that turns conversation events into notification payloads.
 * Kept free of React / DOM globals so it is unit-testable in the node project.
 */

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

export type NotificationGate = {
  isElectron: boolean;
  hasNotificationApi: boolean;
  isSecureContext: boolean;
  permission: NotificationPermissionState;
  settingEnabled: boolean;
  documentHidden: boolean;
};

export const shouldShowNotification = (gate: NotificationGate): boolean =>
  !gate.isElectron &&
  gate.hasNotificationApi &&
  gate.isSecureContext &&
  gate.permission === 'granted' &&
  gate.settingEnabled &&
  gate.documentHidden;

export type NotificationKind = 'confirmation' | 'turnCompleted';

export type NotificationPayload = {
  body: string;
  conversationId?: string;
  kind: NotificationKind;
};

export type BrowserNotificationDeps = {
  /**
   * Whether a notification may be shown right now. The WebUI path derives this
   * from the browser gate (`shouldShowNotification`); the desktop path uses its
   * own condition (window focus is checked in the main process). Injecting the
   * predicate keeps this controller — and its turn-finish detection / dedup —
   * shared across both paths.
   */
  shouldShow: () => boolean;
  show: (payload: NotificationPayload) => void;
  bodyFor: (kind: NotificationKind) => string;
};

/**
 * Shape of a conversation response-stream message (`message.stream`). Both the
 * turn-finish and permission-request signals ride this single channel, keyed
 * by `type` — there is no separate `confirmation.add` / `turn.completed`
 * channel in a real conversation.
 */
export type StreamMessage = {
  type?: string;
  conversation_id?: string;
  turn_id?: string;
  /** Stable per-message id, used to dedup repeated confirmation frames
   *  (e.g. a reconnect replay re-delivering the same permission request). */
  msg_id?: string;
};

// Stream `type` values that mean the agent is blocked on the user: a tool
// permission request (`acp_permission` from ACP; `permission` too from dream)
// or a structured question (`ask`, AskUserQuestion). A question pauses the turn
// exactly as a permission request does, so it earns the same "needs your input"
// notification — without it a paused agent went unannounced.
const CONFIRMATION_TYPES = new Set(['acp_permission', 'permission', 'ask']);

export const createBrowserNotificationController = (deps: BrowserNotificationDeps) => {
  // Track the last turn we actually notified for, so repeated finish events
  // for the same turn don't fire duplicate notifications.
  let lastNotifiedTurnId: string | null = null;
  // Confirmation frames already notified for (conversation_id + msg_id), so a
  // reconnect replay of the same request does not fire a duplicate.
  // Best-effort per controller lifetime, mirroring the turn dedup above.
  const notifiedConfirmationKeys = new Set<string>();

  const onStreamMessage = (message: StreamMessage): void => {
    if (!message?.type) return;

    if (CONFIRMATION_TYPES.has(message.type)) {
      const dedupKey = message.msg_id ? `${message.conversation_id ?? ''}:${message.msg_id}` : null;
      if (dedupKey && notifiedConfirmationKeys.has(dedupKey)) return;
      if (!deps.shouldShow()) return;
      if (dedupKey) notifiedConfirmationKeys.add(dedupKey);
      deps.show({ body: deps.bodyFor('confirmation'), conversationId: message.conversation_id, kind: 'confirmation' });
      return;
    }

    if (message.type === 'finish') {
      if (message.turn_id && message.turn_id === lastNotifiedTurnId) return;
      if (!deps.shouldShow()) return;
      lastNotifiedTurnId = message.turn_id ?? null;
      deps.show({
        body: deps.bodyFor('turnCompleted'),
        conversationId: message.conversation_id,
        kind: 'turnCompleted',
      });
    }
  };

  return { onStreamMessage };
};
