/**
 * Enterprise collaboration context strip — shows which org capabilities
 * (RAG knowledge, registered skills, MCP connectors) the current issue /
 * collaboration flow can draw on. Port of the 1one
 * EnterpriseCollaborationContextPanel; `onOpenRegistries` links to the
 * registries management tab.
 */

import React from 'react';
import { Button, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CollaborationContext } from '../hooks/useCollaborationContext';

type CollaborationContextPanelProps = {
  issueSubject?: string | null;
  context: CollaborationContext;
  onOpenRegistries?: () => void;
};

const CollaborationContextPanel: React.FC<CollaborationContextPanelProps> = ({
  issueSubject,
  context,
  onOpenRegistries,
}) => {
  const { t } = useTranslation();

  if (context.loading) {
    return <div className='text-12px text-t-tertiary'>{t('common.loading', { defaultValue: '请稍候...' })}</div>;
  }

  return (
    <div className='flex flex-col gap-8px'>
      {issueSubject ? (
        <div className='text-12px text-t-secondary'>
          {t('common.superAssistant.collaborationContext.issueBinding', {
            defaultValue: '当前 Issue「{{subject}}」可调用以下企业能力：',
            subject: issueSubject,
          })}
        </div>
      ) : (
        <div className='text-12px text-t-secondary'>
          {t('common.superAssistant.collaborationContext.globalHint', {
            defaultValue: '协作流可调用以下企业知识与工具：',
          })}
        </div>
      )}

      <div className='flex flex-wrap items-center gap-6px'>
        {/* "Not ready" read as "this feature is broken"; the tag only ever means
            "no documents uploaded yet", so say that and offer the way to fix it —
            matching the neutral "no Skills / no MCP" wording beside it. */}
        <Tag
          size='small'
          color={context.ragReady ? 'green' : 'gray'}
          className={!context.ragReady && onOpenRegistries ? 'cursor-pointer' : undefined}
          onClick={!context.ragReady && onOpenRegistries ? onOpenRegistries : undefined}
        >
          {context.ragReady
            ? t('common.superAssistant.collaborationContext.ragReady', {
                defaultValue: '知识库 {{count}} 篇',
                count: context.ragDocumentCount,
              })
            : t('common.superAssistant.collaborationContext.ragEmpty', { defaultValue: '知识库为空，去上传' })}
        </Tag>
        {context.skillNames.length > 0 ? (
          context.skillNames.map((name) => (
            <Tag key={name} size='small' color='arcoblue'>
              {name}
            </Tag>
          ))
        ) : (
          <Tag size='small' color='gray'>
            {t('common.superAssistant.collaborationContext.noSkills', { defaultValue: '暂无 Skills' })}
          </Tag>
        )}
        {context.mcpNames.length > 0 ? (
          context.mcpNames.map((name) => (
            <Tag key={name} size='small' color='purple'>
              {name}
            </Tag>
          ))
        ) : (
          <Tag size='small' color='gray'>
            {t('common.superAssistant.collaborationContext.noMcp', { defaultValue: '暂无 MCP' })}
          </Tag>
        )}
        {context.skillCount > context.skillNames.length ? (
          <span className='text-11px text-t-tertiary'>
            {t('common.superAssistant.collaborationContext.moreSkills', {
              defaultValue: '+{{count}} Skills',
              count: context.skillCount - context.skillNames.length,
            })}
          </span>
        ) : null}
        {context.enabledMcpCount > context.mcpNames.length ? (
          <span className='text-11px text-t-tertiary'>
            {t('common.superAssistant.collaborationContext.moreMcp', {
              defaultValue: '+{{count}} MCP',
              count: context.enabledMcpCount - context.mcpNames.length,
            })}
          </span>
        ) : null}
        {onOpenRegistries ? (
          <Button size='mini' type='text' onClick={onOpenRegistries}>
            {t('common.superAssistant.collaborationContext.manageRegistries', { defaultValue: '管理资源' })}
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export default CollaborationContextPanel;
