import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { RelayServer } from '@process/services/remoteTunnel/relay/server';
import { TunnelClient } from '@process/services/remoteTunnel/tunnelClient';

describe('regional relay ownership routing', () => {
  let domestic: RelayServer;
  let overseas: RelayServer;
  let backend: http.Server;
  let sockets: WebSocketServer;
  const clients: TunnelClient[] = [];
  const host = 'abcdef123456.r.test';
  const token = 'private-inter-node-token-for-tests';

  beforeEach(async () => {
    backend = http.createServer((req, res) => res.end(req.headers['x-real-ip'] + ':' + req.url));
    sockets = new WebSocketServer({ server: backend });
    sockets.on('connection', (ws) => ws.on('message', (data, binary) => ws.send(data, { binary })));
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const peer = { url: 'http://127.0.0.1:1', token };
    domestic = new RelayServer({ subdomainHost: 'r.test', verify: async () => 'ok', peer });
    await domestic.listen({ host: '127.0.0.1', port: 0 }, { host: '127.0.0.1', port: 0 });
    overseas = new RelayServer({
      subdomainHost: 'r.test',
      verify: async () => 'ok',
      peer: { url: `http://127.0.0.1:${domestic.ports.visitor}`, token },
    });
    await overseas.listen({ host: '127.0.0.1', port: 0 }, { host: '127.0.0.1', port: 0 });
    peer.url = `http://127.0.0.1:${overseas.ports.visitor}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.stop();
    sockets.close();
    backend.closeAllConnections();
    backend.close();
    await Promise.all([domestic.close(), overseas.close()]);
  });

  async function connect(relay: RelayServer): Promise<void> {
    const client = new TunnelClient({
      serverAddr: 'unused',
      serverPort: 443,
      subdomain: 'abcdef123456',
      secret: 'secret',
      relayToken: 'desktop-token',
      localPort: (backend.address() as AddressInfo).port,
      createSocket: () => new WebSocket(`ws://127.0.0.1:${relay.ports.control}/~!tunnel`),
    });
    clients.push(client);
    const connected = once(client, 'connected');
    client.start();
    await connected;
  }

  function request(
    relay: RelayServer,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: relay.ports.visitor, path: '/history', headers: { Host: host, ...headers } },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() })
          );
          response.on('error', reject);
        }
      );
      req.on('error', reject);
    });
  }

  it('routes either entry to the node holding the desktop and preserves the visitor IP', async () => {
    await connect(domestic);
    const replies = await Promise.all(
      [domestic, overseas].map(async (relay) => {
        return (await request(relay, { 'X-Real-IP': '203.0.113.19' })).body;
      })
    );
    expect(replies).toEqual(['203.0.113.19:/history', '203.0.113.19:/history']);
  });

  it('forwards WebSocket upgrades from the other region', async () => {
    await connect(overseas);
    const ws = new WebSocket(`ws://127.0.0.1:${domestic.ports.visitor}/ws`, { headers: { Host: host } });
    try {
      await once(ws, 'open');
      const reply = once(ws, 'message');
      ws.send('regional echo');
      expect(String((await reply)[0])).toBe('regional echo');
    } finally {
      ws.terminate();
    }
  });

  it('returns offline once when neither node owns the tunnel', async () => {
    const response = await request(domestic);
    expect(response.status).toBe(404);
  });

  it('rejects a forged peer marker', async () => {
    const response = await request(domestic, { 'X-OneWork-Peer': 'forged' });
    expect(response.status).toBe(403);
  });
});
