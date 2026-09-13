/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Enterprise scenes, as a standing card grid under the Guid composer.
 *
 * Replaces the footnote pill + upward-opening dropdown this used to be: the
 * panel was anchored to a trigger sitting on the composer's bottom edge, so
 * "open above the trigger" meant "cover the textarea the user was about to
 * type in". The grid borrows the assistant-picker's visual language and lives
 * in the flow below the card, where it can never occlude anything.
 *
 * Read-only by design — a scene is granted by an admin in the console, not
 * picked here, so the cards state what the account already carries rather than
 * offering an action that would 403.
 */

import { ipcBridge } from '@/common';
import { isEnterpriseRemoteActive } from '@/common/adapter/enterpriseMode';
import type { MyScene, MySceneResourceSummary } from '@/common/types/platform/enterpriseTypes';
import { useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';
import { Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import officeAvatar from '@/renderer/assets/scenes/office.png';
import itOpsAvatar from '@/renderer/assets/scenes/it-ops.png';
import securityAvatar from '@/renderer/assets/scenes/cybersecurity.png';
import mediaAvatar from '@/renderer/assets/scenes/media-ops.png';
import marketingAvatar from '@/renderer/assets/scenes/marketing.png';

const BUILTIN_AVATARS: Record<string, string> = {
  办公: officeAvatar,
  IT运维: itOpsAvatar,
  网络安全: securityAvatar,
  新媒体运营: mediaAvatar,
  市场营销: marketingAvatar,
};

const SceneCard: React.FC<{ scene: MyScene }> = ({ scene }) => {
  const { t } = useTranslation();
  const resourceLabel = (summary: MySceneResourceSummary): string => {
    const type = t(`common.scenes.resourceType.${summary.resourceType}`, { defaultValue: summary.resourceType });
    return summary.includesAll
      ? `${type} · ${t('common.scenes.resourceAll', { defaultValue: '全部' })}`
      : `${type} ×${summary.count}`;
  };

  return (
    <div
      className='min-w-0 rd-10px border border-border-2 bg-bg-1 px-11px py-10px transition-colors hover:border-border-3 hover:bg-fill-1'
      data-scene-name={scene.name}
    >
      <div className='flex min-w-0 items-center gap-8px'>
        <img
          src={scene.avatarRef || BUILTIN_AVATARS[scene.name] || officeAvatar}
          alt=''
          className='h-28px w-28px shrink-0 rd-8px border border-border-2 object-cover'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-5px'>
            <span className='truncate text-12.5px font-600 text-t-primary'>{scene.name}</span>
            {scene.builtIn && (
              <Tag size='small' color='arcoblue'>
                {t('common.scenes.builtinTag', { defaultValue: '内置' })}
              </Tag>
            )}
          </div>
          {scene.description ? (
            <div className='truncate text-11px leading-16px text-t-tertiary' title={scene.description}>
              {scene.description}
            </div>
          ) : null}
        </div>
      </div>

      {scene.jobFunctions.length > 0 && (
        <div className='mt-7px flex flex-wrap gap-4px'>
          {scene.jobFunctions.map((job) => (
            <Tag key={job} size='small'>
              {job}
            </Tag>
          ))}
        </div>
      )}

      <div className='mt-5px flex flex-wrap gap-4px'>
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
  );
};

const EnterpriseSceneGrid: React.FC = () => {
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

  return (
    <div className='mt-18px w-full animate-fade-in' data-testid='enterprise-scene-grid'>
      <div className='mb-9px text-center text-12.5px text-t-tertiary'>
        {scenes.length > 0
          ? t('common.scenes.conversationHint', {
              defaultValue: '以下场景的职能与资源包已叠加到当前账号，在所有会话中自动生效。',
            })
          : t('common.scenes.empty', {
              defaultValue: '尚未加入任何场景。管理员可在控制台把你加入场景，一次获得整包协作资源。',
            })}
      </div>
      {scenes.length > 0 && (
        <div className='grid grid-cols-1 gap-8px sm:grid-cols-2 lg:grid-cols-3'>
          {scenes.map((scene) => (
            <SceneCard key={scene.id} scene={scene} />
          ))}
        </div>
      )}
    </div>
  );
};

export default EnterpriseSceneGrid;
