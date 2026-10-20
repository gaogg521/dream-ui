/**
 * Copyright 2026 One Work
 */

import styles from '../index.module.css';
import { resolveAssistantName } from '@/renderer/utils/model/assistantDisplay';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Down, Robot } from '@icon-park/react';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveAssistantAvatar } from '@/renderer/utils/model/assistantAvatar';
import { splitBackendPills } from '../utils/backendPills';

type BackendSelectionAreaProps = {
  /** Full assistant list — filtered down to bare CLIs (`source === 'generated'`) internally. */
  assistants: Assistant[];
  selectedBackendAgentId: string | null;
  localeKey: string;
  onSelectBackend: (agentId: string) => void;
  /** The person's own priority order (drag order of the enabled assistants); first ones are shown. */
  preferredOrder?: readonly string[];
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
  preferredOrder,
}) => {
  const { t } = useTranslation();
  const { visible: backends, overflow } = useMemo(
    () => splitBackendPills(assistants, preferredOrder, selectedBackendAgentId),
    [assistants, preferredOrder, selectedBackendAgentId]
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
            {overflow.length > 0 && (
              <Dropdown
                trigger='click'
                position='bl'
                droplist={
                  <Menu
                    data-testid='backend-more-menu'
                    style={{ maxHeight: 360, overflowY: 'auto' }}
                    onClickMenuItem={(agentId) => onSelectBackend(agentId)}
                  >
                    {overflow.map((assistant) => {
                      const isAvailable = assistant.agent_status === 'online';
                      return (
                        <Menu.Item
                          key={assistant.agent_id}
                          data-testid={`backend-more-${assistant.agent_id}`}
                          disabled={!isAvailable}
                          title={!isAvailable ? assistant.agent_status_message || undefined : undefined}
                        >
                          {resolveAssistantName(assistant, localeKey)}
                        </Menu.Item>
                      );
                    })}
                  </Menu>
                }
              >
                <Button
                  data-testid='backend-more'
                  type='text'
                  size='mini'
                  className={`!inline-flex !min-w-0 !h-auto !items-center !gap-4px !rounded-999px !border-none !px-10px !py-6px !text-12px text-t-secondary opacity-75 hover:opacity-100 ${styles.assistantSelectorInactive}`}
                  style={{ background: 'transparent' }}
                >
                  <span className='whitespace-nowrap'>{t('common.more')}</span>
                  <span className='text-t-tertiary'>{overflow.length}</span>
                  <Down theme='outline' size={12} />
                </Button>
              </Dropdown>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackendSelectionArea;
