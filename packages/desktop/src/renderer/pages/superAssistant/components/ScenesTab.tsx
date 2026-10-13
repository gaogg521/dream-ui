/**
 * Scenes tab — every scene the company has given this member, each with a
 * switch.
 *
 * The company decides which scenes a member carries; whether the member wants
 * to use one is their own call. A scene switched off leaves the home page (and
 * so cannot be opened from it) until it is switched on again; nothing is
 * removed, and the company's grant is untouched.
 */

import React from 'react';
import { Empty, Spin, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { sceneAvatarSrc } from '@/renderer/components/enterprise/sceneAvatar';
import { useEnterpriseScenes } from '@/renderer/components/enterprise/useEnterpriseScenes';
import type { MySceneResourceSummary } from '@/common/types/platform/enterpriseTypes';

const ScenesTab: React.FC = () => {
  const { t } = useTranslation();
  const { active, loaded, all, enabled, setEnabled, isEnabled, error } = useEnterpriseScenes();

  const resourceValue = (summary: MySceneResourceSummary): string =>
    summary.includesAll ? t('common.scenes.resourceAll') : String(summary.count);

  if (!active) return <Empty description={t('common.scenes.tabNotEnterprise')} />;
  if (!loaded) return error ? <Empty description={t('common.error')} /> : <Spin className='w-full py-40px' />;
  if (all.length === 0) return <Empty description={t('common.scenes.empty')} />;

  return (
    <div className='flex flex-col gap-12px' data-testid='scenes-tab'>
      <div className='flex items-center justify-between gap-12px'>
        <span className='text-12px text-t-tertiary'>{t('common.scenes.tabHint')}</span>
        <span className='shrink-0 text-12px text-t-secondary'>
          {t('common.scenes.enabledCount', { enabled: enabled.length, total: all.length })}
        </span>
      </div>
      <div className='grid gap-12px md:grid-cols-2'>
        {all.map((scene) => {
          const on = isEnabled(scene.id);
          return (
            <div
              key={scene.id}
              data-scene-row={scene.name}
              className='flex items-center gap-12px rounded-6px border border-2 bg-2 p-12px'
            >
              <img
                src={sceneAvatarSrc(scene)}
                alt=''
                className={`h-40px w-40px shrink-0 rd-10px object-cover ${on ? '' : 'opacity-50'}`}
              />
              <div className={`min-w-0 flex-1 ${on ? '' : 'opacity-60'}`}>
                <div className='truncate text-14px font-500'>{scene.name}</div>
                <div className='mt-2px flex flex-wrap gap-x-10px text-12px text-t-tertiary'>
                  {scene.resources.map((summary) => (
                    <span key={summary.resourceType}>
                      {t(`common.scenes.resourceType.${summary.resourceType}`, { defaultValue: summary.resourceType })}{' '}
                      <span className='text-t-secondary'>{resourceValue(summary)}</span>
                    </span>
                  ))}
                </div>
                {scene.description ? (
                  <div className='mt-4px line-clamp-1 text-12px text-t-tertiary'>{scene.description}</div>
                ) : null}
              </div>
              <Switch checked={on} aria-label={scene.name} onChange={(checked) => setEnabled(scene.id, checked)} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ScenesTab;
