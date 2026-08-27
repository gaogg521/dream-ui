/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isErrorTipMessage, transformMessage } from '@/common/chat/chatLib';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { TChatConversation, TokenUsageData } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import type { ThoughtData } from '@/renderer/components/chat/ThoughtDisplay';
import { useMergeLiveMessage } from '@/renderer/pages/conversation/Messages/hooks';
import { logStreamTerminalObserved } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { isConversationProcessing } from '@/renderer/pages/conversation/utils/conversationRuntime';
import { beginConversationTurn, endConversationTurn } from '@/renderer/pages/conversation/utils/conversationTurnClock';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { processLocalCronResponse } from './localCronCommands';
// Shared with the ACP hook on purpose — see the `acp_context_usage` arm.
import { tokenUsageFromAcpUsage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';

type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

export const useDreamEngineMessage = (
  conversation_id: string,
  options?: {
    onError?: (message: IResponseMessage) => void;
    onConfigChanged?: (capabilities: Record<string, unknown>) => void;
  }
) => {
  const onError = options?.onError;
  const onConfigChanged = options?.onConfigChanged;
  const onConfigChangedRef = useRef(onConfigChanged);
  const mergeLiveMessage = useMergeLiveMessage();
  const [streamRunning, setStreamRunning] = useState(false);
  const [hasActiveTools, setHasActiveTools] = useState(false);
  const [waitingResponse, setWaitingResponse] = useState(false);
  const [hasHydratedRunningState, setHasHydratedRunningState] = useState(false);
  const [thought, setThought] = useState<ThoughtData>({
    description: '',
    subject: '',
  });
  const [tokenUsage, setTokenUsage] = useState<TokenUsageData | null>(null);
  /**
   * Context window size, when the backend states one.
   *
   * Stays 0 for a backend that reports raw token counts without a window — the
   * indicator then shows the count instead of a percentage against a guessed
   * denominator. Plumbed rather than hard-coded so a backend that does report a
   * size gets the percentage the feature exists for.
   */
  const [context_limit, setContextLimit] = useState<number>(0);
  // Turn start origin for the elapsed indicator; backed by the module-level
  // conversation turn clock so it survives unmount on conversation switches.
  const [turnStartedAtMs, setTurnStartedAtMs] = useState<number | null>(null);
  // Conversation whose running state has been hydrated from the backend. Guards
  // the turn-clock cleanup below: a pre-hydration `running === false` (stale
  // state from the previous conversation) must not delete the persisted origin.
  const hydratedConversationRef = useRef<string | null>(null);
  // Current active message ID to filter out events from old requests (prevents aborted request events from interfering with new ones)
  const activeMsgIdRef = useRef<string | null>(null);
  const messageBufferRef = useRef(new Map<string, string>());
  const processedCronMsgIdsRef = useRef(new Set<string>());

  // Use refs to avoid useEffect re-subscription when these states change
  const hasActiveToolsRef = useRef(hasActiveTools);
  const streamRunningRef = useRef(streamRunning);
  const waitingResponseRef = useRef(waitingResponse);

  // Track whether current turn has content output
  // Only reset waitingResponse when finish arrives after content (not after tool calls)
  const hasContentInTurnRef = useRef(false);

  useEffect(() => {
    onConfigChangedRef.current = onConfigChanged;
  }, [onConfigChanged]);
  useEffect(() => {
    hasActiveToolsRef.current = hasActiveTools;
  }, [hasActiveTools]);
  useEffect(() => {
    streamRunningRef.current = streamRunning;
  }, [streamRunning]);

  // Throttle thought updates to reduce render frequency
  const thoughtThrottleRef = useRef<{
    lastUpdate: number;
    pending: ThoughtData | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ lastUpdate: 0, pending: null, timer: null });

  const throttledSetThought = useMemo(() => {
    const THROTTLE_MS = 50; // 50ms throttle interval
    return (data: ThoughtData) => {
      const now = Date.now();
      const ref = thoughtThrottleRef.current;

      if (now - ref.lastUpdate >= THROTTLE_MS) {
        ref.lastUpdate = now;
        ref.pending = null;
        if (ref.timer) {
          clearTimeout(ref.timer);
          ref.timer = null;
        }
        setThought(data);
      } else {
        ref.pending = data;
        if (!ref.timer) {
          ref.timer = setTimeout(
            () => {
              ref.lastUpdate = Date.now();
              ref.timer = null;
              if (ref.pending) {
                setThought(ref.pending);
                ref.pending = null;
              }
            },
            THROTTLE_MS - (now - ref.lastUpdate)
          );
        }
      }
    };
  }, []);

  // Cleanup throttle timer
  useEffect(() => {
    return () => {
      if (thoughtThrottleRef.current.timer) {
        clearTimeout(thoughtThrottleRef.current.timer);
      }
    };
  }, []);

  // Combined running state: waiting for response OR stream is running OR tools are active
  const running = waitingResponse || streamRunning || hasActiveTools;

  // Keep the persisted turn origin in sync with the running state so the
  // elapsed indicator does not restart from zero after a conversation switch.
  useEffect(() => {
    if (running) {
      // begin keeps an already-recorded origin, so re-entering a conversation
      // mid-turn restores the original start time instead of resetting it.
      setTurnStartedAtMs(beginConversationTurn(conversation_id));
      return;
    }
    // Only drop the origin once hydration confirmed the idle state belongs to
    // THIS conversation; transient falses during a switch must keep it alive.
    if (hydratedConversationRef.current === conversation_id) {
      endConversationTurn(conversation_id);
    }
    setTurnStartedAtMs(null);
  }, [running, conversation_id]);

  // Set current active message ID
  const setActiveMsgId = useCallback((msgId: string | null) => {
    activeMsgIdRef.current = msgId;
  }, []);

  const processCompletedAssistantMessage = useCallback(
    async (msgId: string) => {
      if (!msgId || processedCronMsgIdsRef.current.has(msgId)) {
        return;
      }

      const rawContent = messageBufferRef.current.get(msgId) ?? '';
      if (!rawContent.trim()) {
        return;
      }

      processedCronMsgIdsRef.current.add(msgId);

      try {
        const result = await processLocalCronResponse(conversation_id, rawContent);
        if (result.displayContent !== undefined && result.displayContent !== rawContent) {
          mergeLiveMessage({
            id: uuid(),
            msg_id: msgId,
            type: 'text',
            position: 'left',
            conversation_id,
            created_at: Date.now(),
            content: {
              content: result.displayContent,
              replace: true,
            },
          });
        }

        for (const response of result.systemResponses) {
          mergeLiveMessage(
            {
              id: uuid(),
              msg_id: `cron-local-${uuid()}`,
              type: 'tips',
              position: 'center',
              conversation_id,
              created_at: Date.now(),
              content: {
                content: response,
                type: response.startsWith('❌') ? 'error' : 'success',
              },
            },
            true
          );
        }
      } catch {
        processedCronMsgIdsRef.current.delete(msgId);
      }
    },
    [mergeLiveMessage, conversation_id]
  );

  useEffect(() => {
    return ipcBridge.conversation.responseStream.on((message) => {
      if (conversation_id !== message.conversation_id) {
        return;
      }

      if (isErrorTipMessage(message)) {
        setStreamRunning(false);
        streamRunningRef.current = false;
        setWaitingResponse(false);
        waitingResponseRef.current = false;
        setHasActiveTools(false);
        hasActiveToolsRef.current = false;
        setThought({ subject: '', description: '' });
        hasContentInTurnRef.current = false;
        const transformedMessage = transformMessage(message);
        if (transformedMessage) {
          mergeLiveMessage(transformedMessage);
        }
        return;
      }

      // Filter out events not belonging to current active request (prevents aborted events from interfering)
      // Note: only filter out thought and start messages, other messages must be rendered
      if (activeMsgIdRef.current && message.msg_id && message.msg_id !== activeMsgIdRef.current) {
        if (message.type === 'thought') {
          return;
        }
      }

      if ((message.type === 'content' || message.type === 'text') && message.msg_id) {
        const payload = message.data;
        const chunk =
          typeof payload === 'string'
            ? payload
            : typeof payload === 'object' &&
                payload !== null &&
                'content' in payload &&
                typeof (payload as { content?: unknown }).content === 'string'
              ? ((payload as { content: string }).content ?? '')
              : '';

        if (chunk) {
          const previous = messageBufferRef.current.get(message.msg_id) ?? '';
          messageBufferRef.current.set(message.msg_id, previous + chunk);
        }
      }

      switch (message.type) {
        case 'thought':
          // Auto-recover streamRunning if thought arrives after finish
          if (!streamRunningRef.current) {
            setStreamRunning(true);
            streamRunningRef.current = true;
          }
          throttledSetThought(message.data as ThoughtData);
          break;
        case 'start':
          setStreamRunning(true);
          streamRunningRef.current = true;
          // Don't reset waitingResponse here - let tool completion flow handle it
          break;
        case 'finish':
          {
            logStreamTerminalObserved(conversation_id, message.turn_id, 'dream', message.type);
            // dream stream_end carries usage in data field
            const usageData = message.data as TokenUsage | undefined;
            if (usageData && typeof usageData === 'object' && 'input_tokens' in usageData) {
              const newTokenUsage: TokenUsageData = {
                total_tokens: (usageData.input_tokens || 0) + (usageData.output_tokens || 0),
              };
              setTokenUsage(newTokenUsage);
              void ipcBridge.conversation.update.invoke({
                id: conversation_id,
                updates: {
                  extra: { last_token_usage: newTokenUsage } as TChatConversation['extra'],
                },
                merge_extra: true,
              });
              // dream has no ACP-style passive usage stream carrying a
              // cumulative cost, so pull it from the billing ledger instead
              // (every turn writes a one_usage_events row regardless of
              // backend). Best-effort: a failed/slow lookup must not block
              // or clear the token count that already rendered above.
              void ipcBridge.oneBilling.getConversationCost
                .invoke({ conversation_id })
                .then((res) => {
                  if (!res) return;
                  setTokenUsage((prev) =>
                    prev
                      ? {
                          ...prev,
                          cost: { amount: res.estimatedCostMicros / 1_000_000, currency: 'USD' },
                        }
                      : prev
                  );
                })
                .catch(() => {
                  // No cost data yet (e.g. an unpriced model) is not an error
                  // worth surfacing — the token count stands on its own.
                });
            }
            setStreamRunning(false);
            setWaitingResponse(false);
            setThought({ subject: '', description: '' });
            if (message.msg_id) {
              void processCompletedAssistantMessage(message.msg_id);
            }
          }
          break;
        /**
         * The conversation-scoped usage report.
         *
         * Not an ACP-only frame despite the name: `broadcast_usage_frame` in
         * dream-core says so itself — "Fires for every backend" — because a
         * usage report is conversation state, not turn state, and some backends
         * only produce it after their turn has already closed. This arm was
         * missing, so for a dream conversation the frame was broadcast into an
         * empty room and the context indicator stayed blank.
         *
         * The `finish` arm above reads usage too, and both are kept: the two
         * carry it at different times depending on backend, and whichever
         * arrives replaces wholesale (the same idempotence the broadcaster
         * relies on for backends that deliver both).
         */
        case 'acp_context_usage': {
          const usageData = message.data as
            | {
                used: number;
                size?: number;
                cost?: { amount: number; currency: string };
                _meta?: Record<string, unknown>;
              }
            | undefined;
          if (usageData && typeof usageData.used === 'number' && usageData.used > 0) {
            setTokenUsage((prev) => {
              // Parsed by the ACP hook's converter, not a second reader of the
              // same frame: the per-turn counters ride in `_meta` (a UsageUpdate
              // field, so they survive the typed round-trip through the backend
              // snapshot), and two parsers would drift on which key means what.
              const next = tokenUsageFromAcpUsage(usageData);
              // A report without a breakdown or cost — a mid-turn one, or a
              // backend that sends neither — must not blank figures the user has
              // already seen.
              if (!next.breakdown && prev?.breakdown) next.breakdown = prev.breakdown;
              if (!next.cost && prev?.cost) next.cost = prev.cost;
              return next;
            });
            // Only when the backend actually states a window. Without it the
            // indicator shows the raw count rather than a percentage against a
            // guessed denominator.
            if (typeof usageData.size === 'number' && usageData.size > 0) {
              setContextLimit((prev) => (prev > 0 ? prev : (usageData.size as number)));
            }
            // Persist, same as the `finish` arm does. Without this the figure
            // survives only until the conversation is reopened — the backend
            // snapshot covers that too, but only for a backend that stores one,
            // and writing it here costs one call and covers both.
            void ipcBridge.conversation.update.invoke({
              id: conversation_id,
              updates: {
                extra: {
                  last_token_usage: { total_tokens: usageData.used },
                  ...(usageData.size && usageData.size > 0 ? { last_context_limit: usageData.size } : {}),
                } as TChatConversation['extra'],
              },
              merge_extra: true,
            });
          }
          break;
        }
        case 'tool_group':
          {
            // Mark that current turn has content output
            hasContentInTurnRef.current = true;

            // Auto-recover streamRunning if tool_group arrives after finish
            if (!streamRunningRef.current) {
              setStreamRunning(true);
              streamRunningRef.current = true;
            }

            // Check if any tools are executing or awaiting confirmation
            const tools = message.data as Array<{ status: string; name?: string }>;
            const activeStatuses = new Set(['Executing', 'Confirming', 'Pending']);
            const hasActive = tools.some((tool) => activeStatuses.has(tool.status));
            const wasActive = hasActiveToolsRef.current;

            setHasActiveTools(hasActive);
            hasActiveToolsRef.current = hasActive; // Sync update ref immediately

            // When tools transition from active to inactive, set waitingResponse=true
            // because backend needs to continue sending requests to model
            if (wasActive && !hasActive && tools.length > 0) {
              setWaitingResponse(true);
              waitingResponseRef.current = true;
            }

            // If tools are awaiting confirmation, update thought hint
            const confirmingTool = tools.find((tool) => tool.status === 'Confirming');
            if (confirmingTool) {
              setThought({
                subject: 'Awaiting Confirmation',
                description: confirmingTool.name || 'Tool execution',
              });
            } else if (hasActive) {
              const executingTool = tools.find((tool) => tool.status === 'Executing');
              if (executingTool) {
                setThought({
                  subject: 'Executing',
                  description: executingTool.name || 'Tool',
                });
              }
            } else if (!streamRunningRef.current) {
              // All tools completed and stream stopped, clear thought
              setThought({ subject: '', description: '' });
            }

            // Continue passing message to message list update
            mergeLiveMessage(transformMessage(message));
          }
          break;
        case 'permission':
        case 'acp_permission':
          if (!streamRunningRef.current) {
            setStreamRunning(true);
            streamRunningRef.current = true;
          }
          // Backend dream emits wire type 'acp_permission' but the payload is
          // Confirmation-shaped (legacy), which matches MessagePermission, not
          // MessageAcpPermission. Re-tag so transformMessage routes it correctly.
          mergeLiveMessage(transformMessage({ ...message, type: 'permission' }));
          break;
        case 'config_changed':
          onConfigChangedRef.current?.(message.data as Record<string, unknown>);
          break;
        default: {
          if (message.type === 'error') {
            logStreamTerminalObserved(conversation_id, message.turn_id, 'dream', message.type);
            setStreamRunning(false);
            streamRunningRef.current = false;
            setWaitingResponse(false);
            waitingResponseRef.current = false;
            setThought({ subject: '', description: '' });
            onError?.(message as IResponseMessage);
          } else {
            // Mark that current turn has content output (exclude error type)
            hasContentInTurnRef.current = true;
            // Reset waitingResponse when actual content arrives
            if (message.type === 'content') {
              setWaitingResponse(false);
              waitingResponseRef.current = false;
            }
            // Auto-recover streamRunning if content arrives after finish
            if (!streamRunningRef.current) {
              setStreamRunning(true);
              streamRunningRef.current = true;
            }
          }
          // Backend handles persistence, Frontend only updates UI
          mergeLiveMessage(transformMessage(message));
          break;
        }
      }
    });
    // Note: hasActiveTools and streamRunning are accessed via refs to avoid re-subscription
  }, [conversation_id, mergeLiveMessage, onError, processCompletedAssistantMessage]);

  useEffect(() => {
    let cancelled = false;

    setThought({ subject: '', description: '' });
    setTokenUsage(null);
    // Belongs to the conversation being left, not the one being opened.
    setContextLimit(0);
    hasContentInTurnRef.current = false;
    setHasHydratedRunningState(false);

    // Check actual conversation status from backend before resetting all running states
    // to avoid flicker when switching to a running conversation
    void getConversationOrNull(conversation_id).then((res) => {
      if (cancelled) {
        return;
      }

      if (!res) {
        hydratedConversationRef.current = conversation_id;
        endConversationTurn(conversation_id);
        setStreamRunning(false);
        streamRunningRef.current = false;
        setHasActiveTools(false);
        hasActiveToolsRef.current = false;
        setWaitingResponse(false);
        waitingResponseRef.current = false;
        setHasHydratedRunningState(true);
        return;
      }
      const isRunning = isConversationProcessing(res);
      hydratedConversationRef.current = conversation_id;
      if (!isRunning) {
        // Turn ended while this conversation was in the background — drop the
        // stale origin so the next turn starts from its own send time. (The
        // sync effect above cannot cover this: running may already be false,
        // so it never re-runs after hydration.)
        endConversationTurn(conversation_id);
      }
      setStreamRunning(isRunning);
      streamRunningRef.current = isRunning;
      // Reset tool states - they will be restored by incoming messages if still active
      setHasActiveTools(false);
      hasActiveToolsRef.current = false;
      setWaitingResponse(isRunning);
      waitingResponseRef.current = isRunning;
      // Load persisted token usage stats
      if (res.type === 'dream' && res.extra?.last_token_usage) {
        const { last_token_usage, last_context_limit } = res.extra;
        if (last_token_usage.total_tokens > 0) {
          setTokenUsage(last_token_usage);
        }
        // Restored alongside the count, so a reopened conversation shows the
        // percentage rather than falling back to a bare number. The ACP hook
        // already did both; this side only restored the count.
        if (last_context_limit && last_context_limit > 0) {
          setContextLimit(last_context_limit);
        }
      }
      setHasHydratedRunningState(true);
    });

    return () => {
      cancelled = true;
    };
  }, [conversation_id]);

  /**
   * Hydrate the context indicator from the backend's own usage snapshot.
   *
   * `extra.last_token_usage` above only exists once THIS client has seen a turn
   * finish and written it back, so a conversation opened on a fresh install, on
   * a second machine, or after that write failed showed nothing even though the
   * backend had the figure all along. The ACP hook already reads this endpoint;
   * the dream side never did.
   *
   * Never overwrites a value already set: a live frame may land first, and it is
   * newer than any snapshot.
   */
  useEffect(() => {
    let cancelled = false;
    void ipcBridge.conversation.getUsage
      .invoke({ conversation_id })
      .then((usage) => {
        if (cancelled || !usage || typeof usage.used !== 'number' || usage.used <= 0) return;
        setTokenUsage((prev) => {
          if (prev) return prev;
          const next: TokenUsageData = { total_tokens: usage.used };
          if (usage.cost && usage.cost.amount > 0) {
            next.cost = { amount: usage.cost.amount, currency: usage.cost.currency || 'USD' };
          }
          return next;
        });
        if (typeof usage.size === 'number' && usage.size > 0) {
          setContextLimit((prev) => (prev > 0 ? prev : usage.size));
        }
      })
      // A missing snapshot is the normal case for a conversation that has not
      // run a turn yet, not an error worth surfacing.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation_id]);

  const resetState = useCallback(() => {
    setWaitingResponse(false);
    waitingResponseRef.current = false;
    setStreamRunning(false);
    streamRunningRef.current = false;
    setHasActiveTools(false);
    hasActiveToolsRef.current = false;
    setThought({ subject: '', description: '' });
    hasContentInTurnRef.current = false;
    // Clear active message ID to prevent filtering events from new messages after stop
    activeMsgIdRef.current = null;
  }, []);

  return {
    thought,
    setThought,
    running,
    hasHydratedRunningState,
    turnStartedAtMs,
    tokenUsage,
    context_limit,
    setActiveMsgId,
    setWaitingResponse,
    resetState,
  };
};
