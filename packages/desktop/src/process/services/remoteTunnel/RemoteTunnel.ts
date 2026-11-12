/**
 * Copyright 2026 One Work
 *
 * Remote access ("reach my desktop from my phone, outside the LAN").
 *
 * Registers this install with the broker (stable subdomain + secret, kept in
 * userData), then runs the bundled `frpc` so `https://<subdomain>.r.1work.vip`
 * reaches this machine's own WebUI. frpc is supervised: it is restarted with a
 * backoff when it dies, and a rejection by the server (revoked / unknown
 * tunnel) triggers one fresh registration instead of a retry loop.
 */

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildFrpcConfig,
  classifyFrpcLine,
  isTunnelCredentials,
  parseRegistration,
  restartDelayMs,
  type TunnelCredentials,
} from './frpcConfig';

export type TunnelState = 'off' | 'connecting' | 'connected' | 'error';

export type TunnelStatus = {
  state: TunnelState;
  /** Public https origin, present once credentials exist (even while reconnecting). */
  url?: string;
  /** Short machine-readable reason when `state === 'error'`. */
  error?: 'no_binary' | 'register_failed' | 'rejected' | 'spawn_failed';
};

export type RemoteTunnelDeps = {
  /** Directory for `remote-tunnel.json` and the generated frpc config. */
  dataDir: string;
  brokerUrl: () => string;
  resolveFrpc: () => string | null;
  /** Per-process secret stamped on relayed requests so web-host can trust the visitor's address. */
  relayToken: string;
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  fetch: typeof fetch;
  installId?: () => string | undefined;
  onChange: (status: TunnelStatus) => void;
  log?: (message: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const CREDS_FILE = 'remote-tunnel.json';
const CONFIG_FILE = 'frpc.toml';

export class RemoteTunnel {
  private status: TunnelStatus = { state: 'off' };
  private creds: TunnelCredentials | null = null;
  private child: ChildProcess | null = null;
  private wanted = false;
  private localPort = 0;
  private attempt = 0;
  private restartTimer: unknown = null;
  private reregistered = false;
  private starting: Promise<void> | null = null;

  constructor(private readonly deps: RemoteTunnelDeps) {}

  getStatus(): TunnelStatus {
    return this.status;
  }

  /** Start (or restart against a new local port). Resolves once frpc is launched, not once connected. */
  async start(localPort: number): Promise<void> {
    if (this.wanted && this.localPort === localPort && this.child) return;
    await this.stop();
    this.wanted = true;
    this.localPort = localPort;
    this.attempt = 0;
    this.reregistered = false;
    this.starting = this.launch().finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  async stop(): Promise<void> {
    this.wanted = false;
    if (this.restartTimer !== null) {
      (this.deps.clearTimer ?? clearTimeout)(this.restartTimer as never);
      this.restartTimer = null;
    }
    if (this.starting) await this.starting.catch((): void => undefined);
    const child = this.child;
    this.child = null;
    if (child) {
      child.removeAllListeners('exit');
      child.kill();
    }
    // Never leave the secret on disk in a ready-to-run config while off.
    fs.rmSync(path.join(this.deps.dataDir, CONFIG_FILE), { force: true });
    this.setStatus({ state: 'off', url: this.creds?.publicUrl });
  }

  /** Forget this tunnel's address; the next start registers a new one. */
  async resetAddress(): Promise<void> {
    const wasWanted = this.wanted;
    const port = this.localPort;
    await this.stop();
    this.creds = null;
    fs.rmSync(path.join(this.deps.dataDir, CREDS_FILE), { force: true });
    this.setStatus({ state: 'off' });
    if (wasWanted) await this.start(port);
  }

  private log(message: string): void {
    this.deps.log?.(`[RemoteTunnel] ${message}`);
  }

  private setStatus(next: TunnelStatus): void {
    if (next.state === this.status.state && next.url === this.status.url && next.error === this.status.error) return;
    this.status = next;
    this.deps.onChange(next);
  }

  private loadCreds(): TunnelCredentials | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.deps.dataDir, CREDS_FILE), 'utf-8'));
      return isTunnelCredentials(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  private saveCreds(creds: TunnelCredentials): void {
    fs.mkdirSync(this.deps.dataDir, { recursive: true });
    const file = path.join(this.deps.dataDir, CREDS_FILE);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(creds, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }

  private async register(): Promise<TunnelCredentials> {
    const res = await this.deps.fetch(`${this.deps.brokerUrl().replace(/\/+$/, '')}/v1/remote/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id: this.deps.installId?.() }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`register: HTTP ${res.status}`);
    const creds = parseRegistration(await res.json());
    this.saveCreds(creds);
    return creds;
  }

  private async launch(): Promise<void> {
    if (!this.wanted) return;
    const frpc = this.deps.resolveFrpc();
    if (!frpc) {
      this.setStatus({ state: 'error', error: 'no_binary' });
      return;
    }
    this.setStatus({ state: 'connecting', url: this.creds?.publicUrl });

    if (!this.creds) this.creds = this.loadCreds();
    if (!this.creds) {
      try {
        this.creds = await this.register();
      } catch (error) {
        this.log(`registration failed: ${String(error)}`);
        this.setStatus({ state: 'error', error: 'register_failed' });
        this.scheduleRestart();
        return;
      }
    }
    if (!this.wanted) return;

    const configPath = path.join(this.deps.dataDir, CONFIG_FILE);
    fs.mkdirSync(this.deps.dataDir, { recursive: true });
    fs.writeFileSync(configPath, buildFrpcConfig(this.creds, this.localPort, this.deps.relayToken), {
      encoding: 'utf-8',
      mode: 0o600,
    });

    let child: ChildProcess;
    try {
      child = this.deps.spawn(frpc, ['-c', configPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      this.log(`spawn failed: ${String(error)}`);
      this.setStatus({ state: 'error', error: 'spawn_failed', url: this.creds.publicUrl });
      this.scheduleRestart();
      return;
    }
    this.child = child;
    this.setStatus({ state: 'connecting', url: this.creds.publicUrl });

    const onData = (chunk: Buffer | string): void => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        const event = classifyFrpcLine(line);
        if (event === 'connected') {
          this.attempt = 0;
          this.setStatus({ state: 'connected', url: this.creds?.publicUrl });
        } else if (event === 'disconnected') {
          this.setStatus({ state: 'connecting', url: this.creds?.publicUrl });
        } else if (event === 'rejected') {
          void this.onRejected(child);
        }
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => {
      this.log(`frpc error: ${String(error)}`);
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.log(`frpc exited (code ${code})`);
      if (!this.wanted) return;
      this.setStatus({ state: 'connecting', url: this.creds?.publicUrl });
      this.scheduleRestart();
    });
  }

  /** The server refused our credentials: forget them, register once more, and only then give up. */
  private async onRejected(child: ChildProcess): Promise<void> {
    if (this.child !== child) return;
    this.child = null;
    child.removeAllListeners('exit');
    child.kill();
    if (!this.wanted) return;
    if (this.reregistered) {
      this.setStatus({ state: 'error', error: 'rejected' });
      return;
    }
    this.reregistered = true;
    this.log('credentials rejected, registering a new tunnel');
    this.creds = null;
    fs.rmSync(path.join(this.deps.dataDir, CREDS_FILE), { force: true });
    await this.launch();
  }

  private scheduleRestart(): void {
    if (!this.wanted || this.restartTimer !== null) return;
    const delay = restartDelayMs(this.attempt++);
    this.restartTimer = (this.deps.setTimer ?? setTimeout)(() => {
      this.restartTimer = null;
      void this.launch();
    }, delay);
  }
}
