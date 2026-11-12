import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildFrpcConfig,
  classifyFrpcLine,
  parseRegistration,
  restartDelayMs,
} from '../../packages/desktop/src/process/services/remoteTunnel/frpcConfig';
import { RemoteTunnel } from '../../packages/desktop/src/process/services/remoteTunnel/RemoteTunnel';
import type { TunnelStatus } from '../../packages/desktop/src/process/services/remoteTunnel/RemoteTunnel';

const registration = {
  subdomain: 'abc123def456',
  secret: 'rts_secret',
  public_url: 'https://abc123def456.r.1work.vip',
  server_addr: '1work.vip',
  server_port: 443,
};

describe('parseRegistration', () => {
  it('accepts a well-formed response', () => {
    expect(parseRegistration(registration)).toEqual({
      subdomain: 'abc123def456',
      secret: 'rts_secret',
      publicUrl: 'https://abc123def456.r.1work.vip',
      serverAddr: '1work.vip',
      serverPort: 443,
    });
  });

  it.each([
    ['uppercase subdomain', { ...registration, subdomain: 'ABC123DEF456' }],
    ['injection in subdomain', { ...registration, subdomain: 'a"\nbad = 1' }],
    ['missing secret', { ...registration, secret: '' }],
    ['http url', { ...registration, public_url: 'http://x.r.1work.vip' }],
    ['host with quote', { ...registration, server_addr: 'a"b' }],
    ['port out of range', { ...registration, server_port: 70000 }],
    ['not an object', null],
  ])('rejects %s', (_name, body) => {
    expect(() => parseRegistration(body)).toThrow();
  });
});

describe('buildFrpcConfig', () => {
  const creds = parseRegistration(registration);

  it('publishes exactly one http proxy on the tunnel subdomain, to the local port', () => {
    const toml = buildFrpcConfig(creds, 25808, 'relay-secret');
    expect(toml).toContain('serverAddr = "1work.vip"');
    expect(toml).toContain('transport.protocol = "wss"');
    expect(toml).toContain('metadatas.secret = "rts_secret"');
    expect(toml).toContain('loginFailExit = false');
    expect(toml.match(/\[\[proxies\]\]/g)).toHaveLength(1);
    expect(toml).toContain('type = "http"');
    expect(toml).toContain('localIP = "127.0.0.1"');
    expect(toml).toContain('localPort = 25808');
    expect(toml).toContain('subdomain = "abc123def456"');
    expect(toml).toContain('requestHeaders.set."x-onework-relay-token" = "relay-secret"');
  });
});

describe('classifyFrpcLine', () => {
  it('recognizes frpc log lines, ignoring ANSI colors', () => {
    expect(classifyFrpcLine('\x1b[1;34m2026 [I] [client/control.go:174] [id] [webui] start proxy success\x1b[0m')).toBe(
      'connected'
    );
    expect(classifyFrpcLine('[W] [client/service.go:380] connect to server error: i/o timeout')).toBe('disconnected');
    expect(classifyFrpcLine('[W] connect to server error: invalid tunnel credentials')).toBe('rejected');
    expect(classifyFrpcLine('[W] [webui] start error: proxy subdomain does not match tunnel')).toBe('rejected');
    expect(classifyFrpcLine('[I] try to connect to server...')).toBe('none');
  });

  it('does not mistake a rejection for a plain disconnect', () => {
    expect(classifyFrpcLine('connect to server error: invalid tunnel credentials')).not.toBe('disconnected');
  });
});

describe('restartDelayMs', () => {
  it('backs off and caps', () => {
    expect([0, 1, 2, 3, 4, 99].map(restartDelayMs)).toEqual([2000, 5000, 15000, 30000, 30000, 30000]);
  });
});

// --- supervisor ------------------------------------------------------------

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
  say(line: string): void {
    this.stdout.emit('data', Buffer.from(`${line}\n`));
  }
}

describe('RemoteTunnel', () => {
  let dir: string;
  let children: FakeChild[];
  let statuses: TunnelStatus[];
  let timers: Array<{ fn: () => void; ms: number }>;
  let registerCalls: number;

  const make = (opts: { frpc?: string | null; failRegister?: boolean } = {}): RemoteTunnel =>
    new RemoteTunnel({
      dataDir: dir,
      brokerUrl: () => 'https://broker.test/trial-broker/',
      resolveFrpc: () => (opts.frpc === undefined ? '/bin/frpc' : opts.frpc),
      relayToken: 'relay-secret',
      spawn: (() => {
        const c = new FakeChild();
        children.push(c);
        return c;
      }) as never,
      fetch: (async (url: string) => {
        registerCalls++;
        expect(url).toBe('https://broker.test/trial-broker/v1/remote/register');
        if (opts.failRegister) return { ok: false, status: 503, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...registration,
            subdomain: `abc123def45${registerCalls}`,
            public_url: `https://abc123def45${registerCalls}.r.1work.vip`,
          }),
        };
      }) as never,
      onChange: (s) => statuses.push(s),
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => undefined,
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-test-'));
    children = [];
    statuses = [];
    timers = [];
    registerCalls = 0;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('registers once, persists the address, and reports connected', async () => {
    const t = make();
    await t.start(25808);
    expect(registerCalls).toBe(1);
    expect(children).toHaveLength(1);
    expect(t.getStatus().state).toBe('connecting');
    expect(t.getStatus().url).toBe('https://abc123def451.r.1work.vip');

    children[0].say('[I] [id] [webui] start proxy success');
    expect(t.getStatus()).toEqual({ state: 'connected', url: 'https://abc123def451.r.1work.vip' });

    const config = fs.readFileSync(path.join(dir, 'frpc.toml'), 'utf-8');
    expect(config).toContain('localPort = 25808');
    expect(fs.existsSync(path.join(dir, 'remote-tunnel.json'))).toBe(true);
  });

  it('keeps the same address across restarts of the app', async () => {
    const first = make();
    await first.start(25808);
    await first.stop();

    const second = make();
    await second.start(25808);
    expect(registerCalls).toBe(1);
    expect(second.getStatus().url).toBe('https://abc123def451.r.1work.vip');
  });

  it('stop removes the config that holds the secret and kills frpc', async () => {
    const t = make();
    await t.start(25808);
    await t.stop();
    expect(children[0].killed).toBe(true);
    expect(fs.existsSync(path.join(dir, 'frpc.toml'))).toBe(false);
    expect(t.getStatus().state).toBe('off');
  });

  it('restarts frpc with backoff after an unexpected exit', async () => {
    const t = make();
    await t.start(25808);
    children[0].emit('exit', 1);
    expect(timers.map((x) => x.ms)).toEqual([2000]);
    timers[0].fn();
    await vi.waitFor(() => expect(children).toHaveLength(2));
    // The address survives a restart: no second registration.
    expect(registerCalls).toBe(1);
  });

  it('does not restart after stop()', async () => {
    const t = make();
    await t.start(25808);
    await t.stop();
    children[0].emit('exit', 0);
    expect(timers).toHaveLength(0);
  });

  it('re-registers once when the server rejects the credentials, then gives up', async () => {
    const t = make();
    await t.start(25808);
    children[0].say('[W] connect to server error: invalid tunnel credentials');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(children[0].killed).toBe(true);
    expect(registerCalls).toBe(2);
    expect(t.getStatus().url).toBe('https://abc123def452.r.1work.vip');

    children[1].say('[W] connect to server error: invalid tunnel credentials');
    await vi.waitFor(() => expect(t.getStatus()).toMatchObject({ state: 'error', error: 'rejected' }));
    expect(registerCalls).toBe(2);
    expect(children).toHaveLength(2);
  });

  it('reports no_binary without trying to register', async () => {
    const t = make({ frpc: null });
    await t.start(25808);
    expect(t.getStatus()).toEqual({ state: 'error', error: 'no_binary' });
    expect(registerCalls).toBe(0);
  });

  it('reports register_failed and retries later when the broker is unreachable', async () => {
    const t = make({ failRegister: true });
    await t.start(25808);
    expect(t.getStatus()).toMatchObject({ state: 'error', error: 'register_failed' });
    expect(children).toHaveLength(0);
    expect(timers).toHaveLength(1);
  });

  it('resetAddress forgets the address and registers a fresh one', async () => {
    const t = make();
    await t.start(25808);
    await t.resetAddress();
    expect(registerCalls).toBe(2);
    expect(t.getStatus().url).toBe('https://abc123def452.r.1work.vip');
  });
});
