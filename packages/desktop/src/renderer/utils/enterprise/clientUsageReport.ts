/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P2-1 — report a finished turn's token spend to the company.
 *
 * ## Why this exists
 *
 * A desktop client in enterprise mode runs its conversations on the local
 * co-located dreamcore, which is a personal build: the usage recorder is
 * compiled out of it entirely. The only turns the company ever saw were the
 * ones that happened to go through its own model proxy, because the proxy
 * meters what passes through it. A member working on a provider they
 * configured themselves produced no rows at all, so the administrator's usage
 * page showed someone who had apparently stopped working.
 *
 * ## The four constraints this is built to
 *
 * 1. **A personal user never uploads.** Enterprise mode and a resolved tenant
 *    are both required, checked here on every call rather than trusted from a
 *    render-time flag.
 * 2. **Nothing but counts leaves the machine.** Model name, provider id, token
 *    counts, conversation id. No prompt, no reply, no title — the conversation
 *    body staying local is the whole premise of the desktop client, and
 *    uploading it is a separate, explicitly gated feature (P2-2/P2-3).
 * 3. **No double counting.** Company-channel turns are already metered by the
 *    proxy. Rather than guess here, the local provider id goes up verbatim and
 *    the server drops what it recognizes as its own — one rule, one place.
 * 4. **Best effort, never in the way.** A failed report is dropped. Retrying
 *    would need a durable queue, and a queue of usage rows is a worse thing to
 *    own than an occasional missing one.
 */

import { ipcBridge } from '@/common';
import { isEnterpriseRemoteActive } from '@/common/adapter/enterpriseMode';
import { uuid } from '@/common/utils';

export type ClientTurnUsage = {
  conversationId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  durationMs?: number | null;
  requestId?: string;
};

/** A turn that burned nothing is not worth a row. */
function hasSpend(usage: ClientTurnUsage): boolean {
  return (usage.inputTokens ?? 0) > 0 || (usage.outputTokens ?? 0) > 0;
}

export async function reportClientTurnUsage(usage: ClientTurnUsage): Promise<void> {
  // Constraint 1. `isEnterpriseRemoteActive()` is the desktop client's
  // "connected to a company server" flag; without it there is nowhere to
  // report to and nobody who has agreed to be reported on.
  if (!isEnterpriseRemoteActive()) return;
  if (!hasSpend(usage)) return;

  // Which model and which provider served the turn is on the conversation
  // record, not in the usage frame. Resolving it here rather than threading it
  // through the stream handler keeps the lookup in one place — and it is the
  // provider id that decides, on the server, whether this row is a duplicate
  // of something the proxy already counted, so getting it wrong is worse than
  // not sending it.
  let model: string | undefined;
  let channelId: string | undefined;
  try {
    const conversation = await ipcBridge.conversation.get.invoke({ id: usage.conversationId });
    // `TChatConversation` is a union and only the dream variant carries a
    // model — the ACP variants name their backend elsewhere. Narrow rather
    // than cast: an ACP turn legitimately has nothing to put here, and the
    // report is still worth sending for the counts alone.
    if (conversation && 'model' in conversation && conversation.model) {
      model = conversation.model.use_model || undefined;
      // `IProvider.id` IS the local provider id the server matches on — the
      // team sync writes company channels as `prov_chan_<registry id>`, which
      // is exactly the prefix the server drops as already-metered.
      channelId = conversation.model.id || undefined;
    }
  } catch {
    // An unreadable conversation record is not a reason to drop the counts:
    // spend with no attribution still belongs in the total.
  }

  try {
    await ipcBridge.oneBilling.reportClientUsage.invoke({
      conversationId: usage.conversationId,
      model,
      channelId,
      inputTokens: usage.inputTokens ?? undefined,
      outputTokens: usage.outputTokens ?? undefined,
      cacheReadTokens: usage.cacheReadTokens ?? undefined,
      cacheWriteTokens: usage.cacheWriteTokens ?? undefined,
      durationMs: usage.durationMs ?? undefined,
      requestId: usage.requestId ?? uuid(),
    });
  } catch {
    // Constraint 4. Includes the case where the member is connected but the
    // server has no company for them: that returns success-with-no-row on the
    // server side, and any other failure is not worth a retry loop.
  }
}
