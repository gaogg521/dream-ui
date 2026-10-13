/**
 * Copyright 2026 One Work
 */

/**
 * Every scene this person can use, from both places, with their own say over
 * them: the order they put them in and which ones they have switched off.
 *
 * Company scenes arrive from the company server (only when a company is
 * connected); personal scenes are the ones made on this machine (see
 * `personalScenes`). The home page shows the enabled ones in the person's
 * order; the scenes tab lists all of them. One hook so both read the same
 * answers.
 */

import { ipcBridge } from '@/common';
import {
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseRemoteActive,
} from '@/common/adapter/enterpriseMode';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import type { PersonalScene } from '@/common/types/platform/sceneTypes';
import { useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';
import {
  loadPersonalScenes,
  removePersonalScene,
  savePersonalScenes,
  upsertPersonalScene,
} from '@/renderer/utils/scenes/personalScenes';
import { loadDisabledScenes, saveDisabledScenes, setSceneEnabled } from '@/renderer/utils/scenes/sceneEnabled';
import { companySceneItem, personalSceneItem, type SceneItem } from '@/renderer/utils/scenes/sceneItem';
import { applySceneOrder, loadSceneOrder, saveSceneOrder } from '@/renderer/utils/scenes/sceneOrder';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

const PERSONAL_SCENES_KEY = 'personal-scenes';

export function useScenes() {
  const { context } = useOrgContext();
  const companyActive = Boolean(context?.isEnterprise && isEnterpriseRemoteActive());
  const tenantId = context?.tenantId ?? '';
  const server = getEnterpriseServerUrl();
  const userId = getEnterpriseSession()?.userId ?? null;
  const scope = useMemo(() => ({ server, tenantId, userId }), [server, tenantId, userId]);

  const [order, setOrderState] = useState<string[]>(() => loadSceneOrder(scope));
  const [disabledKeys, setDisabledKeys] = useState<string[]>(() => loadDisabledScenes(scope));
  // Another member, project group or server on this machine has its own preferences.
  useEffect(() => {
    setOrderState(loadSceneOrder(scope));
    setDisabledKeys(loadDisabledScenes(scope));
  }, [scope]);

  const {
    data: companyScenes,
    mutate: refreshCompany,
    isValidating,
    error,
  } = useSWR<MyScene[]>(
    companyActive ? ['enterprise-conversation-scenes', server, userId, tenantId] : null,
    async () => {
      // A server (or bridge) that answers with anything but a list is treated as no scenes.
      const list = await ipcBridge.onePlatform.myScenes.invoke();
      return Array.isArray(list) ? list : [];
    },
    { revalidateOnFocus: true, refreshInterval: 30000, shouldRetryOnError: false }
  );

  const { data: personalScenes, mutate: refreshPersonal } = useSWR<PersonalScene[]>(
    PERSONAL_SCENES_KEY,
    loadPersonalScenes,
    { revalidateOnFocus: false }
  );

  // Whatever the store answered, only a list is a list of scenes.
  const personalList = useMemo(() => (Array.isArray(personalScenes) ? personalScenes : []), [personalScenes]);

  const all = useMemo<SceneItem[]>(() => {
    const items = [
      ...(Array.isArray(companyScenes) ? companyScenes.map(companySceneItem) : []),
      ...personalList.map(personalSceneItem),
    ];
    return applySceneOrder(items, order, (item) => item.key);
  }, [companyScenes, personalList, order]);
  const enabled = useMemo(() => all.filter((item) => !disabledKeys.includes(item.key)), [all, disabledKeys]);

  const setOrder = useCallback(
    (next: string[]) => {
      setOrderState(next);
      saveSceneOrder(scope, next);
    },
    [scope]
  );

  const setEnabled = useCallback(
    (key: string, on: boolean) => {
      setDisabledKeys((current) => {
        const next = setSceneEnabled(current, key, on);
        saveDisabledScenes(scope, next);
        return next;
      });
    },
    [scope]
  );

  /** Add or replace a personal scene and write the list back. */
  const savePersonal = useCallback(
    async (scene: PersonalScene) => {
      const next = upsertPersonalScene(personalScenes ?? (await loadPersonalScenes()), scene);
      await savePersonalScenes(next);
      await refreshPersonal(next, { revalidate: false });
    },
    [personalScenes, refreshPersonal]
  );

  const deletePersonal = useCallback(
    async (id: string) => {
      const next = removePersonalScene(personalScenes ?? (await loadPersonalScenes()), id);
      await savePersonalScenes(next);
      await refreshPersonal(next, { revalidate: false });
    },
    [personalScenes, refreshPersonal]
  );

  return {
    /** Whether a company is connected and its scenes are part of this list. */
    companyActive,
    /**
     * `false` until what is needed to draw the list has arrived. A company that
     * cannot be reached does not hold the person's own scenes back: they show,
     * and `error` says the company part is missing.
     */
    loaded: personalScenes !== undefined && (!companyActive || companyScenes !== undefined || Boolean(error)),
    all,
    enabled,
    order,
    setOrder,
    setEnabled,
    isEnabled: (key: string) => !disabledKeys.includes(key),
    personalScenes: personalList,
    savePersonal,
    deletePersonal,
    refreshCompany,
    isValidating,
    error,
  };
}
