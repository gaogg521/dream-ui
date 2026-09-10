/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationMcpStatus, IConversationMcpStatusKind } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import { Button, Message, Tooltip, Trigger } from '@arco-design/web-react';
import { FolderOpen, Lightning, Paperclip, Plus, Right, Shield } from '@icon-park/react';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { FileService } from '@/renderer/services/FileService';
import type { FileMetadata } from '@/renderer/services/FileService';
import { emitter } from '@/renderer/utils/emitter';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

interface FileAttachButtonProps {
  openFileSelector: (imagesOnly?: boolean) => void;
  onLocalFilesAdded?: (files: FileMetadata[]) => void;
  loadedSkills?: string[];
  loadedMcpStatuses?: IConversationMcpStatus[];
  /**
   * Media mode: the attachment becomes a reference image for the generation,
   * not a document for the agent. Says so, restricts the device picker to
   * images, and drops the skills / MCP sections — media mode short-circuits the
   * agent, so neither applies to the next send.
   */
  referenceOnly?: boolean;
}

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  suffix?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  title?: string;
}> = ({ icon, label, description, suffix, onClick, className = '', title }) => (
  <div
    className={`flex items-center gap-10px px-12px py-9px rounded-8px cursor-pointer hover:bg-fill-2 transition-colors text-14px text-t-primary select-none ${className}`}
    onClick={onClick}
    title={title}
  >
    <span className='flex-shrink-0 inline-flex items-center justify-center text-t-tertiary w-18px leading-none'>
      {icon}
    </span>
    <span className='min-w-0 flex-1'>
      <span className='block leading-none'>{label}</span>
      {description ? <span className='mt-4px block text-12px leading-16px text-t-secondary'>{description}</span> : null}
    </span>
    {suffix}
  </div>
);

const MCP_STATUS_CLASS_NAME: Record<IConversationMcpStatusKind, string> = {
  loaded: 'text-[var(--color-success-6)]',
  failed: 'text-[var(--color-danger-6)]',
  unsupported: 'text-[var(--color-warning-6)]',
};

const buildLoadedMcpStatuses = (
  statuses?: IConversationMcpStatus[],
  legacyNames?: string[]
): IConversationMcpStatus[] => {
  if (Array.isArray(statuses) && statuses.length > 0) {
    return statuses;
  }

  return (legacyNames ?? []).map((name) => ({
    id: name,
    name,
    status: 'loaded',
  }));
};

const FileAttachButton: React.FC<FileAttachButtonProps> = ({
  openFileSelector,
  onLocalFilesAdded,
  loadedSkills,
  loadedMcpStatuses,
  referenceOnly = false,
}) => {
  const conversationContext = useConversationContextSafe();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);

  const skillNames = loadedSkills ?? conversationContext?.loadedSkills ?? [];
  const mcpStatuses = buildLoadedMcpStatuses(
    loadedMcpStatuses ?? conversationContext?.loadedMcpStatuses,
    conversationContext?.loadedMcpServers
  );
  const { data: skillIndex } = useSWR(skillNames.length > 0 ? 'skills-index' : null, () =>
    ipcBridge.fs.listAvailableSkills.invoke()
  );
  const descriptionByName = new Map((skillIndex ?? []).map((s) => [s.name, s.description]));
  const metaByName = new Map((skillIndex ?? []).map((s) => [s.name, s]));
  const [skillQuery, setSkillQuery] = useState('');
  const filteredSkillNames = useMemo(() => {
    const keyword = skillQuery.trim().toLowerCase();
    if (!keyword) return skillNames;
    return skillNames.filter((name) => {
      const meta = metaByName.get(name);
      return name.toLowerCase().includes(keyword) || (meta?.display_name ?? '').toLowerCase().includes(keyword);
    });
  }, [skillNames, skillQuery]);

  const handleSkillClick = useCallback((name: string) => {
    setOpen(false);
    emitter.emit('sendbox.fill', `/${name} `);
  }, []);

  const handleOpenMcpSettings = useCallback(() => {
    setOpen(false);
    setSkillsOpen(false);
    setMcpOpen(false);
    void navigate('/settings/tools');
  }, [navigate]);

  const handleLocalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0 || !onLocalFilesAdded) return;
      setUploading(true);
      try {
        const processed = await FileService.processDroppedFiles(fileList, conversationContext?.conversation_id);
        if (processed.length > 0) onLocalFilesAdded(processed);
      } catch {
        Message.error(t('common.fileAttach.failed'));
      } finally {
        setUploading(false);
      }
      e.target.value = '';
    },
    [conversationContext?.conversation_id, onLocalFilesAdded, t]
  );

  const isDesktop = isElectronDesktop();
  const hasSkills = skillNames.length > 0 && !referenceOnly;
  const hasMcpServers = mcpStatuses.length > 0 && !referenceOnly;
  const plusIcon = <Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />;

  if (isDesktop && !hasSkills && !hasMcpServers) {
    return (
      <Button
        type='secondary'
        shape='circle'
        icon={plusIcon}
        onClick={() => openFileSelector(referenceOnly)}
        data-testid='dream-engine-attach-folder-btn'
      />
    );
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-bg-2, #fff)',
    borderRadius: 12,
    boxShadow: '0 4px 24px rgba(0,0,0,0.13)',
    border: '1px solid var(--color-border-1, #e5e6eb)',
    padding: '6px 0',
    minWidth: 220,
    zIndex: 1050,
  };

  const skillsPanel = (
    <div style={{ ...cardStyle, width: 400 }} onClick={(e) => e.stopPropagation()}>
      <div className='px-6px pt-6px pb-4px'>
        <input
          value={skillQuery}
          onChange={(e) => setSkillQuery(e.target.value)}
          placeholder={t('settings.skillsHub.searchPlaceholder', { defaultValue: 'Search skills...' })}
          data-testid='conversation-skill-search'
          className='w-full h-32px bg-fill-1 hover:bg-fill-2 border border-border-1 focus:border-primary-5 focus:bg-base outline-none rd-8px px-10px text-13px text-t-primary placeholder:text-t-tertiary transition-all box-border m-0'
        />
      </div>
      <div className='max-h-360px overflow-y-auto px-6px pb-8px'>
        {filteredSkillNames.length === 0 ? (
          <div className='px-12px py-10px text-12px text-t-tertiary text-center'>
            {t('settings.skillsHub.noSearchResults', { defaultValue: 'No matching skills.' })}
          </div>
        ) : (
          <div className='grid grid-cols-3 gap-x-3px gap-y-2px' data-testid='conversation-skills-grid'>
            {filteredSkillNames.map((name) => {
              const meta = metaByName.get(name);
              const label = meta?.display_name || name;
              const description = descriptionByName.get(name) ?? '';
              return (
                <Tooltip
                  key={name}
                  position='right'
                  content={
                    <div className='max-w-260px'>
                      <div className='mb-2px text-12px font-600'>{label}</div>
                      <div className='text-12px leading-relaxed break-words'>{description}</div>
                    </div>
                  }
                >
                  <button
                    type='button'
                    aria-label={`${label}：${description}`}
                    title={`${label} (${name})`}
                    data-testid={`conversation-skill-cell-${name}`}
                    onClick={() => handleSkillClick(name)}
                    className='relative flex cursor-pointer select-none flex-col items-center gap-3px rounded-10px border-none bg-transparent px-4px py-5px text-center transition-colors hover:bg-fill-2'
                  >
                    {meta?.icon_file ? (
                      <img
                        src={resolveExtensionAssetUrl(`/api/skills/${encodeURIComponent(name)}/icon`)}
                        alt=''
                        className='h-28px w-28px rounded-999px object-cover'
                        loading='lazy'
                      />
                    ) : (
                      <span className='flex h-28px w-28px items-center justify-center rounded-999px bg-fill-2 text-13px font-600 text-t-secondary'>
                        {label.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className='w-full truncate text-12px text-t-primary'>{label}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const mcpPanel = (
    <div
      style={{
        ...cardStyle,
        minWidth: 220,
        width: 'min(320px, calc(100vw - 96px))',
        maxWidth: 320,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {mcpStatuses.map((item) => (
        <MenuItem
          key={`${item.id}-${item.status}`}
          icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
          label={item.name}
          suffix={
            item.status === 'loaded' ? undefined : (
              <span className={`text-12px leading-none ${MCP_STATUS_CLASS_NAME[item.status]}`}>
                {t(`conversation.mcp.status.${item.status}` as const)}
              </span>
            )
          }
          className='mx-6px cursor-default hover:bg-transparent'
          title={item.reason}
        />
      ))}
      <div style={{ margin: '4px 12px', height: 1, backgroundColor: 'var(--color-border-1, #e5e6eb)' }} />
      <div className='px-12px py-8px'>
        <div className='text-12px leading-16px text-t-secondary whitespace-normal break-words'>
          {t('conversation.mcp.managementHint', {
            defaultValue:
              'If an MCP looks abnormal, it is usually caused by the MCP JSON configuration. Go to Tools settings and test it there.',
          })}
        </div>
        <Button
          type='text'
          size='mini'
          className='mt-6px h-auto! px-0! text-12px! inline-flex! items-center! gap-4px!'
          onClick={handleOpenMcpSettings}
        >
          <span className='leading-none'>
            {t('conversation.mcp.openSettings', {
              defaultValue: 'Open Tools settings',
            })}
          </span>
          <span className='inline-flex h-12px w-12px flex-shrink-0 items-center justify-center'>
            <Right theme='outline' size={12} strokeWidth={3} className='block' />
          </span>
        </Button>
      </div>
    </div>
  );

  const menu = (
    <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
      {/* Loaded items stay above file actions so the session snapshot is visible */}
      {(hasMcpServers || hasSkills) && (
        <>
          {hasMcpServers && (
            <div className='px-6px'>
              <Trigger
                popup={() => mcpPanel}
                trigger='hover'
                position='right'
                popupVisible={mcpOpen}
                onVisibleChange={setMcpOpen}
                mouseEnterDelay={100}
                mouseLeaveDelay={150}
              >
                <div>
                  <MenuItem
                    icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
                    label={`${t('conversation.mcp.selected', { defaultValue: 'Selected MCP' })} · ${mcpStatuses.length}`}
                    suffix={
                      <Right theme='outline' size={12} strokeWidth={3} style={{ color: 'var(--text-disabled)' }} />
                    }
                  />
                </div>
              </Trigger>
            </div>
          )}
          {hasSkills && (
            <div className='px-6px'>
              <Trigger
                popup={() => skillsPanel}
                trigger='hover'
                position='right'
                popupVisible={skillsOpen}
                onVisibleChange={setSkillsOpen}
                mouseEnterDelay={100}
                mouseLeaveDelay={150}
              >
                <div>
                  <MenuItem
                    icon={<Lightning theme='outline' size={15} strokeWidth={2.5} />}
                    label={`${t('common.selectedSkills', { defaultValue: 'Selected skills' })} · ${skillNames.length}`}
                    suffix={
                      <Right theme='outline' size={12} strokeWidth={3} style={{ color: 'var(--text-disabled)' }} />
                    }
                  />
                </div>
              </Trigger>
            </div>
          )}
          <div style={{ margin: '4px 12px', height: 1, backgroundColor: 'var(--color-border-1, #e5e6eb)' }} />
        </>
      )}

      {/* 文件操作最常用，在最下（离 + 最近） */}
      <div className='px-6px'>
        {!isDesktop && (
          <MenuItem
            icon={<FolderOpen theme='outline' size={15} strokeWidth={2.5} />}
            label={t('common.fileAttach.myDevice', { defaultValue: 'Upload from device' })}
            onClick={() => {
              fileInputRef.current?.click();
              setOpen(false);
            }}
          />
        )}
        <MenuItem
          icon={<Paperclip theme='outline' size={15} strokeWidth={2.5} />}
          label={
            referenceOnly
              ? t('common.fileAttach.addReferenceImage', { defaultValue: 'Add reference image' })
              : t('common.fileAttach.addFiles', { defaultValue: 'Add files' })
          }
          onClick={() => {
            openFileSelector(referenceOnly);
            setOpen(false);
          }}
        />
      </div>
    </div>
  );

  return (
    <>
      <Trigger
        popup={() => menu}
        trigger='click'
        position='tl'
        popupVisible={open}
        onVisibleChange={setOpen}
        clickToClose
        popupAlign={{ bottom: 8 }}
      >
        <Button
          type='secondary'
          shape='circle'
          icon={plusIcon}
          loading={uploading}
          disabled={uploading}
          data-testid='dream-engine-attach-folder-btn'
        />
      </Trigger>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        // Only a hint to the OS picker — a user can still force any file
        // through, which is why the send path filters as well.
        accept={referenceOnly ? 'image/*' : undefined}
        style={{ display: 'none' }}
        onChange={handleLocalFileChange}
        data-testid='dream-file-upload-input'
      />
    </>
  );
};

export default FileAttachButton;
