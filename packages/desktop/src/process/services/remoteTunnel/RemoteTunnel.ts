/**
 * Copyright 2026 One Work
 *
 * Remote access ("reach my desktop from my phone, outside the LAN").
 *
 * Registers this install with the broker (stable subdomain + secret, kept in userData),
 * then keeps one {@link TunnelClient} connection to the relay alive so
 * `https://<subdomain>.r.1work.vip` reaches this machine's own WebUI. The tunnel runs
 * inside this process — there is no helper executable. The supervisor reconnects with a
 * backoff when the connection drops, and a rejection of the credentials (revoked /
 * unknown tunnel) triggers one fresh registration instead of a retry loop.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { reconnectDelayMs } from './protocol';
import { isTunnelCredentials, parseRegistration, type TunnelCredentials } from './tunnelConfig';
import { TunnelClient, type TunnelClientOptions, type TunnelCloseInfo } from './tunnelClient';

export type TunnelState = 'off' | 'connecting' | 'connected' | 'error';

export type TunnelStatus = {
  state: TunnelState;
  /** Public https origin, present once credentials exist (even while reconnecting). */
  url?: string;
  /** Short machine-readable reason when `state === 'error'`. */
  error?: 'register_failed' | 'rejected';
};

/** The part of {@link TunnelClient} the supervisor drives; a seam for tests. */
export type TunnelClientLike = {
  start(): void;
  stop(): void;
  on(event: 'connected', listener: () => void): unknown;
  on(event: 'closed', listener: (info: TunnelCloseInfo) => void): unknown;
};

export type RemoteTunnelDeps = {
  /** Directory for `remote-tunnel.json`. */
  dataDir: string;
  brokerUrl: () => string;
  /** Per-process secret stamped on relayed requests so web-host can trust the visitor's address. */
  relayToken: string;
  fetch: typeof fetch;
  createClient?: (options: TunnelClientOptions) => TunnelClientLike;
  installId?: () => string | undefined;
  onChange: (status: TunnelStatus) => void;
  log?: (message: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
};

const CREDS_FILE = 'remote-tunnel.json';
/** A connection that lasted this long counts as healthy: the backoff and the re-register allowance reset. */
const STABLE_AFTER_MS = 30_000;

export class RemoteTunnel {
  private status: TunnelStatus = { state: 'off' };
  private creds: TunnelCredentials | null = null;
  private client: TunnelClientLike | null = null;
  private wanted = false;
  private localPort = 0;
  private attempt = 0;
  private retryTimer: unknown = null;
  private reregistered = false;
  private starting: Promise<void> | null = null;
  private connectedAt = 0;

  constructor(private readonly deps: RemoteTunnelDeps) {}

  getStatus(): TunnelStatus {
    return this.status;
  }

  /** Start (or restart against a new local port). Resolves once the first connection attempt is launched. */
  async start(localPort: number): Promise<void> {
    if (this.wanted && this.localPort === localPort && (this.client || this.retryTimer !== null)) return;
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
    if (this.retryTimer !== null) {
      (this.deps.clearTimer ?? clearTimeout)(this.retryTimer as never);
      this.retryTimer = null;
    }
    if (this.starting) await this.starting.catch((): void => undefined);
    const client = this.client;
    this.client = null;
    client?.stop();
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
    this.setStatus({ state: 'connecting', url: this.creds?.publicUrl });

    if (!this.creds) this.creds = this.loadCreds();
    if (!this.creds) {
      try {
        this.creds = await this.register();
      } catch (error) {
        this.log(`registration failed: ${String(error)}`);
        if (!this.wanted) return;
        this.setStatus({ state: 'error', error: 'register_failed' });
        this.scheduleRetry();
        return;
      }
    }
    if (!this.wanted) return;
    const creds = this.creds;

    const client = (this.deps.createClient ?? ((o) => new TunnelClient(o)))({
      serverAddr: creds.serverAddr,
      serverPort: creds.serverPort,
      subdomain: creds.subdomain,
      secret: creds.secret,
      localPort: this.localPort,
      relayToken: this.deps.relayToken,
      log: (message) => this.log(message),
    });
    this.client = client;
    this.setStatus({ state: 'connecting', url: creds.publicUrl });

    client.on('connected', () => {
      if (this.client !== client) return;
      this.connectedAt = this.now();
      this.setStatus({ state: 'connected', url: creds.publicUrl });
    });
    client.on('closed', (info) => {
      if (this.client !== client) return;
      this.client = null;
      this.log(`connection closed (code ${info.code}${info.reason ? `, ${info.reason}` : ''})`);
      if (!this.wanted) return;
      if (info.wasConnected && this.now() - this.connectedAt >= STABLE_AFTER_MS) {
        this.attempt = 0;
        this.reregistered = false;
      }
      if (info.rejected) {
        void this.onRejected();
        return;
      }
      this.setStatus({ state: 'connecting', url: creds.publicUrl });
      this.scheduleRetry();
    });
    client.start();
  }

  /** The relay refused our credentials: forget them, register once more, and only then give up. */
  private async onRejected(): Promise<void> {
    if (!this.wanted) return;
    if (this.reregistered) {
      this.setStatus({ state: 'error', error: 'rejected', url: this.creds?.publicUrl });
      return;
    }
    this.reregistered = true;
    this.log('credentials rejected, registering a new tunnel');
    this.creds = null;
    fs.rmSync(path.join(this.deps.dataDir, CREDS_FILE), { force: true });
    await this.launch();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private scheduleRetry(): void {
    if (!this.wanted || this.retryTimer !== null) return;
    const delay = reconnectDelayMs(this.attempt++);
    this.retryTimer = (this.deps.setTimer ?? setTimeout)(() => {
      this.retryTimer = null;
      void this.launch();
    }, delay);
  }
}
