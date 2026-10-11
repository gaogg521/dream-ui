/**
 * Copyright 2026 One Work
 */

/**
 * App-wide owner of export protection's client state.
 *
 * - Tells the export gateway whether it applies (connected to a company
 *   server as a member) and wipes the cached seed, policy and event queue
 *   when the member leaves.
 * - Delivers the export record on the same five-minute rhythm as the other
 *   enterprise syncs.
 * - Opens `.owenc` files the OS hands over (double-click, Open With) or the
 *   UI asks for, and shows them in the read-only viewer.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Message, Spin } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { isEnterpriseRemoteActive } from '@/common/adapter/enterpriseMode';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import { isElectronDesktop } from '@renderer/utils/platform';
import { clearExportEventQueue, flushExportEvents } from '@renderer/utils/enterprise/secureExport/events';
import {
  loadSecurePackage,
  setSecurePackageOpener,
  type OpenedPackage,
} from '@renderer/utils/enterprise/secureExport/openPackage';
import {
  clearSecureExportState,
  setSecureExportEnterpriseActive,
} from '@renderer/utils/enterprise/secureExport/policy';
import SecurePackageViewer from './SecurePackageViewer';

const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

const SecurePackageHost: React.FC = () => {
  const { t } = useTranslation();
  const { context, loading } = useOrgContext();
  const [opened, setOpened] = useState<OpenedPackage | null>(null);
  const [opening, setOpening] = useState(false);
  const wasActive = useRef(false);
  const backlog = useRef<string[]>([]);

  const active = Boolean(context?.isEnterprise) && isElectronDesktop() && isEnterpriseRemoteActive();

  useEffect((): (() => void) | undefined => {
    if (loading) return undefined;
    setSecureExportEnterpriseActive(active);
    if (wasActive.current && !active) {
      clearSecureExportState();
      clearExportEventQueue();
    }
    wasActive.current = active;
    if (!active) return undefined;
    void flushExportEvents();
    const timer = window.setInterval(() => {
      void flushExportEvents();
    }, FLUSH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, loading]);

  const open = useCallback(
    async (path: string) => {
      setOpening(true);
      try {
        const result = await loadSecurePackage(path, t);
        if (result.ok && result.value) {
          setOpened(result.value);
        } else {
          Message.error({
            content: result.message ?? t('messages.secureExport.openFailed', { reason: '' }),
            duration: 6000,
          });
        }
      } finally {
        setOpening(false);
      }
    },
    [t]
  );

  // Paths can arrive before the org context resolves (a double-click that
  // launched the app); hold them until it has, or every one would be refused
  // as "not connected to a company".
  const ready = !loading;
  useEffect(() => {
    if (!ready) return;
    const pending = backlog.current.splice(0, backlog.current.length);
    for (const path of pending) void open(path);
  }, [ready, open]);

  const request = useCallback(
    (path: string) => {
      if (!ready) {
        backlog.current.push(path);
        return;
      }
      void open(path);
    },
    [ready, open]
  );

  // The OS subscription is made once; it reaches the current `request`
  // through this ref so a path arriving after the context resolved is not
  // parked in a backlog nobody drains any more.
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    setSecurePackageOpener((path) => requestRef.current(path));
    return () => setSecurePackageOpener(null);
  }, []);

  useEffect(() => {
    if (!isElectronDesktop()) return;
    const off = ipcBridge.secureExport.openRequested.on(({ path }) => requestRef.current(path));
    void ipcBridge.secureExport.takePendingOpens
      .invoke()
      .then((paths) => {
        for (const path of paths ?? []) requestRef.current(path);
      })
      .catch(() => {});
    return off;
  }, []);

  return (
    <>
      {opening && (
        <div className='fixed inset-0 z-1000 flex items-center justify-center pointer-events-none'>
          <Spin tip={t('messages.secureExport.opening')} />
        </div>
      )}
      <SecurePackageViewer opened={opened} onClose={() => setOpened(null)} />
    </>
  );
};

export default SecurePackageHost;
