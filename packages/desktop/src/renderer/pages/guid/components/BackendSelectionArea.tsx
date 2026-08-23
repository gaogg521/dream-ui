/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import styles from '../index.module.css';
import { resolveAssistantName } from '@/renderer/utils/model/assistantDisplay';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Robot } from '@icon-park/react';
import { Button, Tooltip } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { resolveAssistantAvatar } from '@/renderer/utils/model/assistantAvatar';
import { isInstalledGeneratedCliAssistant } from '@/renderer/utils/model/assistantSelection';

type BackendSelectionAreaProps = {
  /** Full assistant list — filtered down to bare CLIs (`source === 'generated'`) internally. */
  assistants: Assistant[];
  selectedBackendAgentId: string | null;
  localeKey: string;
  onSelectBackend: (agentId: string) => void;
};

/**
 * Always-visible row for choosing which installed CLI backend the next
 * conversation runs under — independent of which persona/assistant is
 * selected below it. See `useGuidAssistantSelection.setSelectedBackendAgentId`.
 */
const BackendSelectionArea: React.FC<BackendSelectionAreaProps> = ({
  assistants,
  selectedBackendAgentId,
  localeKey,
  onSelectBackend,
}) => {
  const backends = useMemo(
    () =>
      assistants
        .filter((assistant) => assistant.source === 'generated' && assistant.enabled !== false)
        .filter(isInstalledGeneratedCliAssistant)
        .sort((a, b) => a.sort_order - b.sort_order),
    [assistants]
  );

  if (backends.length === 0) return null;

  return (
    <div className='mt-10px mb-6px w-full'>
      <div className='flex w-full justify-center'>
        <div
          className='inline-flex max-w-full items-center rounded-999px px-6px py-6px'
          style={{ background: 'var(--color-guid-agent-bar, var(--aou-2))' }}
        >
          <div className='flex min-w-0 max-w-full items-center gap-6px'>
            {backends.map((assistant) => {
              const avatar = resolveAssistantAvatar(assistant.avatar);
              const isSelected = selectedBackendAgentId === assistant.agent_id;
              const isAvailable = assistant.agent_status === 'online';
              const label = resolveAssistantName(assistant, localeKey);

              return (
                <Tooltip
                  key={assistant.agent_id}
                  content={!isAvailable ? assistant.agent_status_message || `${label} is unavailable` : undefined}
                >
                  <span className='inline-flex'>
                    <Button
                      data-testid={`backend-pill-${assistant.agent_id}`}
                      data-agent-id={assistant.agent_id}
                      data-backend-selected={isSelected ? 'true' : 'false'}
                      data-backend-available={isAvailable ? 'true' : 'false'}
                      type='text'
                      size='mini'
                      disabled={!isAvailable}
                      className={`!inline-flex !min-w-0 !h-auto !items-center !gap-6px !rounded-999px !border-none !px-10px !py-6px !text-12px transition-all ${
                        isSelected
                          ? `font-600 !text-white shadow-sm ${styles.agentSelectorActive}`
                          : `text-t-secondary opacity-75 hover:opacity-100 ${styles.assistantSelectorInactive}`
                      }`}
                      style={
                        isSelected
                          ? { background: 'rgb(var(--success-6))', color: '#fff' }
                          : { background: 'transparent' }
                      }
                      onClick={() => onSelectBackend(assistant.agent_id)}
                    >
                      <span className='inline-flex h-16px w-16px items-center justify-center overflow-hidden rounded-999px bg-fill-2'>
                        {avatar.kind === 'image' ? (
                          <img src={avatar.value} alt='' className='h-full w-full object-contain' />
                        ) : avatar.kind === 'emoji' ? (
                          <span className={styles.assistantCardEmoji}>{avatar.value}</span>
                        ) : (
                          <Robot theme='outline' size={12} />
                        )}
                      </span>
                      <span className='max-w-140px truncate whitespace-nowrap'>{label}</span>
                    </Button>
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackendSelectionArea;
