/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';

export type WorkspaceGroup = {
  workspace: string;
  display_name: string;
  conversations: TChatConversation[];
};

export type TimelineItem = {
  type: 'workspace' | 'conversation';
  time: number;
  workspaceGroup?: WorkspaceGroup;
  conversation?: TChatConversation;
};

export type TimelineSection = {
  timeline: string;
  items: TimelineItem[];
};

export type GroupedHistoryResult = {
  pinnedConversations: TChatConversation[];
  timelineSections: TimelineSection[];
};

export type ExportZipFile = {
  name: string;
  content?: string;
  sourcePath?: string;
};

export type ExportTask =
  | { mode: 'single'; conversation: TChatConversation }
  | { mode: 'batch'; conversation_ids: string[] }
  | null;

export type ConversationRowProps = {
  conversation: TChatConversation;
  isGenerating: boolean;
  hasUnread: boolean;
  /** Whether the user manually marked this conversation as unread (persisted). */
  isManualUnread: boolean;
  collapsed: boolean;
  tooltipEnabled: boolean;
  batchMode: boolean;
  checked: boolean;
  selected: boolean;
  menuVisible: boolean;
  onToggleChecked: (conversation: TChatConversation) => void;
  onConversationClick: (conversation: TChatConversation) => void;
  onOpenMenu: (conversation: TChatConversation) => void;
  onMenuVisibleChange: (conversation_id: string, visible: boolean) => void;
  onEditStart: (conversation: TChatConversation) => void;
  onCreateCronTask: (conversation: TChatConversation) => void;
  onDelete: (conversation_id: string) => void;
  onExport?: (conversation: TChatConversation) => void;
  onTogglePin: (conversation: TChatConversation) => void;
  onToggleManualUnread: (conversation: TChatConversation) => void;
  getJobStatus: (conversation_id: string) => 'none' | 'active' | 'paused' | 'error' | 'unread';
  /** Resolve a loaded conversation's name by id (fork-lineage badge tooltip). */
  resolveConversationName?: (conversation_id: string) => string | undefined;
  /** When true, the agent icon is dimmed by default and only shows full color on hover. Used inside project folders to reduce visual weight. */
  dimIcon?: boolean;
  /**
   * When true, renders a second line under the title with the conversation's
   * last-activity date and model — used only by the Session Center's history
   * list, where rows have room to spare. Sidebar/project-folder rows never
   * pass this and keep the compact single-line layout.
   */
  detailed?: boolean;
  /**
   * This conversation's most recent media generation, if any — keyed by
   * conversation id from the media job history (see `useMediaJobs()`), not
   * from `conversation.model`. A conversation's current model selection is
   * whatever the send box happens to be pointed at right now; it says nothing
   * about what actually ran, or which model ran it. Only `detailed` rows read
   * this — both the mode column and, when present, the model column defer to
   * it over `conversation.model`.
   */
  latestMedia?: { kind: 'image' | 'video'; model: string };
};

export type WorkspaceGroupedHistoryProps = {
  onSessionClick?: () => void;
  collapsed?: boolean;
  tooltipEnabled?: boolean;
  batchMode?: boolean;
  onBatchModeChange?: (value: boolean) => void;
};

export type DragItemType = 'conversation' | 'workspace';

export type DragItem = {
  type: DragItemType;
  id: string;
  conversation?: TChatConversation;
  workspaceGroup?: WorkspaceGroup;
  sourceSection: 'pinned' | string;
  sourceWorkspace?: string;
};
