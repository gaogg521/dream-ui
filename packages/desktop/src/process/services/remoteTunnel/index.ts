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
import { downloadFrpc, findInstalledFrpc } from './frpcComponent';
import { RemoteTunnel, type StartOptions, type TunnelStatus } from './RemoteTunnel';

export type { StartOptions, TunnelStatus } from './RemoteTunnel';

const tunnelDataDir = (): string => join(getDataPath(), 'remote-tunnel');

/**
 * frpc is downloaded on demand (see frpcComponent.ts) into the data directory. A copy
 * prepared by scripts/prepareFrpc.mjs under `resources/` is still honoured, but only
 * for dev checkouts and older packages — new installers no longer carry it.
 */
export function resolveFrpcPath(): string | null {
  const installed = findInstalledFrpc(tunnelDataDir(), process.platform, process.arch);
  if (installed) return installed;
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

/** Attach whether the component is already on this machine, so the UI knows if a download needs consent. */
const withComponentState = (status: TunnelStatus): TunnelStatus => ({
  ...status,
  componentReady: resolveFrpcPath() !== null,
});

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
    dataDir: tunnelDataDir(),
    // A tunnel is something the user explicitly switched on, so dev builds use
    // the production broker too (unlike the opt-in trial-key features).
    brokerUrl: () => resolveTrialBrokerUrl(app.isPackaged) ?? TRIAL_BROKER_URL_DEFAULT,
    resolveFrpc: resolveFrpcPath,
    installFrpc: () =>
      downloadFrpc({
        dataDir: tunnelDataDir(),
        platform: process.platform,
        arch: process.arch,
        fetch,
        log: (message) => console.log(`[RemoteTunnel] ${message}`),
      }),
    relayToken,
    spawn,
    fetch,
    log: (message) => console.log(message),
    onChange: (status) => {
      const enriched = withComponentState(status);
      for (const listener of listeners) listener(enriched);
    },
  });
  return tunnel;
}

export const startRemoteTunnel = (localPort: number, options?: StartOptions): Promise<void> =>
  getTunnel().start(localPort, options);
export const stopRemoteTunnel = (): Promise<void> => (tunnel ? tunnel.stop() : Promise.resolve());
export const resetRemoteTunnelAddress = (): Promise<void> => getTunnel().resetAddress();
export const getRemoteTunnelStatus = (): TunnelStatus =>
  withComponentState(tunnel ? tunnel.getStatus() : { state: 'off' });
