/**
 * Copyright 2026 One Work
 *
 * State for "remote access" (phone -> this desktop, outside the LAN): the
 * main process owns the tunnel; this hook mirrors its status and carries the
 * user's on/off choice, which is persisted so it survives restarts.
 */

import { webui, type IWebUITunnel } from '@/common/adapter/ipcBridge';
import { configService } from '@/common/config/configService';
import { useCallback, useEffect, useState } from 'react';

export const DESKTOP_WEBUI_REMOTE_TUNNEL_KEY = 'webui.desktop.remoteTunnel';

const OFF: IWebUITunnel = { state: 'off' };

export type WebuiTunnelController = {
  status: IWebUITunnel;
  /** The user's choice (may be on while the WebUI itself is off: it then starts with the WebUI). */
  enabled: boolean;
  busy: boolean;
  /** Resolves false when the main process refused or failed. */
  setEnabled: (next: boolean) => Promise<boolean>;
  resetAddress: () => Promise<boolean>;
  /** Public origin, only while it is actually reachable. */
  reachableUrl: string | undefined;
};

export function useWebuiTunnel(): WebuiTunnelController {
  const [status, setStatus] = useState<IWebUITunnel>(OFF);
  const [enabled, setEnabledState] = useState<boolean>(
    () => configService.get(DESKTOP_WEBUI_REMOTE_TUNNEL_KEY) === true
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    webui.getStatus
      .invoke()
      .then((snapshot) => {
        if (!cancelled && snapshot?.tunnel) setStatus(snapshot.tunnel);
      })
      .catch((): void => undefined);
    const unsubscribe = webui.tunnelChanged.on((next) => setStatus(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const setEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      await configService.set(DESKTOP_WEBUI_REMOTE_TUNNEL_KEY, next);
      setEnabledState(next);
      setStatus(await webui.setTunnel.invoke({ enabled: next }));
      return true;
    } catch (error) {
      console.error('[WebuiTunnel] toggle failed:', error);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const resetAddress = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      setStatus(await webui.resetTunnelAddress.invoke());
      return true;
    } catch (error) {
      console.error('[WebuiTunnel] reset address failed:', error);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    enabled,
    busy,
    setEnabled,
    resetAddress,
    reachableUrl: status.state === 'connected' ? status.url : undefined,
  };
}
