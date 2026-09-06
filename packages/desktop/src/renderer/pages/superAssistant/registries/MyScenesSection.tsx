/**
 * My Scenes (§4.1 of the 09-05 handoff) — the member-side half of the E5
 * scene management. The admin console curates scenes; this section shows the
 * caller what they belong to: description, job functions, and a summary of
 * the grant package each scene carries (what joining it delivers).
 *
 * Read-only by nature — the backend endpoint (`GET /api/one/org/scenes`)
 * returns only the caller's own memberships. Hidden entirely outside an
 * enterprise context, matching how the registries' admin controls gate.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Card, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { MyScene, MySceneResourceSummary } from '@/common/types/platform/enterpriseTypes';
import { isEnterpriseRemoteActive } from '@/common/adapter/enterpriseMode';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';

const MyScenesSection: React.FC = () => {
  const { t } = useTranslation();
  const [scenes, setScenes] = useState<MyScene[] | null>(null);
  const [failed, setFailed] = useState(false);
  // `isEnterpriseRemoteActive()` is a plain module read: it tells the truth at
  // the moment it is called and notifies nobody when that truth changes. On
  // its own it made this section load exactly once per mount, so joining an
  // enterprise with the app open left "my scenes" hidden until the tab was
  // remounted. `useOrgContext` re-renders on ORG_CONTEXT_CHANGED_EVENT, which
  // is what the join/exit flows actually dispatch.
  const { context } = useOrgContext();
  const tenantId = context?.tenantId ?? null;
  const isEnterprise = context?.isEnterprise ?? false;

  const refresh = useCallback(async () => {
    if (!isEnterpriseRemoteActive()) return;
    try {
      setScenes((await ipcBridge.onePlatform.myScenes.invoke()) ?? []);
      // Clear a previous failure: a server that was briefly unreachable must
      // not hide this section for the rest of the session.
      setFailed(false);
    } catch {
      // The scene endpoint 403s on personal/local backends — that's a "no
      // scenes here", not an error surface. Anything else reads as failed.
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Drop the previous tenant's scenes before asking for this one's, so a
    // switch never renders the old org's rows while the fetch is in flight.
    setScenes(null);
    setFailed(false);
    if (!isEnterprise) return;
    void refresh();
  }, [refresh, isEnterprise, tenantId]);

  if (!isEnterpriseRemoteActive() || failed || !scenes) return null;

  const resourceLabel = (summary: MySceneResourceSummary): string => {
    const typeLabel = t(`common.scenes.resourceType.${summary.resourceType}`, {
      defaultValue: summary.resourceType,
    });
    if (summary.includesAll) {
      return `${typeLabel} · ${t('common.scenes.resourceAll', { defaultValue: '全部' })}`;
    }
    return `${typeLabel} ×${summary.count}`;
  };

  return (
    <Card
      id='registry-section-scenes'
      title={t('common.scenes.title', { defaultValue: '我的场景' })}
      size='small'
      data-testid='my-scenes-section'
    >
      {scenes.length === 0 ? (
        <div className='py-16px text-center text-13px text-t-tertiary'>
          {t('common.scenes.empty', {
            defaultValue: '尚未加入任何场景。管理员可在控制台把你加入场景，一次获得整包协作资源。',
          })}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-10px md:grid-cols-2'>
          {scenes.map((scene) => (
            <div key={scene.id} className='rd-8px border border-border-2 px-12px py-10px' data-scene-name={scene.name}>
              <div className='flex items-center gap-8px'>
                <span className='text-14px font-500 text-t-primary'>{scene.name}</span>
                {scene.builtIn && (
                  <Tag size='small' color='arcoblue'>
                    {t('common.scenes.builtinTag', { defaultValue: '内置' })}
                  </Tag>
                )}
              </div>
              {scene.description && <div className='mt-4px text-12px text-t-secondary'>{scene.description}</div>}
              {scene.jobFunctions.length > 0 && (
                <div className='mt-6px flex flex-wrap gap-4px'>
                  {scene.jobFunctions.map((fn) => (
                    <Tag key={fn} size='small' color='gray'>
                      {fn}
                    </Tag>
                  ))}
                </div>
              )}
              <div className='mt-8px flex flex-wrap gap-4px'>
                {scene.resources.length === 0 ? (
                  <span className='text-12px text-t-tertiary'>
                    {t('common.scenes.noResources', { defaultValue: '该场景暂未配置授权包' })}
                  </span>
                ) : (
                  scene.resources.map((summary) => (
                    <Tag key={summary.resourceType} size='small' color='green'>
                      {resourceLabel(summary)}
                    </Tag>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default MyScenesSection;
