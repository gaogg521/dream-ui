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
  /**
   * Just the amount. The resource *type* is rendered separately in a muted
   * tone so the eye can scan the numbers down a column — "技能 全部 / 工具 3"
   * reads faster than four identically-weighted pills.
   */
  const resourceValue = (summary: MySceneResourceSummary): string =>
    summary.includesAll ? t('common.scenes.resourceAll', { defaultValue: '全部' }) : String(summary.count);

  return (
    <div
      className='group min-w-0 flex flex-col gap-10px rd-14px border border-3 bg-1 p-14px
                 transition-all duration-150 hover:-translate-y-2px hover:border-primary hover:shadow-lg'
      data-scene-name={scene.name}
    >
      {/* Identity row: the avatar carries the card, so it is sized like a
          subject rather than a bullet. */}
      <div className='flex min-w-0 items-start gap-10px'>
        <img
          src={scene.avatarRef || BUILTIN_AVATARS[scene.name] || officeAvatar}
          alt=''
          className='h-40px w-40px shrink-0 rd-12px border border-3 object-cover transition-colors
                     group-hover:border-primary'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-6px'>
            <span className='truncate text-14px font-600 leading-20px text-t-primary'>{scene.name}</span>
            {scene.builtIn && (
              <Tag size='small' color='arcoblue'>
                {t('common.scenes.builtinTag', { defaultValue: '内置' })}
              </Tag>
            )}
          </div>
          {scene.description ? (
            <div className='mt-2px line-clamp-2 text-12px leading-17px text-t-tertiary' title={scene.description}>
              {scene.description}
            </div>
          ) : null}
        </div>
      </div>

      {/* The two facts a member actually needs, separated rather than stacked
          as one undifferentiated run of tags: what this scene makes them, and
          what it hands them. */}
      {scene.jobFunctions.length > 0 && (
        <div className='min-w-0 truncate text-12px text-t-secondary' title={scene.jobFunctions.join(' · ')}>
          {scene.jobFunctions.join(' · ')}
        </div>
      )}

      <div className='mt-auto border-t border-3 pt-9px'>
        {scene.resources.length > 0 ? (
          <div className='flex flex-wrap gap-x-12px gap-y-5px'>
            {scene.resources.map((summary) => (
              <span key={summary.resourceType} className='inline-flex items-baseline gap-4px text-12px'>
                <span className='text-t-tertiary'>
                  {t(`common.scenes.resourceType.${summary.resourceType}`, { defaultValue: summary.resourceType })}
                </span>
                <span className='font-600 text-t-primary'>{resourceValue(summary)}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className='text-12px text-t-tertiary'>
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
        <div className='grid grid-cols-1 gap-10px sm:grid-cols-2 lg:grid-cols-3'>
          {scenes.map((scene) => (
            <SceneCard key={scene.id} scene={scene} />
          ))}
        </div>
      )}
    </div>
  );
};

export default EnterpriseSceneGrid;
