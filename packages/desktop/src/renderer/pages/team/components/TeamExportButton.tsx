/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Tooltip } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TTeam } from '@/common/types/team/teamTypes';
import { formatTimestamp, sanitizeFileName } from '@/renderer/utils/chat/conversationExport';
import { downloadTextContent } from '@/renderer/utils/file/download';
import { useTeamTabs } from '../hooks/TeamTabsContext';
import {
  collectTeamTranscript,
  type TranscriptMemberInput,
  type TranscriptProgress,
} from '../export/collectTeamTranscript';
import { renderTeamTranscriptHtml } from '../export/renderTeamTranscriptHtml';
import { buildTranscriptLabels } from '../export/transcriptLabels';

type Props = {
  team: TTeam;
};

/**
 * 身份色板里 Leader 用的是 `var(--brand)`，随主题变化。产物离开应用后没有这些变量，
 * 所以导出时按当前主题解析成字面值。
 */
const resolveCssColor = (value: string): string => {
  const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
  if (!match) return value;
  if (typeof window === 'undefined') return value;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return resolved || '#2f6fed';
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * 「导出记录」——把整支团队所有成员的历史消息拉全，渲染成一份离线单文件 HTML。
 *
 * 产物同时提供「多列复刻」与「全局时间线」两种视图，工具调用详情全量保留（默认折叠），
 * 图片内嵌为 data URI。
 */
const TeamExportButton: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const { assistants, colorOf } = useTeamTabs();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const handleExport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProgress('');
    try {
      const labels = buildTranscriptLabels((key, options) => String(t(key as never, options as never)));
      const members: TranscriptMemberInput[] = assistants.map((assistant) => ({
        slot_id: assistant.slot_id,
        conversation_id: assistant.conversation_id,
        name: assistant.assistant_name,
        backend: assistant.assistant_backend,
        model: assistant.model,
        isLeader: assistant.role === 'leader',
        color: resolveCssColor(colorOf(assistant.slot_id)),
      }));
      const exportedAt = Date.now();
      const onProgress = (state: TranscriptProgress) => {
        setProgress(`${state.done}/${state.total}`);
      };

      const transcript = await collectTeamTranscript({
        team: {
          id: team.id,
          name: team.name,
          workspace: team.workspace || undefined,
          session_mode: team.session_mode,
          created_at: team.created_at,
        },
        members,
        includeImages: true,
        exportedAt,
        onProgress,
      });

      const total = transcript.members.reduce((sum, member) => sum + member.messageCount, 0);
      if (total === 0) {
        Message.warning(t('team.export.empty', { defaultValue: 'This team has no messages to export yet.' }));
        return;
      }

      const html = renderTeamTranscriptHtml(transcript, labels);
      const fileName = `${sanitizeFileName(team.name)}-${formatTimestamp(exportedAt)}.html`;
      downloadTextContent(html, fileName, 'text/html;charset=utf-8');
      Message.success(
        t('team.export.success', {
          defaultValue: 'Exported {{total}} messages ({{size}}).',
          total,
          size: formatSize(new Blob([html]).size),
        })
      );
    } catch (error) {
      Message.error(
        t('team.export.failed', {
          defaultValue: 'Export failed: {{reason}}',
          reason: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setBusy(false);
      setProgress('');
    }
  }, [assistants, busy, colorOf, t, team]);

  const label = t('team.export.action', { defaultValue: 'Export transcript' });

  return (
    <Tooltip content={label}>
      <Button
        type='text'
        size='mini'
        loading={busy}
        data-testid='team-export-button'
        aria-label={label}
        onClick={() => void handleExport()}
        icon={busy ? undefined : <Download theme='outline' size='15' fill='currentColor' />}
      >
        <span className='text-12px'>{busy && progress ? progress : label}</span>
      </Button>
    </Tooltip>
  );
};

export default TeamExportButton;
