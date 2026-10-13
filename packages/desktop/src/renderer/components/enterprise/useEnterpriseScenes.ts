/**
 * Copyright 2026 One Work
 */

/**
 * The member's enterprise scenes together with their own say over them: the
 * order they put them in and which ones they have switched off. The home page
 * shows the enabled ones in that order; the digital employees page lists all of
 * them with the switches. One hook so both read the same answer from the same
 * request.
 */

import { ipcBridge } from '@/common';
import {
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseRemoteActive,
} from '@/common/adapter/enterpriseMode';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import { useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { loadDisabledScenes, saveDisabledScenes, setSceneEnabled } from './sceneEnabled';
import { applySceneOrder, loadSceneOrder, saveSceneOrder } from './sceneOrder';

export function useEnterpriseScenes() {
  const { context } = useOrgContext();
  const active = Boolean(context?.isEnterprise && isEnterpriseRemoteActive());
  const tenantId = context?.tenantId ?? '';
  const server = getEnterpriseServerUrl();
  const userId = getEnterpriseSession()?.userId ?? null;
  const scope = useMemo(() => ({ server, tenantId, userId }), [server, tenantId, userId]);

  const [order, setOrderState] = useState<string[]>(() => loadSceneOrder(scope));
  const [disabledIds, setDisabledIds] = useState<string[]>(() => loadDisabledScenes(scope));
  // Another member, project group or server on this machine has its own preferences.
  useEffect(() => {
    setOrderState(loadSceneOrder(scope));
    setDisabledIds(loadDisabledScenes(scope));
  }, [scope]);

  const {
    data: scenes,
    mutate,
    isValidating,
    error,
  } = useSWR<MyScene[]>(
    active ? ['enterprise-conversation-scenes', server, userId, tenantId] : null,
    async () => {
      // A server (or bridge) that answers with anything but a list is treated as no scenes.
      const list = await ipcBridge.onePlatform.myScenes.invoke();
      return Array.isArray(list) ? list : [];
    },
    { revalidateOnFocus: true, refreshInterval: 30000, shouldRetryOnError: false }
  );

  const all = useMemo(() => applySceneOrder(Array.isArray(scenes) ? scenes : [], order), [scenes, order]);
  const enabled = useMemo(() => all.filter((scene) => !disabledIds.includes(scene.id)), [all, disabledIds]);

  const setOrder = useCallback(
    (next: string[]) => {
      setOrderState(next);
      saveSceneOrder(scope, next);
    },
    [scope]
  );

  const setEnabled = useCallback(
    (sceneId: string, on: boolean) => {
      setDisabledIds((current) => {
        const next = setSceneEnabled(current, sceneId, on);
        saveDisabledScenes(scope, next);
        return next;
      });
    },
    [scope]
  );

  return {
    active,
    /** `undefined` until the first answer arrives. */
    loaded: scenes !== undefined,
    all,
    enabled,
    order,
    setOrder,
    setEnabled,
    isEnabled: (sceneId: string) => !disabledIds.includes(sceneId),
    mutate,
    isValidating,
    error,
  };
}
