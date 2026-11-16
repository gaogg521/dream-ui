/**
 * Copyright 2026 One Work
 *
 * Process-wide remote-access tunnel: wires {@link RemoteTunnel} to Electron
 * (paths, fetch) and to the desktop WebUI lifecycle.
 */

import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { resolveTrialBrokerUrl, TRIAL_BROKER_URL_DEFAULT } from '@dream/web-host';
import { getDataPath } from '@process/utils/utils';
import { RemoteTunnel, type TunnelStatus } from './RemoteTunnel';

export type { TunnelStatus } from './RemoteTunnel';

const tunnelDataDir = (): string => join(getDataPath(), 'remote-tunnel');

type Listener = (status: TunnelStatus) => void;
const listeners = new Set<Listener>();

export function onTunnelStatusChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let tunnel: RemoteTunnel | null = null;

// Exists only in this process's memory: the tunnel client stamps it on every relayed
// request, web-host checks it. A new one per launch, so nothing on disk can be replayed.
const relayToken = randomBytes(24).toString('hex');
export const getRelayToken = (): string => relayToken;

function getTunnel(): RemoteTunnel {
  tunnel ??= new RemoteTunnel({
    dataDir: tunnelDataDir(),
    // A tunnel is something the user explicitly switched on, so dev builds use
    // the production broker too (unlike the opt-in trial-key features).
    brokerUrl: () => resolveTrialBrokerUrl(app.isPackaged) ?? TRIAL_BROKER_URL_DEFAULT,
    relayToken,
    fetch,
    log: (message) => console.log(message),
    onChange: (status) => {
      for (const listener of listeners) listener(status);
    },
  });
  return tunnel;
}

export const startRemoteTunnel = (localPort: number): Promise<void> => getTunnel().start(localPort);
export const stopRemoteTunnel = (): Promise<void> => (tunnel ? tunnel.stop() : Promise.resolve());
export const resetRemoteTunnelAddress = (): Promise<void> => getTunnel().resetAddress();
export const getRemoteTunnelStatus = (): TunnelStatus => (tunnel ? tunnel.getStatus() : { state: 'off' });
