/**
 * Copyright 2026 One Work
 */

/**
 * Enterprise scenes, as a compact strip of small cards under the Guid composer.
 *
 * A scene is a role plus a resource package an admin granted, and the home page
 * only needs to say which ones the member carries — so each is a one-line card
 * (avatar, name, how many skills and tools it hands over), four to a row, with
 * the first four shown and the rest behind "show all". The description and job
 * functions are one hover away rather than taking a card's worth of height each.
 *
 * Read-only by design — a scene is granted by an admin in the console, not
 * picked here, so the cards state what the account already carries rather than
 * offering an action that would 403.
 */

import { ipcBridge } from '@/common';
import {
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseRemoteActive,
} from '@/common/adapter/enterpriseMode';
import type { MyScene, MySceneResourceSummary } from '@/common/types/platform/enterpriseTypes';
import { useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';
import { Button } from '@arco-design/web-react';
import React, { useState } from 'react';
import { Application, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import officeAvatar from '@/renderer/assets/scenes/office.png';
import itOpsAvatar from '@/renderer/assets/scenes/it-ops.png';
import securityAvatar from '@/renderer/assets/scenes/cybersecurity.png';
import mediaAvatar from '@/renderer/assets/scenes/media-ops.png';
import marketingAvatar from '@/renderer/assets/scenes/marketing.png';

import styles from './EnterpriseHome.module.css';

const BUILTIN_AVATARS: Record<string, string> = {
  办公: officeAvatar,
  IT运维: itOpsAvatar,
  网络安全: securityAvatar,
  新媒体运营: mediaAvatar,
  市场营销: marketingAvatar,
};

/** Scenes shown before "show all". One row at the home page's usual width. */
const COLLAPSED_SCENE_COUNT = 4;

const SceneCard: React.FC<{ scene: MyScene }> = ({ scene }) => {
  const { t } = useTranslation();
  const resourceValue = (summary: MySceneResourceSummary): string =>
    summary.includesAll ? t('common.scenes.resourceAll', { defaultValue: '全部' }) : String(summary.count);
  const tooltip = [scene.name, scene.description, scene.jobFunctions.join(' · ')]
    .filter(Boolean)
    .join(String.fromCharCode(10));

  return (
    <div className={styles.card} data-scene-name={scene.name} title={tooltip}>
      <img src={scene.avatarRef || BUILTIN_AVATARS[scene.name] || officeAvatar} alt='' className={styles.avatar} />
      <div className={styles.cardBody}>
        <span className={styles.name}>{scene.name}</span>
        <div className={styles.resources}>
          {scene.resources.length > 0 ? (
            scene.resources.map((summary) => (
              <span key={summary.resourceType} className={styles.resource}>
                <span>
                  {t(`common.scenes.resourceType.${summary.resourceType}`, { defaultValue: summary.resourceType })}
                </span>
                <span className={styles.resourceValue}>{resourceValue(summary)}</span>
              </span>
            ))
          ) : (
            <span>{t('common.scenes.noResources', { defaultValue: '该场景暂未配置授权包' })}</span>
          )}
        </div>
      </div>
    </div>
  );
};

const EnterpriseSceneGrid: React.FC = () => {
  const { t } = useTranslation();
  const { context } = useOrgContext();
  const [expanded, setExpanded] = useState(false);
  const active = Boolean(context?.isEnterprise && isEnterpriseRemoteActive());
  const tenantId = context?.tenantId ?? '';
  const {
    data: scenes,
    mutate,
    isValidating,
    error,
  } = useSWR<MyScene[]>(
    active
      ? ['enterprise-conversation-scenes', getEnterpriseServerUrl(), getEnterpriseSession()?.userId, tenantId]
      : null,
    () => ipcBridge.onePlatform.myScenes.invoke(),
    { revalidateOnFocus: true, refreshInterval: 30000, shouldRetryOnError: false }
  );

  if (!active) return null;
  if (!scenes)
    return error ? (
      <div className={styles.empty} role='status'>
        <span>{t('common.error')}</span>
        <Button onClick={() => void mutate()} loading={isValidating}>
          {t('common.retry')}
        </Button>
      </div>
    ) : null;

  if (scenes.length === 0)
    return (
      <div className={styles.compactEmpty} data-testid='enterprise-scene-grid'>
        <Application size={18} className='shrink-0 text-t-tertiary' />
        <div className={styles.compactCopy}>
          <span className={styles.compactTitle}>{t('common.scenes.title')}</span>
          <span className={styles.compactHint} title={t('common.scenes.empty')}>
            {t('common.scenes.empty')}
          </span>
        </div>
        <Button
          type='text'
          size='small'
          loading={isValidating}
          icon={<Refresh size={14} />}
          onClick={() => void mutate()}
        >
          {t('common.refresh')}
        </Button>
      </div>
    );

  const visible = expanded ? scenes : scenes.slice(0, COLLAPSED_SCENE_COUNT);
  const hiddenCount = scenes.length - COLLAPSED_SCENE_COUNT;

  return (
    <div className={styles.section} data-testid='enterprise-scene-grid'>
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <h2 className={styles.title}>{t('common.scenes.title', { defaultValue: '工作场景' })}</h2>
          <span className={styles.hint} title={t('common.scenes.conversationHint')}>
            {t('common.scenes.conversationHint', {
              defaultValue: '以下场景的职能与资源包已叠加到当前账号，在所有会话中自动生效。',
            })}
          </span>
        </div>
        <div className={styles.headingActions}>
          <span className={styles.count}>{scenes.length}</span>
          <Button
            type='text'
            size='small'
            loading={isValidating}
            icon={<Refresh size={14} />}
            onClick={() => void mutate()}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>
      <div className={styles.grid}>
        {visible.map((scene) => (
          <SceneCard key={scene.id} scene={scene} />
        ))}
      </div>
      {hiddenCount > 0 && (
        <div className={styles.more}>
          <Button type='text' size='small' onClick={() => setExpanded((open) => !open)}>
            {expanded ? t('common.collapse') : t('common.scenes.showAll', { count: scenes.length })}
          </Button>
        </div>
      )}
    </div>
  );
};

export default EnterpriseSceneGrid;
