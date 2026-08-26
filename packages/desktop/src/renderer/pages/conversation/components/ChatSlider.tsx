/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExplorerContainer } from '../explorer/ExplorerContainer';

/**
 * ChatLayout's right-sider content. The legacy per-conversation Workspace tree
 * (HTTP `getWorkspace` data source) has been removed — file browsing is now the
 * project-level Explorer host at the Layout level, gated on `project_id`.
 *
 * This sider only renders while `workspaceEnabled` (a workspace conversation
 * before its project_id backfill lands). Once the backfill arrives the
 * conversation is project-bound → `workspaceEnabled` is false and the Explorer
 * host takes over. The `project_id` branch is a defensive passthrough;
 * pure-chat (no workspace) conversations correctly show nothing here.
 */
const ChatSlider: React.FC<{
  conversation?: TChatConversation;
}> = ({ conversation }) => {
  const { t } = useTranslation();

  if (conversation?.project_id) {
    return <ExplorerContainer projectId={conversation.project_id} />;
  }

  /**
   * An empty `<div/>` under a panel titled "Project" reads as a file browser
   * that failed to load — reported as exactly that after a generated video did
   * not appear here. The panel is empty because the conversation has no project
   * bound, which is a fact about the conversation rather than about the files.
   *
   * The two cases are worded apart deliberately. A conversation *does* have a
   * working folder whenever one was chosen, and `bind_project_best_effort` only
   * binds folders already registered as projects (`resolve_existing`, it never
   * creates one) — so "there are no files to browse" would be false for a real
   * folder that simply was not registered. That case names the folder instead,
   * because the folder is exactly what the person is looking for.
   */
  const workspace = conversation?.extra?.workspace;

  return (
    <div className='flex h-full items-center justify-center px-24px' data-testid='chat-slider-no-project'>
      <span className='text-12px text-t-secondary text-center leading-relaxed break-all'>
        {workspace ? t('conversation.workspaceNotAProject', { path: workspace }) : t('conversation.workspaceNoProject')}
      </span>
    </div>
  );
};

export default ChatSlider;
