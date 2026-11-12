/**
 * Copyright 2026 One Work
 *
 * Process-wide remote-access tunnel: wires {@link RemoteTunnel} to Electron
 * (paths, spawn, fetch) and to the desktop WebUI lifecycle.
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTrialBrokerUrl, TRIAL_BROKER_URL_DEFAULT } from '@dream/web-host';
import { getDataPath } from '@process/utils/utils';
import { RemoteTunnel, type TunnelStatus } from './RemoteTunnel';

export type { TunnelStatus } from './RemoteTunnel';

/** Where the packaged app / a dev checkout keeps the frpc prepared by scripts/prepareFrpc.mjs. */
export function resolveFrpcPath(): string | null {
  const key = `${process.platform}-${process.arch}`;
  const exe = process.platform === 'win32' ? 'frpc.exe' : 'frpc';
  const roots = [
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    join(process.cwd(), 'resources'),
  ];
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, 'frpc', key, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

type Listener = (status: TunnelStatus) => void;
const listeners = new Set<Listener>();

export function onTunnelStatusChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let tunnel: RemoteTunnel | null = null;

// Exists only in this process's memory: frpc is handed it through its config, web-host
// through its options. A new one per launch, so nothing on disk can be replayed.
const relayToken = randomBytes(24).toString('hex');
export const getRelayToken = (): string => relayToken;

function getTunnel(): RemoteTunnel {
  tunnel ??= new RemoteTunnel({
    dataDir: join(getDataPath(), 'remote-tunnel'),
    // A tunnel is something the user explicitly switched on, so dev builds use
    // the production broker too (unlike the opt-in trial-key features).
    brokerUrl: () => resolveTrialBrokerUrl(app.isPackaged) ?? TRIAL_BROKER_URL_DEFAULT,
    resolveFrpc: resolveFrpcPath,
    relayToken,
    spawn,
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
