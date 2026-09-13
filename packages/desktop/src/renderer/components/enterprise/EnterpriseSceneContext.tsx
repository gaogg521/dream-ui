/** Read-only enterprise scene context for conversation composers. */
import { ipcBridge } from '@/common';
import { isEnterpriseRemoteActive } from '@/common/adapter/enterpriseMode';
import type { MyScene, MySceneResourceSummary } from '@/common/types/platform/enterpriseTypes';
import { useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';
import { Button, Dropdown, Tag } from '@arco-design/web-react';
import { Down, MagicWand } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

const ScenePanel: React.FC<{ scenes: MyScene[] }> = ({ scenes }) => {
  const { t } = useTranslation();
  const resourceLabel = (summary: MySceneResourceSummary): string => {
    const type = t(`common.scenes.resourceType.${summary.resourceType}`, { defaultValue: summary.resourceType });
    return summary.includesAll
      ? `${type} · ${t('common.scenes.resourceAll', { defaultValue: '全部' })}`
      : `${type} ×${summary.count}`;
  };

  return (
    <div className='w-360px max-w-[calc(100vw-24px)] overflow-hidden rd-12px border border-border-2 bg-bg-1 shadow-lg'>
      <div className='border-b border-border-2 px-14px py-12px'>
        <div className='text-14px font-600 text-t-primary'>
          {t('common.scenes.conversationTitle', { defaultValue: '企业场景' })}
        </div>
        <div className='mt-3px text-11px leading-17px text-t-tertiary'>
          {t('common.scenes.conversationHint', {
            defaultValue: '以下场景的职能与资源包已叠加到当前账号，在所有会话中自动生效。',
          })}
        </div>
      </div>
      <div className='max-h-340px overflow-y-auto p-8px'>
        {scenes.length === 0 ? (
          <div className='px-8px py-20px text-center text-12px text-t-tertiary'>
            {t('common.scenes.empty', {
              defaultValue: '尚未加入任何场景。管理员可在控制台把你加入场景，一次获得整包协作资源。',
            })}
          </div>
        ) : (
          <div className='flex flex-col gap-6px'>
            {scenes.map((scene) => (
              <div key={scene.id} className='rd-8px px-10px py-9px hover:bg-fill-2' data-scene-name={scene.name}>
                <div className='flex min-w-0 items-center gap-6px'>
                  <span className='truncate text-13px font-600 text-t-primary'>{scene.name}</span>
                  {scene.builtIn && (
                    <Tag size='small' color='arcoblue'>
                      {t('common.scenes.builtinTag', { defaultValue: '内置' })}
                    </Tag>
                  )}
                </div>
                {scene.description && <div className='mt-3px text-11px text-t-secondary'>{scene.description}</div>}
                {scene.jobFunctions.length > 0 && (
                  <div className='mt-6px flex flex-wrap gap-4px'>
                    {scene.jobFunctions.map((job) => (
                      <Tag key={job} size='small'>
                        {job}
                      </Tag>
                    ))}
                  </div>
                )}
                <div className='mt-6px flex flex-wrap gap-4px'>
                  {scene.resources.length > 0 ? (
                    scene.resources.map((summary) => (
                      <Tag key={summary.resourceType} size='small' color='green'>
                        {resourceLabel(summary)}
                      </Tag>
                    ))
                  ) : (
                    <span className='text-11px text-t-tertiary'>
                      {t('common.scenes.noResources', { defaultValue: '该场景暂未配置授权包' })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const EnterpriseSceneContext: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { t } = useTranslation();
  const { context } = useOrgContext();
  const active = Boolean(context?.isEnterprise && isEnterpriseRemoteActive());
  const tenantId = context?.tenantId ?? '';
  const { data: scenes } = useSWR<MyScene[]>(
    active ? ['enterprise-conversation-scenes', tenantId] : null,
    () => ipcBridge.onePlatform.myScenes.invoke(),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  if (!active || !scenes) return null;
  const label =
    scenes.length > 0
      ? t('common.scenes.conversationCount', { count: scenes.length, defaultValue: '企业场景 · {{count}}' })
      : t('common.scenes.conversationNone', { defaultValue: '企业场景 · 未加入' });

  return (
    <Dropdown position='top' trigger='click' droplist={<ScenePanel scenes={scenes} />}>
      <Button
        type='text'
        size='mini'
        className={compact ? '!px-6px !text-t-tertiary' : '!px-6px !text-t-secondary'}
        data-testid='enterprise-scene-context'
        icon={<MagicWand theme='outline' size='13' />}
      >
        <span className='inline-flex items-center gap-3px'>
          {label}
          <Down theme='outline' size='10' />
        </span>
      </Button>
    </Dropdown>
  );
};

export default EnterpriseSceneContext;
