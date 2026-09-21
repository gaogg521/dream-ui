/**
 * P2-2/P2-3 — enterprise conversation sharing (renderer side).
 *
 * Three pieces, all policy-gated:
 *
 * 1. `fetchShareMode` — reads the tenant's `conversationShareMode` from the
 *    governance plane. `off` (the default) means the share affordance does
 *    not exist for this member at all.
 * 2. `shareConversationToOrg` — the member's share action from the
 *    conversation menu. A client-mode desktop conversation lives on the LOCAL
 *    dreamcore, so sharing uploads its content as a snapshot in the same
 *    call; a WebUI conversation is shared by reference. The server stores the
 *    snapshot under the member's own identity and gates everything on the
 *    policy (`off` refuses, `tenant` refuses enterprise scope).
 * 3. `fulfilAuditUploadRequests` — the P2-3 on_demand leg: the enterprise
 *    admin requests a conversation's content; this client picks the request
 *    up on the 5-minute sync loop and uploads the local snapshot. The
 *    request itself was audited when the admin made it, and every admin read
 *    of the uploaded content is audited separately.
 *
 * Best-effort throughout, same contract as the other team syncs: failures
 * return quietly and the next cycle retries.
 */

import React from 'react';
import type { TFunction } from 'i18next';
import { Modal, Message, Radio, Select } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from './friendlyEnterpriseError';

export type ConversationShareMode = 'off' | 'tenant' | 'enterprise';
export type ConversationShareScope = 'tenant' | 'enterprise';

/** One uploaded message row — the raw JSON blob is preserved verbatim. */
export type ShareMessageInput = {
  id?: string;
  type: string;
  content: string;
  position?: string;
  createdAt?: number;
};

/** The tenant's share policy; `null` when the governance plane is unreachable. */
export async function fetchShareMode(): Promise<ConversationShareMode | null> {
  try {
    const policy = await ipcBridge.onePlatform.mySecurityPolicy.invoke();
    const mode = (policy?.conversationShareMode ?? 'off') as ConversationShareMode;
    return mode === 'tenant' || mode === 'enterprise' ? mode : 'off';
  } catch {
    return null;
  }
}

/**
 * Reads the conversation's messages from the LOCAL backend for the snapshot
 * upload. Latest 500 rows, ascending — a bound, not a promise of completeness;
 * the server-side copy is the conversation as of share time.
 */
async function readLocalSnapshotMessages(conversationId: string): Promise<ShareMessageInput[]> {
  const page = await ipcBridge.database.getConversationMessages.invoke({
    conversation_id: conversationId,
    limit: 500,
    content_mode: 'full',
  });
  const items = (page?.items ?? []) as Array<{
    id: string;
    msg_id?: string;
    type: string;
    content: unknown;
    position?: string;
    created_at?: number;
  }>;
  return items.map((item) => ({
    id: item.msg_id ?? item.id,
    type: item.type,
    content: JSON.stringify(item.content ?? {}),
    position: item.position,
    createdAt: item.created_at,
  }));
}

function ShareScopePicker(props: {
  defaultValue: ConversationShareScope;
  onChange: (value: ConversationShareScope) => void;
}) {
  const [value, setValue] = React.useState<ConversationShareScope>(props.defaultValue);
  return (
    <Radio.Group
      value={value}
      onChange={(v) => {
        const next = v as ConversationShareScope;
        setValue(next);
        props.onChange(next);
      }}
    >
      <Radio value='tenant'>本组（项目组）</Radio>
      <Radio value='enterprise'>全企业</Radio>
    </Radio.Group>
  );
}

const SNAPSHOT_MESSAGE_CAP = 50;

/**
 * Personal/all-editions share: forward this conversation's record into
 * another of the user's OWN conversations as a `[[SESSION_SHARE]]` snapshot
 * message. No governance plane involved — the target is picked from the
 * member's history, the send goes through the ordinary local send edge, and
 * the recipient conversation renders it as a styled snapshot card.
 *
 * The marker deliberately avoids the `[[DREAM_...]]` prefix: the backend
 * escapes that prefix inside user-sent text, and this block must survive it.
 */
export async function shareConversationToMySession(
  conversation: { id: string; name: string },
  allConversations: Array<{ id: string; name?: string | null; type?: string }>,
  t: TFunction
): Promise<'shared' | 'cancelled' | 'unavailable'> {
  const targets = allConversations.filter((entry) => entry.id !== conversation.id);
  if (!targets.length) {
    Message.info(t('conversation.sessionShare.noOtherConversation', { defaultValue: '没有其他会话可作为分享目标' }));
    return 'unavailable';
  }

  let targetId: string | undefined;
  const accepted = await new Promise<boolean>((resolve) => {
    let selected: string | undefined;
    Modal.confirm({
      title: t('conversation.sessionShare.pickTitle', {
        defaultValue: '把「{{name}}」分享到哪个会话？',
        name: conversation.name,
      }),
      content: (
        <Select
          placeholder={t('conversation.sessionShare.pickPlaceholder', { defaultValue: '选择目标会话' })}
          style={{ width: '100%' }}
          onChange={(value: string) => {
            selected = value;
          }}
        >
          {targets.map((entry) => (
            <Select.Option key={entry.id} value={entry.id}>
              {entry.name || entry.id}
            </Select.Option>
          ))}
        </Select>
      ),
      onOk: () => {
        targetId = selected;
        resolve(Boolean(selected));
      },
      onCancel: () => resolve(false),
    });
  });
  if (!accepted || !targetId) return 'cancelled';

  try {
    const messages = (await readLocalSnapshotMessages(conversation.id)).slice(-SNAPSHOT_MESSAGE_CAP);
    const payload = {
      name: conversation.name,
      sharedAt: Date.now(),
      messages: messages.map((message) => ({
        type: message.type,
        content: message.content,
        position: message.position ?? null,
        createdAt: message.createdAt ?? null,
      })),
    };
    const content = `[[SESSION_SHARE]]
${JSON.stringify(payload)}`;
    await ipcBridge.conversation.sendMessage.invoke({
      conversation_id: targetId,
      input: content,
      reply_requested: false,
    });
    Message.success(t('conversation.sessionShare.sent', { defaultValue: '已分享到目标会话' }));
    return 'shared';
  } catch (error) {
    Message.error(
      friendlyEnterpriseError(error, t) ||
        t('conversation.sessionShare.sendFailed', { defaultValue: '分享失败，请稍后重试' })
    );
    return 'unavailable';
  }
}

/**
 * The share action behind the conversation-menu entry. Returns how it ended:
 * `'shared'` did upload/share, `'unavailable'` the policy or plane said no,
 * `'cancelled'` the member closed the scope dialog.
 */
export async function shareConversationToOrg(
  conversation: {
    id: string;
    name: string;
  },
  t: TFunction
): Promise<'shared' | 'unavailable' | 'cancelled'> {
  const mode = await fetchShareMode();
  if (mode === null || mode === 'off') {
    Message.info('当前企业未开启会话分享');
    return 'unavailable';
  }

  // `tenant` mode has exactly one scope to offer. `enterprise` mode lets the
  // member choose per share; the safer default (project group) is preselected.
  let scope: ConversationShareScope = 'tenant';
  if (mode === 'enterprise') {
    let chosen: ConversationShareScope | null = 'tenant';
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '分享会话到企业',
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>分享后，会话内容将上传至企业服务器，供被分享范围的同事查看。</div>
            <ShareScopePicker
              defaultValue='tenant'
              onChange={(value) => {
                chosen = value;
              }}
            />
          </div>
        ),
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed || chosen === null) return 'cancelled';
    scope = chosen;
  }

  try {
    const messages = await readLocalSnapshotMessages(conversation.id);
    await ipcBridge.onePlatform.shareConversation.invoke({
      conversationId: conversation.id,
      name: conversation.name,
      scope,
      messages,
    });
    Message.success(scope === 'tenant' ? '已分享给本组' : '已分享给全企业');
    return 'shared';
  } catch (error) {
    // The server has reasons the member can act on — a conversation id already
    // taken by someone else's conversation, for one — and "请稍后重试" is the
    // one piece of advice that can never help with any of them. Show what the
    // backend actually said; keep the generic line only for the case where
    // there is nothing to show (a transport failure with no envelope).
    Message.error(friendlyEnterpriseError(error, t) || '分享失败，请稍后重试');
    return 'unavailable';
  }
}

/**
 * Drain pending admin content requests (P2-3 on_demand). A conversation the
 * local backend does not have (the admin guessed, or this machine never ran
 * it) is fulfilled with an EMPTY snapshot: the request stops re-appearing,
 * and the admin's read honestly shows an unavailable conversation instead of
 * this client failing forever.
 */
export async function fulfilAuditUploadRequests(): Promise<number> {
  let requests: Awaited<ReturnType<typeof ipcBridge.onePlatform.myConversationAuditRequests.invoke>>;
  try {
    requests = await ipcBridge.onePlatform.myConversationAuditRequests.invoke();
  } catch {
    return 0;
  }
  let fulfilled = 0;
  for (const request of requests ?? []) {
    let messages: ShareMessageInput[] = [];
    let name = 'Uploaded conversation';
    try {
      messages = await readLocalSnapshotMessages(request.conversationId);
    } catch {
      messages = [];
    }
    try {
      await ipcBridge.onePlatform.fulfilConversationAuditRequest.invoke({
        requestId: request.id,
        name,
        messages,
      });
      fulfilled += 1;
    } catch {
      // Leave it pending; the next cycle retries.
    }
  }
  return fulfilled;
}
