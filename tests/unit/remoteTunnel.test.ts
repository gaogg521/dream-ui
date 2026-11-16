import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconnectDelayMs } from '../../packages/desktop/src/process/services/remoteTunnel/protocol';
import { parseRegistration } from '../../packages/desktop/src/process/services/remoteTunnel/tunnelConfig';
import { RemoteTunnel } from '../../packages/desktop/src/process/services/remoteTunnel/RemoteTunnel';
import type { TunnelStatus } from '../../packages/desktop/src/process/services/remoteTunnel/RemoteTunnel';
import type {
  TunnelClientOptions,
  TunnelCloseInfo,
} from '../../packages/desktop/src/process/services/remoteTunnel/tunnelClient';

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

describe('reconnectDelayMs', () => {
  it('backs off and caps', () => {
    expect([0, 1, 2, 3, 4, 99].map(reconnectDelayMs)).toEqual([2000, 5000, 15000, 30000, 30000, 30000]);
  });
});

// --- supervisor ------------------------------------------------------------

class FakeClient extends EventEmitter {
  started = false;
  stopped = false;
  constructor(readonly options: TunnelClientOptions) {
    super();
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  connect(): void {
    this.emit('connected');
  }
  close(info: Partial<TunnelCloseInfo> = {}): void {
    this.emit('closed', { code: 1006, reason: '', rejected: false, replaced: false, wasConnected: false, ...info });
  }
}

describe('RemoteTunnel', () => {
  let dir: string;
  let clients: FakeClient[];
  let statuses: TunnelStatus[];
  let timers: Array<{ fn: () => void; ms: number }>;
  let registerCalls: number;
  let clock: number;

  const make = (opts: { failRegister?: boolean } = {}): RemoteTunnel =>
    new RemoteTunnel({
      dataDir: dir,
      brokerUrl: () => 'https://broker.test/trial-broker/',
      relayToken: 'relay-secret',
      createClient: (options) => {
        const c = new FakeClient(options);
        clients.push(c);
        return c;
      },
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
      now: () => clock,
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-test-'));
    clients = [];
    statuses = [];
    timers = [];
    registerCalls = 0;
    clock = 1_000_000;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('registers once, persists the address, and reports connected', async () => {
    const t = make();
    await t.start(25808);
    expect(registerCalls).toBe(1);
    expect(clients).toHaveLength(1);
    expect(clients[0].started).toBe(true);
    expect(clients[0].options).toMatchObject({
      serverAddr: '1work.vip',
      serverPort: 443,
      subdomain: 'abc123def451',
      secret: 'rts_secret',
      localPort: 25808,
      relayToken: 'relay-secret',
    });
    expect(t.getStatus()).toEqual({ state: 'connecting', url: 'https://abc123def451.r.1work.vip' });

    clients[0].connect();
    expect(t.getStatus()).toEqual({ state: 'connected', url: 'https://abc123def451.r.1work.vip' });
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

  it('stop disconnects and leaves no generated config or running client behind', async () => {
    const t = make();
    await t.start(25808);
    await t.stop();
    expect(clients[0].stopped).toBe(true);
    // The only file is the 0600 address store; nothing ready-to-run is written next to it.
    expect(fs.readdirSync(dir)).toEqual(['remote-tunnel.json']);
    expect(t.getStatus().state).toBe('off');
  });

  it('reconnects with backoff after the connection drops, keeping the address', async () => {
    const t = make();
    await t.start(25808);
    clients[0].connect();
    clients[0].close({ wasConnected: true });
    expect(t.getStatus().state).toBe('connecting');
    expect(timers.map((x) => x.ms)).toEqual([2000]);
    timers[0].fn();
    await vi.waitFor(() => expect(clients).toHaveLength(2));
    expect(registerCalls).toBe(1);

    // Keeps failing: delays grow.
    clients[1].close();
    clients[1].close(); // duplicate close of a finished client is ignored
    expect(timers.map((x) => x.ms)).toEqual([2000, 5000]);
  });

  it('resets the backoff only after a connection that stayed up', async () => {
    const t = make();
    await t.start(25808);
    // Flapping connection: connects, dies at once. Delay keeps growing.
    clients[0].connect();
    clients[0].close({ wasConnected: true });
    timers[0].fn();
    await vi.waitFor(() => expect(clients).toHaveLength(2));
    clients[1].connect();
    clients[1].close({ wasConnected: true });
    expect(timers.map((x) => x.ms)).toEqual([2000, 5000]);
    timers[1].fn();
    await vi.waitFor(() => expect(clients).toHaveLength(3));

    // A healthy connection resets it.
    clients[2].connect();
    clock += 60_000;
    clients[2].close({ wasConnected: true });
    expect(timers.map((x) => x.ms)).toEqual([2000, 5000, 2000]);
  });

  it('does not reconnect after stop()', async () => {
    const t = make();
    await t.start(25808);
    await t.stop();
    clients[0].close();
    expect(timers).toHaveLength(0);
    expect(t.getStatus().state).toBe('off');
  });

  it('re-registers once when the relay rejects the credentials, then gives up', async () => {
    const t = make();
    await t.start(25808);
    clients[0].close({ code: 4401, rejected: true });
    await vi.waitFor(() => expect(clients).toHaveLength(2));
    expect(registerCalls).toBe(2);
    expect(clients[1].options.subdomain).toBe('abc123def452');
    expect(t.getStatus().url).toBe('https://abc123def452.r.1work.vip');

    clients[1].close({ code: 4401, rejected: true });
    await vi.waitFor(() => expect(t.getStatus()).toMatchObject({ state: 'error', error: 'rejected' }));
    expect(registerCalls).toBe(2);
    expect(clients).toHaveLength(2);
    // Giving up is final until the user toggles: no retry timer.
    expect(timers).toHaveLength(0);
  });

  it('treats being replaced by another connection as an ordinary drop, not a rejection', async () => {
    const t = make();
    await t.start(25808);
    clients[0].connect();
    clients[0].close({ code: 4409, replaced: true, wasConnected: true });
    expect(t.getStatus().state).toBe('connecting');
    expect(registerCalls).toBe(1);
    expect(timers).toHaveLength(1);
  });

  it('reports register_failed and retries later when the broker is unreachable', async () => {
    const t = make({ failRegister: true });
    await t.start(25808);
    expect(t.getStatus()).toMatchObject({ state: 'error', error: 'register_failed' });
    expect(clients).toHaveLength(0);
    expect(timers).toHaveLength(1);
  });

  it('start() with the same port while running does nothing', async () => {
    const t = make();
    await t.start(25808);
    await t.start(25808);
    expect(clients).toHaveLength(1);
    expect(clients[0].stopped).toBe(false);
  });

  it('start() with a new port reconnects against it', async () => {
    const t = make();
    await t.start(25808);
    await t.start(25809);
    expect(clients).toHaveLength(2);
    expect(clients[0].stopped).toBe(true);
    expect(clients[1].options.localPort).toBe(25809);
  });

  it('resetAddress forgets the address and registers a fresh one', async () => {
    const t = make();
    await t.start(25808);
    await t.resetAddress();
    expect(registerCalls).toBe(2);
    expect(t.getStatus().url).toBe('https://abc123def452.r.1work.vip');
  });
});
